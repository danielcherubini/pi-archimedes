import type { ToolPrefix } from "./types.js";

/** Sanitize a server name: keep [A-Za-z0-9_-], replace others with _<hex>_ */
export function sanitizeServerPrefix(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, (c) => `_${c.codePointAt(0)!.toString(16)}_`);
}

export function getServerPrefix(serverName: string, prefix: ToolPrefix): string {
  switch (prefix) {
    case "none": return "";
    case "short": return sanitizeServerPrefix(serverName.replace(/-?mcp$/i, ""));
    case "mcp": return `mcp__${sanitizeServerPrefix(serverName)}`;
    case "server":
    default: return sanitizeServerPrefix(serverName);
  }
}

/** Build prefixed tool name: <prefix>_<toolName with . → _> */
export function formatToolName(toolName: string, serverName: string, prefix: ToolPrefix): string {
  const p = getServerPrefix(serverName, prefix);
  const sanitized = toolName.replace(/\./g, "_");
  return p ? `${p}_${sanitized}` : sanitized;
}

/**
 * Inverse: find server owning a prefixed tool name by longest matching prefix.
 * Returns undefined if no match OR if two servers tie for the longest matching prefix (ambiguous).
 * IMPORTANT: compute each server's prefix using ITS OWN mode, not a hardcoded "server".
 */
export function resolveServerFromToolName(
  prefixedName: string,
  servers: Array<{ name: string; prefix: ToolPrefix }>,
): string | undefined {
  const matches: Array<{ name: string; prefixLen: number }> = [];
  for (const { name, prefix } of servers) {
    const p = getServerPrefix(name, prefix);
    if (p && prefixedName.startsWith(`${p}_`)) matches.push({ name, prefixLen: p.length });
  }
  if (matches.length === 0) return undefined;
  matches.sort((a, b) => b.prefixLen - a.prefixLen);
  // Ambiguous if the top two share the winning prefix length
  if (matches.length > 1 && matches[0]!.prefixLen === matches[1]!.prefixLen) return undefined;
  return matches[0]!.name;
}

/**
 * Group a server's raw tool names by their final formatted name, returning
 * only the groups with 2+ members. formatToolName is NOT injective: the
 * `.`→`_` sanitization means e.g. raw names "a.b" and "a_b" both format to
 * "srv_a_b" — such groups are genuinely ambiguous, and name resolution is
 * first-match-by-list-order.
 */
export function findFormattingCollisions(
  serverName: string,
  prefix: ToolPrefix,
  tools: Array<{ name: string }>,
): Array<{ finalName: string; rawNames: string[] }> {
  const byFinal = new Map<string, string[]>();
  for (const t of tools) {
    const finalName = formatToolName(t.name, serverName, prefix);
    const names = byFinal.get(finalName);
    if (names) names.push(t.name);
    else byFinal.set(finalName, [t.name]);
  }
  return [...byFinal.entries()]
    .filter(([, rawNames]) => rawNames.length > 1)
    .map(([finalName, rawNames]) => ({ finalName, rawNames }));
}

/**
 * Given a final (possibly prefixed) tool name, find the raw server tool name
 * that formats to it under the server's own prefix mode. Returns undefined
 * when no tool formats to the given name (e.g. the tool list is stale) —
 * callers may then fall back to prefix-stripping, which is only lossless for
 * dot-free tool names (`a.b` → `a_b` is NOT reversible by slicing).
 *
 * NOTE: because formatToolName is not injective ("a.b" and "a_b" format to
 * the same final name), a matching final name may correspond to MULTIPLE
 * raw names; the FIRST match in the provided tool list wins, silently. Use
 * findFormattingCollisions to detect and surface such ambiguity.
 */
export function matchRawToolName(
  finalName: string,
  serverName: string,
  prefix: ToolPrefix,
  tools: Array<{ name: string }>,
): string | undefined {
  for (const t of tools) {
    if (formatToolName(t.name, serverName, prefix) === finalName) return t.name;
  }
  return undefined;
}

/**
 * Resolve a server reference to a configured server name. Accepts an exact
 * server name, a final prefixed tool name (delegated to
 * resolveServerFromToolName), or a bare tool-name prefix (e.g. "github" for
 * server "github-mcp" under "short" mode).
 */
export function resolveServerRef(
  ref: string,
  servers: Array<{ name: string; prefix: ToolPrefix }>,
): string | undefined {
  const byToolName = resolveServerFromToolName(ref, servers);
  if (byToolName) return byToolName;
  // Exact bare-prefix match (only unambiguous single matches are accepted)
  const exact = servers.filter((s) => getServerPrefix(s.name, s.prefix) === ref);
  if (exact.length === 1) return exact[0]!.name;
  return undefined;
}

export const BUILTIN_NAMES = new Set([
  "read", "bash", "edit", "write", "grep", "find", "ls", "mcp",
]);
