import { createRequire } from "node:module";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

export interface CodemodeToolModule {
  createCodemodeToolDefinition: (options?: Record<string, unknown>) => unknown;
  codemodeSchema: unknown;
}

const AGENT_PACKAGE_NAME = "@earendil-works/pi-coding-agent";
const CODEMODE_MODULE_RELATIVE = path.join(
  "dist",
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
 * 2. Our own node_modules copy (resolved via `createRequire`). A fallback for
 *    launchers whose argv[1] is not inside a pi-coding-agent install. Older
 *    pi versions have no `dist/extensions/codemode` at all, in which case the
 *    file does not exist and the candidate is skipped.
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
      candidates.push(path.join(root, CODEMODE_MODULE_RELATIVE));
    }
  }
  try {
    const require = createRequire(import.meta.url);
    const agentEntry = require.resolve(AGENT_PACKAGE_NAME);
    // `agentEntry` is `…/pi-coding-agent/dist/index.js`.
    candidates.push(path.join(path.dirname(agentEntry), CODEMODE_MODULE_RELATIVE));
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
