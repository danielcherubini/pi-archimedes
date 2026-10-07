import { describe, it, expect, vi } from "vitest";
import { resolve } from "path";

// `paths` = repo markers that exist, relative to cwd. Default: colocated jj repo.
async function load({ paths = [".jj", ".git"], output = "main\n", throws = false } = {}) {
  vi.resetModules();
  const existing = new Set(paths.map((p) => resolve(process.cwd(), p)));
  const execFileSync = vi.fn((_cmd: string, _args: string[]) => {
    if (throws) throw new Error("ENOENT");
    return output;
  });
  const execFile = vi.fn();
  vi.doMock("child_process", () => ({ execFileSync, execFile }));
  vi.doMock("fs", () => ({ existsSync: (p: string) => existing.has(p) }));
  const { getJjBookmark } = await import("./jj.js");
  return { getJjBookmark, execFileSync, execFile, existing };
}

describe("getJjBookmark", () => {
  it.each([
    { name: "plain git repo", paths: [".git"], expected: null },
    { name: "git repo nested in a jj tree", paths: [".git", "../.jj"], expected: null },
    { name: "colocated jj repo", paths: [".jj", ".git"], expected: "main" },
    { name: "subdirectory of a jj repo", paths: ["../.jj"], expected: "main" },
  ])("detects $name", async ({ paths, expected }) => {
    const { getJjBookmark, execFileSync } = await load({ paths });
    expect(getJjBookmark()).toBe(expected);
    if (!expected) expect(execFileSync).not.toHaveBeenCalled(); // git-only users never spawn jj
  });

  it.each([
    { output: "@mooqvmmx\nmain\nother\n", expected: "main" }, // first bookmark line beats @
    { output: "feature-x\n", expected: "feature-x" }, // @ itself bookmarked
    { output: "main release v2\n", expected: "main +2" }, // capped for layout width
    { output: "@mooqvmmx\n", expected: "mooqvmmx" }, // no bookmark → change id
  ])("parses $output", async ({ output, expected }) => {
    const { getJjBookmark } = await load({ output });
    expect(getJjBookmark()).toBe(expected);
  });

  it("returns null when jj fails", async () => {
    const { getJjBookmark } = await load({ throws: true });
    expect(getJjBookmark()).toBeNull();
  });

  it("caches, refreshes in the background, and notices a late `jj git init`", async () => {
    const { getJjBookmark, execFileSync, execFile, existing } = await load({ paths: [".git"] });
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    expect(getJjBookmark()).toBeNull();

    existing.add(resolve(process.cwd(), ".jj")); // negative detection expires
    now.mockReturnValue(5_000);
    expect(getJjBookmark()).toBe("main");
    expect(getJjBookmark()).toBe("main"); // within TTL: no second spawn
    expect(execFileSync).toHaveBeenCalledTimes(1);
    expect(execFileSync.mock.calls[0]![1]).toContain("--ignore-working-copy"); // never snapshot from a render

    type Done = (e: Error | null, out: string) => void;
    now.mockReturnValue(10_000);
    expect(getJjBookmark()).toBe("main"); // stale while refreshing
    (execFile.mock.calls[0]![3] as Done)(new Error("lock timeout"), "");
    expect(getJjBookmark()).toBe("main"); // failed refresh keeps stale value

    now.mockReturnValue(15_000);
    getJjBookmark();
    (execFile.mock.calls[1]![3] as Done)(null, "feature-x\n");
    expect(getJjBookmark()).toBe("feature-x");
    now.mockRestore();
  });
});
