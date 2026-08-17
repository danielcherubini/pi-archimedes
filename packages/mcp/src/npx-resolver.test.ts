import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseNpxArgs, resolveNpxBinary } from "./npx-resolver.js";

describe("parseNpxArgs", () => {
  it("strips -y", () => {
    expect(parseNpxArgs(["-y", "pkg"])).toEqual(["pkg"]);
  });

  it("strips --yes", () => {
    expect(parseNpxArgs(["--yes", "pkg"])).toEqual(["pkg"]);
  });

  it("strips exec subcommand", () => {
    expect(parseNpxArgs(["exec", "pkg"])).toEqual(["pkg"]);
  });

  it("strips combined wrapper flags", () => {
    expect(parseNpxArgs(["-y", "exec", "pkg"])).toEqual(["pkg"]);
    expect(parseNpxArgs(["--yes", "-y", "pkg"])).toEqual(["pkg"]);
  });

  it("keeps the package and any real args intact", () => {
    expect(parseNpxArgs(["pkg", "--foo", "bar"])).toEqual(["pkg", "--foo", "bar"]);
  });

  it("handles pkg@version form", () => {
    expect(parseNpxArgs(["-y", "pkg@1.2.3"])).toEqual(["pkg@1.2.3"]);
  });

  it("returns empty array when only wrapper flags present", () => {
    expect(parseNpxArgs(["-y", "--yes"])).toEqual([]);
  });
});

describe("resolveNpxBinary", () => {
  it("returns null for a non-npx command", async () => {
    const result = await resolveNpxBinary("node", ["x"]);
    expect(result).toBeNull();
  });

  it("returns null for a plain executable (pure, no filesystem)", async () => {
    const result = await resolveNpxBinary("/usr/bin/python3", ["script.py"]);
    expect(result).toBeNull();
  });

  it("returns a non-null resolution for an npx command", async () => {
    // Environment-dependent: it may resolve to a real bin or fall back to the
    // original command with wrapper flags stripped. Either way it must be non-null.
    const result = await resolveNpxBinary("npx", ["-y", "some-real-pkg"]);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.command).toBeTruthy();
      expect(Array.isArray(result.args)).toBe(true);
    }
  });

  it("returns a non-null resolution for npm exec", async () => {
    const result = await resolveNpxBinary("npm", ["exec", "-y", "some-real-pkg"]);
    expect(result).not.toBeNull();
  });
});

describe("resolveNpxBinary (filesystem fixtures)", () => {
  let originalCwd: string;
  const tmpDirs: string[] = [];

  beforeEach(() => {
    originalCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    for (const dir of tmpDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /** Create a tmp cwd with a fake package install and chdir into it. */
  function withInstalledPkg(
    pkgName: string,
    pkgJson: Record<string, unknown>,
    dotBinEntries: string[],
  ): string {
    const dir = mkdtempSync(join(tmpdir(), "npx-resolver-"));
    tmpDirs.push(dir);
    const nm = join(dir, "node_modules");
    mkdirSync(join(nm, pkgName), { recursive: true });
    writeFileSync(
      join(nm, pkgName, "package.json"),
      JSON.stringify(pkgJson),
      "utf8",
    );
    for (const entry of dotBinEntries) {
      mkdirSync(join(nm, ".bin"), { recursive: true });
      writeFileSync(join(nm, ".bin", entry), "#!/usr/bin/env node\n", "utf8");
    }
    process.chdir(dir);
    return dir;
  }

  it("resolves object-form bin using the bin key, not the value", async () => {
    const dir = withInstalledPkg(
      "fixture-key-pkg",
      { name: "fixture-key-pkg", bin: { foo: "cli.js" } },
      ["foo"],
    );
    const result = await resolveNpxBinary("npx", ["-y", "fixture-key-pkg", "--flag"]);
    expect(result).toEqual({
      command: join(dir, "node_modules", ".bin", "foo"),
      args: ["--flag"],
    });
  });

  it("resolves string-form bin using the package name", async () => {
    const dir = withInstalledPkg(
      "fixture-string-pkg",
      { name: "fixture-string-pkg", bin: "cli.js" },
      ["fixture-string-pkg"],
    );
    const result = await resolveNpxBinary("npx", ["fixture-string-pkg"]);
    expect(result).toEqual({
      command: join(dir, "node_modules", ".bin", "fixture-string-pkg"),
      args: [],
    });
  });

  it("fallback (no package found) returns the original command and args unchanged", async () => {
    withInstalledPkg("fixture-unrelated-pkg", { name: "fixture-unrelated-pkg" }, []);
    const result = await resolveNpxBinary("npx", [
      "-y",
      "definitely-not-installed-xyz-42",
      "--port", "8080",
    ]);
    expect(result).toEqual({
      command: "npx",
      args: ["-y", "definitely-not-installed-xyz-42", "--port", "8080"],
    });
  });
});
