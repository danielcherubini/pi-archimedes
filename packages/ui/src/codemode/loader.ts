import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

export interface CodemodeToolModule {
  createCodemodeToolDefinition: (options?: Record<string, unknown>) => unknown;
  codemodeSchema: unknown;
}

const AGENT_PACKAGE_NAME = "@earendil-works/pi-coding-agent";
/** Candidate 1: relative to the package ROOT (the CLI-install walk-up). */
const CODEMODE_MODULE_FROM_ROOT = path.join(
  "dist",
  "extensions",
  "codemode",
  "tool.js",
);
/** Candidate 2: relative to the `dist/` directory the package entry lives in. */
const CODEMODE_MODULE_FROM_DIST = path.join(
  "extensions",
  "codemode",
  "tool.js",
);

/**
 * Walk up from `startDir` to the package root (the nearest ancestor holding a
 * package.json) and return it when it is the pi-coding-agent package.
 */
export function findAgentPackageRoot(startDir: string): string | undefined {
  let dir = startDir;
  while (true) {
    const pkgPath = path.join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        if (pkg.name === AGENT_PACKAGE_NAME) {
          return dir;
        }
      } catch {
        // Unreadable package.json — keep walking up.
      }
      // A package boundary without a matching name: stop (we are inside some
      // other package's tree, not the agent's).
      return undefined;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Candidate files for the codemode tool module, in preference order:
 *
 * 1. The running pi CLI's own install. `process.argv[1]` is the CLI entry
 *    script (e.g. `…/pi-coding-agent/dist/bundle/cli.js`); walking up to the
 *    package root finds the `dist` the CLI is actually running from. Pi loads
 *    extensions with jiti, which shares the native module instance for `.js`
 *    files, so when the CLI runs unbundled this is the very same module the
 *    CLI's built-in codemode extension loaded — same schema object, same
 *    executor.
 * 2. Our own node_modules copy (resolved via `import.meta.resolve`). A
 *    fallback for launchers whose argv[1] is not inside a pi-coding-agent
 *    install. Older pi versions have no `dist/extensions/codemode` at all,
 *    in which case the file does not exist and the candidate is skipped.
 */
export function resolveCodemodeModuleFiles(argv1?: string): string[] {
  const candidates: string[] = [];
  const entry = argv1 ?? process.argv[1];
  if (typeof entry === "string" && entry.length > 0) {
    let root: string | undefined;
    try {
      root = findAgentPackageRoot(path.dirname(realpathSync(entry)));
    } catch {
      root = undefined;
    }
    if (root) {
      candidates.push(path.join(root, CODEMODE_MODULE_FROM_ROOT));
    }
  }
  try {
    // `import.meta.resolve` (the `import` condition) — the agent package's
    // exports map has no `require` condition, so a CJS `require.resolve`
    // would fail on newer pi versions.
    const agentEntry = new URL(import.meta.resolve(AGENT_PACKAGE_NAME)).pathname;
    // `agentEntry` is `…/pi-coding-agent/dist/index.js` — its directory IS the
    // `dist` dir, so join the module path WITHOUT another `dist` segment.
    candidates.push(path.join(path.dirname(agentEntry), CODEMODE_MODULE_FROM_DIST));
  } catch {
    // No local copy of the agent package — nothing else to try.
  }
  return candidates;
}

/**
 * Load the codemode tool module from the running pi install (see
 * {@link resolveCodemodeModuleFiles}). Returns `undefined` when the module
 * cannot be found or loaded (e.g. a pi version without the codemode
 * extension), so the caller can fall back to pi's native rendering.
 */
export async function loadCodemodeModule(
  argv1?: string,
): Promise<CodemodeToolModule | undefined> {
  for (const file of resolveCodemodeModuleFiles(argv1)) {
    if (!existsSync(file)) continue;
    try {
      const mod = await import(file);
      if (typeof mod?.createCodemodeToolDefinition === "function") {
        return mod as CodemodeToolModule;
      }
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}
