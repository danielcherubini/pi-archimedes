/**
 * Unit tests for the `/mcp setup` import-preview logic (plan-027, Task 4).
 *
 * `computeImportPreview` is a pure function exported for testability
 * (see its doc comment in setup-panel.ts): it unions the servers of the
 * checked host configs in discovery order (first seen wins a name clash),
 * then diffs the union against the names already present in `<cwd>/.mcp.json`
 * (passed in as a plain `existingNames` list — no I/O here, so no temp dirs
 * are needed the way the config-write tests require).
 */
import { describe, expect, it } from "vitest";
import { computeImportPreview } from "./setup-panel.js";
import type { HostConfig } from "./host-configs.js";
import type { ServerDef } from "./types.js";

const stdio = (command: string): ServerDef => ({ command });
const remote = (url: string): ServerDef => ({ url });

const host = (agent: HostConfig["agent"], servers: Record<string, ServerDef>): HostConfig => ({
  agent,
  path: `/${agent}.json`,
  servers,
});

describe("computeImportPreview", () => {
  it("returns null when no host is checked (empty selection)", () => {
    const hosts = [
      host("cursor", { a: stdio("npx") }),
      host("claude-code", { b: remote("https://b.example/mcp") }),
    ];

    expect(computeImportPreview(hosts, new Set<number>(), [])).toBeNull();
  });

  it("returns null when the only checked source declares zero servers", () => {
    const hosts = [
      host("cursor", {}),
      host("claude-code", { a: stdio("npx") }), // NOT checked
    ];

    expect(computeImportPreview(hosts, new Set([0]), [])).toBeNull();
  });

  it("lists every server of a single checked source in its declaration order, labelled by that agent", () => {
    const servers: Record<string, ServerDef> = {
      alpha: stdio("npx"),
      beta: remote("https://beta.example/mcp"),
      gamma: stdio("uvx"),
    };
    const hosts = [host("cursor", servers)];

    const preview = computeImportPreview(hosts, new Set([0]), []);

    expect(preview).not.toBeNull();
    expect(preview!.sourceLabel).toBe("cursor");
    expect(preview!.adding).toEqual(["alpha", "beta", "gamma"]);
    expect(preview!.alreadyPresent).toBe(0);
    // defs map every selected name to the exact def reference it came from.
    expect(Object.keys(preview!.defs)).toEqual(["alpha", "beta", "gamma"]);
    expect(preview!.defs.alpha).toBe(servers.alpha);
    expect(preview!.defs.beta).toBe(servers.beta);
    expect(preview!.defs.gamma).toBe(servers.gamma);
  });

  it("resolves a name clash across two checked sources with first-seen-wins", () => {
    const cursorDb: ServerDef = stdio("npx");
    const claudeDb: ServerDef = remote("https://claude.example/db");
    const claudeOwn: ServerDef = remote("https://own.example/mcp");
    const hosts = [
      host("cursor", { db: cursorDb, extra: stdio("uvx") }),
      host("claude-code", { db: claudeDb, own: claudeOwn }),
    ];

    const preview = computeImportPreview(hosts, new Set([0, 1]), []);

    // The FIRST source's def wins identity; the later one's is dropped
    // (single `db` key, no duplication).
    expect(Object.keys(preview!.defs)).toEqual(["db", "extra", "own"]);
    expect(preview!.defs.db).toBe(cursorDb);
    expect(preview!.defs.own).toBe(claudeOwn);
    // First-seen INSERTION order drives `adding`, not per-source grouping.
    expect(preview!.adding).toEqual(["db", "extra", "own"]);
    expect(preview!.alreadyPresent).toBe(0);
  });

  it("leaves a checked source's label in sourceLabel even when it contributes no new servers at all", () => {
    const hosts = [
      host("cursor", { x: stdio("npx"), y: stdio("uvx") }),
      // Only server `y` — a pure clash, so this source adds nothing new.
      host("claude-desktop", { y: remote("https://other.example/mcp") }),
    ];

    const preview = computeImportPreview(hosts, new Set([0, 1]), []);

    expect(preview!.sourceLabel).toBe("cursor + claude-desktop");
    expect(preview!.adding).toEqual(["x", "y"]);
    expect(preview!.defs.y).toBe(hosts[0]!.servers.y);
    expect(preview!.alreadyPresent).toBe(0);
  });

  it("excludes servers already present in .mcp.json from adding and counts them in alreadyPresent", () => {
    const hosts = [
      host("cursor", {
        kept: stdio("npx"),
        alsoKept: remote("https://kept.example/mcp"),
        fresh: stdio("uvx"),
      }),
    ];

    const preview = computeImportPreview(hosts, new Set([0]), ["kept", "alsoKept"]);

    expect(preview!.adding).toEqual(["fresh"]);
    expect(preview!.alreadyPresent).toBe(2);
    // Kept defs STAY in `defs` — mergeServerDefinitions re-applies
    // add-if-absent on the writer side, so dropping them here would lose them.
    expect(Object.keys(preview!.defs).sort()).toEqual(["alsoKept", "fresh", "kept"]);
  });

  it("returns a (non-null) preview with an empty adding list when every selected server already exists", () => {
    const hosts = [host("cursor", { a: stdio("npx"), b: stdio("uvx") })];

    const preview = computeImportPreview(hosts, new Set([0]), ["a", "b"]);

    expect(preview).not.toBeNull();
    expect(preview!.adding).toEqual([]);
    expect(preview!.alreadyPresent).toBe(2);
    expect(preview!.sourceLabel).toBe("cursor");
  });

  it("counts alreadyPresent exactly when multiple checked sources overlap existing names", () => {
    const hosts = [
      host("cursor", { a: stdio("npx"), c: stdio("uvx") }),
      host("vscode", { b: remote("https://b.example/mcp"), d: remote("https://d.example/mcp") }),
      // `c` clashes with cursor's — cursor keeps the def.
      host("claude-desktop", { c: remote("https://other.example/c"), e: stdio("npx") }),
    ];

    const preview = computeImportPreview(hosts, new Set([0, 1, 2]), ["a", "d"]);

    // Unique union in first-seen order: a, c, b, d, e → add if not in {a, d}.
    expect(preview!.adding).toEqual(["c", "b", "e"]);
    expect(preview!.alreadyPresent).toBe(2);
    expect(preview!.sourceLabel).toBe("cursor + vscode + claude-desktop");
    expect(preview!.defs.c).toBe(hosts[0]!.servers.c);
  });

  it("ignores unchecked hosts entirely and skips checked indices with no entry (sparse / out-of-range)", () => {
    // Sparse: index 1 is a hole; checked 5 is out of range.
    const hosts: HostConfig[] = new Array(4);
    hosts[0] = host("cursor", { a: stdio("npx") });
    hosts[3] = host("vscode", { b: remote("https://b.example/mcp") });

    const preview = computeImportPreview(hosts, new Set([0, 3, 5]), []);
    expect(preview).not.toBeNull();
    expect(preview!.sourceLabel).toBe("cursor + vscode");
    expect(preview!.adding).toEqual(["a", "b"]);

    // All-checked-undefined → the documented empty-case result.
    const holes: HostConfig[] = new Array(2);
    expect(computeImportPreview(holes, new Set([0, 1, 9]), [])).toBeNull();
  });
});
