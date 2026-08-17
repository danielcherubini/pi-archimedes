import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

export interface NpxResolution {
  command: string;
  args: string[];
}

/** Flags/subcommands that wrap the real package argument. */
const WRAPPER_FLAGS = new Set(["-y", "--yes", "exec"]);

/**
 * Pure helper: strip npx wrapper flags (-y, --yes, exec) from args.
 * The first remaining argument is the package (or bin) name.
 */
export function parseNpxArgs(args: string[]): string[] {
  return args.filter((a) => !WRAPPER_FLAGS.has(a));
}

/**
 * True when the command is `npx`, or `npm` invoked with the `exec`/`npx`
 * subcommand. The command may be an absolute path; only its basename matters.
 */
function isNpxCommand(command: string, args: string[]): boolean {
  const base = basename(command);
  if (base === "npx") return true;
  if (base === "npm") return args[0] === "exec" || args[0] === "npx";
  return false;
}

/** Strip a trailing `@version` from a package name (handles scoped names). */
function stripVersion(arg: string): string {
  const start = arg.startsWith("@") ? 1 : 0;
  const at = arg.indexOf("@", start);
  return at === -1 ? arg : arg.slice(0, at);
}

/** Read the bin name(s) declared by a package's package.json (bin *keys*). */
function readPackageBinNames(pkgDir: string): string[] {
  try {
    const raw = readFileSync(join(pkgDir, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { bin?: unknown; name?: unknown };
    // String form: npm names the .bin symlink after the package name.
    if (typeof pkg.bin === "string") {
      return typeof pkg.name === "string" && pkg.name ? [pkg.name] : [];
    }
    if (pkg.bin && typeof pkg.bin === "object") {
      return Object.keys(pkg.bin as Record<string, string>);
    }
  } catch {
    // Missing/unreadable package.json — no declared bin.
  }
  return [];
}

/** Directories that contain a `node_modules` tree worth checking. */
function nodeModulesBases(cwd: string): string[] {
  const bases: string[] = [cwd];

  // npx/npm install cache (~/.npm/_npx/<hash>)
  const npxCache = join(homedir(), ".npm", "_npx");
  try {
    for (const entry of readdirSync(npxCache)) {
      bases.push(join(npxCache, entry));
    }
  } catch {
    // No cache present — ignore.
  }

  // Global installs relative to the running node binary (<prefix>/lib).
  bases.push(join(dirname(process.execPath), "..", "lib"));

  return bases;
}

/**
 * Locate the actual bin of `pkg` by finding its package.json and resolving the
 * declared bin name against the sibling `node_modules/.bin`. Returns the absolute
 * bin path, or null when it cannot be found.
 */
function findBinPath(cwd: string, pkg: string): string | null {
  for (const base of nodeModulesBases(cwd)) {
    const binNames = readPackageBinNames(join(base, "node_modules", pkg));
    for (const binName of binNames) {
      const binPath = join(base, "node_modules", ".bin", binName);
      try {
        if (existsSync(binPath) && statSync(binPath).isFile()) return binPath;
      } catch {
        // Unreadable entry — skip.
      }
    }
  }
  return null;
}

/**
 * If command is `npx`/`npm exec`, attempt to resolve the actual package binary
 * so we spawn it directly instead of the npm parent.
 *
 * Returns null when the command is NOT an npx/npm command (caller uses the
 * original command/args). Otherwise always returns a resolution: either the
 * resolved bin path (with wrapper flags stripped), or the original command and
 * args *unchanged* when no bin could be located (graceful degradation — never
 * null for npx/npm, never strips flags we didn't consume).
 */
export async function resolveNpxBinary(
  command: string,
  args: string[],
): Promise<NpxResolution | null> {
  if (!isNpxCommand(command, args)) return null;

  const parsed = parseNpxArgs(args);
  const first = parsed[0];
  const rest = parsed.slice(1);

  // No package argument (e.g. bare `npx`) — degrade to the original.
  if (!first) return { command, args };

  const bin = findBinPath(process.cwd(), stripVersion(first));
  if (bin) return { command: bin, args: rest };

  // No bin found — degrade gracefully to the original command/args unchanged
  // (keep -y/--yes so npx doesn't prompt; never return null for npx/npm).
  return { command, args };
}
