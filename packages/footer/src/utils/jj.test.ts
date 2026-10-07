import { describe, it, expect, vi, afterEach } from "vitest";
import { resolve } from "path";

describe("getJjBookmark", () => {
  let getJjBookmark: () => string | null;
  let execFileSync: ReturnType<typeof vi.fn>;
  let execFile: ReturnType<typeof vi.fn>;

  // `paths` = repo markers that exist, relative to cwd. Default is a colocated jj repo.
  async function load(opts: { paths?: string[]; output?: string; throws?: boolean } = {}) {
    vi.resetModules();
    execFileSync = vi.fn(() => {
      if (opts.throws) throw new Error("ENOENT");
      return opts.output ?? "";
    });
    execFile = vi.fn();
    vi.doMock("child_process", () => ({ execFileSync, execFile }));
    const existing = new Set((opts.paths ?? [".jj", ".git"]).map((p) => resolve(process.cwd(), p)));
    vi.doMock("fs", () => ({ existsSync: vi.fn((p: string) => existing.has(p)) }));
    getJjBookmark = (await import("./jj.js")).getJjBookmark;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null without spawning jj outside a jj repo", async () => {
    await load({ paths: [".git"] });
    expect(getJjBookmark()).toBeNull();
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("leaves a git repo nested inside a jj tree to git", async () => {
    await load({ paths: [".git", "../.jj"] });
    expect(getJjBookmark()).toBeNull();
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("finds a jj repo from a subdirectory", async () => {
    await load({ paths: ["../.jj"], output: "main\n" });
    expect(getJjBookmark()).toBe("main");
  });

  it("prefers the first bookmark line over the @ change-id line", async () => {
    await load({ output: "@mooqvmmx\nmain\nother\n" });
    expect(getJjBookmark()).toBe("main");
  });

  it("returns the bookmark when @ itself is bookmarked", async () => {
    await load({ output: "feature-x\n" });
    expect(getJjBookmark()).toBe("feature-x");
  });

  it("falls back to the change id when no ancestor is bookmarked", async () => {
    await load({ output: "@mooqvmmx\n" });
    expect(getJjBookmark()).toBe("mooqvmmx");
  });

  it("returns null when jj fails", async () => {
    await load({ throws: true });
    expect(getJjBookmark()).toBeNull();
  });

  it("serves the cache within the TTL and refreshes in the background after", async () => {
    await load({ output: "main\n" });
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    expect(getJjBookmark()).toBe("main");
    expect(getJjBookmark()).toBe("main");
    expect(execFileSync).toHaveBeenCalledTimes(1);
    // Never snapshot the working copy from a render (op-log writes, repo lock)
    expect(execFileSync.mock.calls[0]![1]).toContain("--ignore-working-copy");
    expect(execFile).not.toHaveBeenCalled();

    now.mockReturnValue(5_000);
    expect(getJjBookmark()).toBe("main"); // stale value while refreshing
    expect(execFile).toHaveBeenCalledTimes(1);

    const done = execFile.mock.calls[0]![3] as (e: Error | null, out: string) => void;
    done(new Error("lock timeout"), "");
    expect(getJjBookmark()).toBe("main"); // failed refresh keeps stale value

    now.mockReturnValue(10_000);
    getJjBookmark();
    (execFile.mock.calls[1]![3] as typeof done)(null, "feature-x\n");
    expect(getJjBookmark()).toBe("feature-x");
  });
});
