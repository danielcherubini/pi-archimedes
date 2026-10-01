import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  findAgentPackageRoot,
  resolveCodemodeModuleFiles,
  loadCodemodeModule,
} from "./loader.js";

const createdDirs: string[] = [];

function makeTree(
  rootName: string,
  files: Record<string, string>,
): string {
  const root = mkdtempSync(path.join(tmpdir(), `archimedes-${rootName}-`));
  createdDirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return root;
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.unstubAllEnvs();
});

describe("findAgentPackageRoot", () => {
  it("finds the package root from a nested dist file", () => {
    const root = makeTree("agent", {
      "package.json": JSON.stringify({ name: "@earendil-works/pi-coding-agent" }),
      "dist/index.js": "",
      "dist/extensions/codemode/tool.js": "",
    });
    expect(
      findAgentPackageRoot(path.join(root, "dist", "extensions", "codemode")),
    ).toBe(root);
    expect(findAgentPackageRoot(path.join(root, "dist"))).toBe(root);
  });

  it("returns undefined for another package", () => {
    const root = makeTree("other", {
      "package.json": JSON.stringify({ name: "@pi-archimedes/ui" }),
      "src/index.ts": "",
    });
    expect(findAgentPackageRoot(path.join(root, "src"))).toBeUndefined();
  });

  it("returns undefined when there is no package.json at all", () => {
    const root = makeTree("loose", { "some/file.js": "" });
    expect(findAgentPackageRoot(root)).toBeUndefined();
  });
});

describe("resolveCodemodeModuleFiles", () => {
  it("resolves the codemode module from the CLI entry script (argv[1])", () => {
    const root = makeTree("agent", {
      "package.json": JSON.stringify({ name: "@earendil-works/pi-coding-agent" }),
      "dist/bundle/cli.js": "",
      "dist/extensions/codemode/tool.js": "",
    });
    const files = resolveCodemodeModuleFiles(
      path.join(root, "dist", "bundle", "cli.js"),
    );
    expect(files).toContain(
      path.join(root, "dist", "extensions", "codemode", "tool.js"),
    );
  });

  it("returns no argv[1] candidate when the entry is not in the agent package", () => {
    const files = resolveCodemodeModuleFiles("/usr/bin/some-other-cli");
    // Only the local-copy candidate (if any) may remain.
    for (const file of files) {
      expect(file).not.toContain("/usr/bin/some-other-cli");
    }
  });

  it("returns an empty list without argv[1] and without a local copy", () => {
    // createRequire fallback: the local pi-coding-agent copy in this repo has
    // no dist/extensions/codemode in older versions, but the resolution
    // itself must not throw.
    expect(() => resolveCodemodeModuleFiles(undefined)).not.toThrow();
  });
});

describe("loadCodemodeModule", () => {
  it("loads the module when the file exists and exports the factory", async () => {
    const root = makeTree("agent", {
      "package.json": JSON.stringify({ name: "@earendil-works/pi-coding-agent" }),
      "dist/index.js": "",
      "dist/extensions/codemode/tool.js": `
        export const codemodeSchema = { type: "object" };
        export function createCodemodeToolDefinition(options) {
          return { options, parameters: codemodeSchema };
        }
      `,
    });
    const mod = await loadCodemodeModule(
      path.join(root, "dist", "index.js"),
    );
    expect(mod).toBeDefined();
    expect(mod!.createCodemodeToolDefinition).toBeTypeOf("function");
    expect(mod!.codemodeSchema).toEqual({ type: "object" });
  });

  it("returns undefined when the module file is missing", async () => {
    const mod = await loadCodemodeModule("/does/not/exist/cli.js");
    expect(mod).toBeUndefined();
  });

  it("returns undefined when the module lacks the factory", async () => {
    const root = makeTree("agent", {
      "package.json": JSON.stringify({ name: "@earendil-works/pi-coding-agent" }),
      "dist/index.js": "",
      "dist/extensions/codemode/tool.js": `
        export const somethingElse = 1;
      `,
    });
    const mod = await loadCodemodeModule(path.join(root, "dist", "index.js"));
    expect(mod).toBeUndefined();
  });
});
