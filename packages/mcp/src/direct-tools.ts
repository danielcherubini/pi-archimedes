import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { BUILTIN_NAMES, findFormattingCollisions, formatToolName } from "./tool-naming.js";
import { autoAuthenticate, needsAuthToolResult } from "./auto-auth.js";
import type { CachedTool, ToolPrefix } from "./types.js";
import type { ServerClient } from "./server-client.js";
import { renderDirectCall, renderDirectResult, type RenderContext } from "./renderer.js";

/**
 * Track which final prefixed tool names have been registered, at module
 * level, keyed by SERVER name. Registration is cache-driven (no live client
 * to key on anymore), and pi's tool registry cannot accept the same name
 * twice. Each registration pass REPLACES the server's set with the names
 * claimed in that pass, so stale entries from shrunken tool lists are
 * evicted and a later session_start can re-register (pi can never
 * unregister; the module-level set only gates re-registration). Entries for
 * servers that are no longer configured are pruned by
 * pruneRegisteredNames() at session_start — without that, a removed server's
 * claimed names would block a surviving server from claiming the same final
 * name (e.g. under toolPrefix "none"). Within one process the dedup check
 * still spans ALL servers' sets, so two servers that would format to the
 * same final name (e.g. identical raw names under toolPrefix "none") never
 * double-register. The module is re-imported by the extension loader on
 * /reload, which resets this map for the fresh pi registry.
 */
const registeredNames = new Map<string, Set<string>>();

/**
 * Per-server formatted-name collisions already warned about (module-level so
 * repeated registration passes don't re-warn for the same collision). Key:
 * serverName + finalName + raw names. Reset by clearRegisteredForTest.
 */
const warnedCollisions = new Set<string>();

/** Test-only: reset the module-level registration state. */
export function clearRegisteredForTest(): void {
  registeredNames.clear();
  warnedCollisions.clear();
}

/** Test-only: snapshot of the per-server registered (prefixed) names. */
export function getRegisteredNamesForTest(): ReadonlyMap<string, ReadonlySet<string>> {
  return registeredNames;
}

/** True when ANY server has already claimed this final prefixed name */
function isClaimed(name: string): boolean {
  for (const set of registeredNames.values()) {
    if (set.has(name)) return true;
  }
  return false;
}

/**
 * Drop tracked entries for servers that are no longer configured, freeing
 * their claimed final names for re-registration by surviving servers
 * (e.g. a removed server that claimed "foo" under toolPrefix "none" must
 * not block a remaining server that exposes a raw tool named "foo").
 * Call at session_start with the set of currently configured server names,
 * before the registration pass.
 */
export function pruneRegisteredNames(activeServerNames: ReadonlySet<string>): void {
  for (const name of [...registeredNames.keys()]) {
    if (!activeServerNames.has(name)) registeredNames.delete(name);
  }
}

/** Per-server direct-tool filtering knobs (subset of EffectiveServerSettings) */
export interface DirectToolFilter {
  /** true = all, string[] = subset of raw tool names */
  directTools: boolean | string[];
  /** Only expose these tools (whitelist) */
  includeTools?: string[];
  /** Never expose these tools (blacklist) */
  excludeTools?: string[];
}

/**
 * Apply per-server direct-tool filtering to a tool list:
 * directTools (true → passthrough, string[] → subset), then includeTools
 * (intersect), then excludeTools (subtract).
 */
export function filterDirectTools(
  tools: CachedTool[],
  filter: DirectToolFilter,
): CachedTool[] {
  if (filter.directTools === false) return [];
  let out = tools;
  if (Array.isArray(filter.directTools)) {
    const subset = new Set(filter.directTools);
    out = out.filter((t) => subset.has(t.name));
  }
  if (filter.includeTools !== undefined) {
    const include = new Set(filter.includeTools);
    out = out.filter((t) => include.has(t.name));
  }
  if (filter.excludeTools !== undefined) {
    const exclude = new Set(filter.excludeTools);
    out = out.filter((t) => !exclude.has(t.name));
  }
  return out;
}

export interface RegisterDirectToolsOptions {
  serverName: string;
  /** Tool-name prefix strategy already resolved over the global config */
  prefix: ToolPrefix;
  /** Tools to register (raw server tool names, from cache or discovery) */
  tools: CachedTool[];
  /**
   * Whether a needs-auth server auto-triggers interactive OAuth at call time.
   * Read at CALL time (fresh config), not registration time — mirrors the
   * proxy call action.
   */
  autoAuth?: () => boolean;
  /** Lazily resolve (and connect, if needed) the owning client at call time */
  resolveClient: (serverName: string) => Promise<ServerClient>;
}

/**
 * Register a server's tools as individual pi tools.
 * Skips tools whose final prefixed name was already claimed (by this server
 * in an earlier pass OR by any other server) — the returned list includes
 * those skipped names, so callers see the full intended set.
 * Skips tools whose final prefixed name would shadow a pi builtin (e.g. a bare
 * "read" under toolPrefix "none") — warns instead so the collision is visible.
 * Warns once per distinct collision when TWO raw tools of this server format
 * to the same final name (e.g. "a.b" and "a_b") — an inherent, non-injective
 * ambiguity of the name format, not a bug in registration.
 * The executor resolves the live client LAZILY at call time via
 * options.resolveClient — no client is connected at registration time.
 * After the pass, the server's tracked set is REPLACED by the names claimed
 * in this pass (evicting stale entries from removed servers / shrunken lists).
 * Returns the list of (claimed) prefixed tool names so they can be tracked.
 */
export function registerDirectTools(
  pi: ExtensionAPI,
  options: RegisterDirectToolsOptions,
): string[] {
  const { serverName, prefix, tools, resolveClient, autoAuth = () => false } = options;
  const registered: string[] = [];

  // Surface ambiguous raw tool names: formatToolName is not injective, so
  // e.g. "a.b" and "a_b" both format to the same final name and name
  // resolution would be first-match-wins. Warn once per distinct collision.
  for (const { finalName, rawNames } of findFormattingCollisions(serverName, prefix, tools)) {
    const key = `${serverName}\u0000${finalName}\u0000${rawNames.join(",")}`;
    if (warnedCollisions.has(key)) continue;
    warnedCollisions.add(key);
    console.warn(
      `[mcp] server "${serverName}": tools ${rawNames.map((n) => `"${n}"`).join(" and ")} both format to "${finalName}" — name resolution is ambiguous (first match wins)`,
    );
  }

  // The names this pass INTENDS to own (non-builtin, formatted). After the
  // pass, this becomes the server's tracked set — evicting stale entries
  // from earlier passes.
  const intendedThisPass = new Set<string>();

  for (const tool of tools) {
    const prefixedName = formatToolName(tool.name, serverName, prefix);

    // Never shadow a pi builtin tool name (matters mainly for toolPrefix "none")
    if (BUILTIN_NAMES.has(prefixedName)) {
      console.warn(
        `[mcp] skipping tool "${tool.name}" from server "${serverName}": "${prefixedName}" collides with a built-in tool name`,
      );
      continue;
    }
    intendedThisPass.add(prefixedName);

    // Skip registration if this final prefixed name was already claimed — by
    // this server in an earlier pass OR by another server (guards against
    // repeated session_start / probe passes and cross-server collisions)
    if (isClaimed(prefixedName)) {
      registered.push(prefixedName);
      continue;
    }

    // Accept any object — we let the MCP server validate args against its own schema
    const parameters = Type.Object({}, { additionalProperties: true });

    pi.registerTool({
      name: prefixedName,
      label: `MCP: ${tool.name}`,
      description: `[${serverName}] ${tool.description ?? "(no description)"}`,
      parameters,

      renderCall(args: unknown, theme: Theme, context: unknown) {
        const typedContext = context as RenderContext;
        return renderDirectCall(
          prefixedName,
          args as Record<string, unknown>,
          theme,
          typedContext,
        );
      },

      renderResult(result: unknown, options: unknown, theme: Theme, context: unknown) {
        const typedResult = result as {
          content: Array<{ type: string; text?: string }>;
          details?: Record<string, unknown>;
        };
        const typedOptions = options as { expanded?: boolean; isPartial?: boolean };
        const typedContext = context as RenderContext;
        return renderDirectResult(prefixedName, typedResult, typedOptions, theme, typedContext);
      },

      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        const args = params as Record<string, unknown>;
        // Lazy connect: resolve (and connect, if needed) the owning client NOW,
        // not at registration time.
        const client = await resolveClient(serverName);
        // needs-auth at call time: guidance by default, inline auto-auth +
        // one retry when enabled (mirrors the proxy call action).
        if (client.status === "needs-auth") {
          if (!autoAuth()) {
            return needsAuthToolResult(serverName);
          }
          const outcome = await autoAuthenticate(ctx, client);
          if (!outcome.proceed) {
            return needsAuthToolResult(serverName, outcome.error);
          }
        }
        // The call below is the (single) retry after a successful auto-auth
        const result = await client.callTool(tool.name, args, signal);
        // Cast MCP ContentBlock[] to pi's (TextContent | ImageContent)[]
        // Both are discriminated unions on `type`; we only surface text + image blocks
        const content = result.content as Array<
          | { type: "text"; text: string }
          | { type: "image"; data: string; mimeType: string }
        >;
        return {
          content,
          details: { server: client.name, tool: tool.name },
          isError: result.isError,
        };
      },
    });

    registered.push(prefixedName);
  }

  // Replace this server's tracked set with the names intended in this pass,
  // evicting stale entries from earlier (larger) passes so a later
  // session_start can re-register shrunken/changed tool lists.
  registeredNames.set(serverName, intendedThisPass);

  return registered;
}
