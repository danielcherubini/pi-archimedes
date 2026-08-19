/**
 * Shared OAuth helpers for the `/mcp` command family.
 *
 * The standalone `/mcp-auth` and `/mcp-logout` commands are retired; the
 * `/mcp auth <server>` and `/mcp logout <server>` subcommands (dispatched in
 * `commands.ts`) call these two functions instead. The UX is unchanged from
 * plan-026.
 *
 * `runMcpAuthCommand` runs the OAuth flow through the server client's
 * SINGLE auth entry point (`ServerClient.authenticate`) while a
 * `BorderedLoader` (tui.md Pattern 2) shows progress. Esc fires the
 * loader's `onAbort`, which forwards to the flow's `AbortController`; the
 * cancelled flow rethrows "OAuth cancelled", so cancel and failure stay
 * distinguishable in the notification. On success the client is closed and
 * reconnected, which re-reads the freshly stored token.
 *
 * `mcpLogoutServer` deletes the keyring entry and closes the managed client
 * (if any) so the next connect re-evaluates auth.
 *
 * The command layer never calls the auth-flow module directly: the
 * url/oauth config always come from the client's server definition.
 */
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { deleteAuthEntry } from "./auth-storage.js";
import { extractOAuthConfig } from "./auth-flow.js";
import { runAuthWithLoader } from "./auth-run.js";
import type { ServerManager } from "./server-manager.js";
import type { HttpServerDef } from "./types.js";

export interface McpAuthCommandDeps {
  /**
   * Fresh-config lookup. Only http/sse defs are returned (stdio servers
   * cannot OAuth) — anything else, including unknown or stdio servers,
   * yields undefined.
   */
  getServerDef: (name: string) => HttpServerDef | undefined;
  /** Module-level server manager (session-resilient getter). */
  getManager: () => ServerManager;
}

/**
 * The former `/mcp-auth <server>` handler body, extracted so the `/mcp auth`
 * subcommand reuses the full command-layer UX (BorderedLoader +
 * notifications) unchanged. (The management panel authenticates in-panel
 * instead — ADR 0005 — reusing only the shared plumbing in `auth-run.ts`.)
 * `serverName` must be non-empty — the dispatcher enforces that.
 */
export async function runMcpAuthCommand(
  serverName: string,
  ctx: ExtensionCommandContext,
  deps: McpAuthCommandDeps,
): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("/mcp auth requires an interactive TUI", "error");
    return;
  }

  const def = deps.getServerDef(serverName);
  if (!def) {
    ctx.ui.notify(`Unknown server: ${serverName}`, "error");
    return;
  }
  if (!extractOAuthConfig(def.auth)) {
    ctx.ui.notify(`Server ${serverName} is not configured for OAuth`, "error");
    return;
  }
  const client = deps.getManager().getClient(serverName);
  if (!client) {
    ctx.ui.notify(
      `Server ${serverName} is not managed yet — start a new session and try again`,
      "error",
    );
    return;
  }

  // Esc in the loader aborts the flow; aborts (esc or the agent's own)
  // surface as "cancelled", other failures keep their message.
  const outcome = await runAuthWithLoader(ctx, client, {
    loaderLabel: `Authenticating ${serverName}… (esc to cancel)`,
  });
  if (outcome.kind === "cancelled") {
    ctx.ui.notify("Authentication cancelled", "info");
    return;
  }
  if (outcome.kind === "flow-error") {
    ctx.ui.notify(outcome.error, "error");
    return;
  }
  if (outcome.kind === "reconnect-failed") {
    // Close + reconnect failed after a successful flow.
    ctx.ui.notify(
      `${serverName} is authenticated, but reconnecting failed: ${outcome.error}`,
      "error",
    );
    return;
  }
  // Success: the client was closed + reconnected so the fresh token is
  // used immediately (connect re-reads the keyring for the Bearer
  // header); the outcome snapshots its post-reconnect status.
  if (outcome.status === "connected") {
    ctx.ui.notify(
      `✓ ${serverName} authenticated — ${outcome.tools} tools available`,
      "info",
    );
  } else {
    ctx.ui.notify(`✓ ${serverName} authenticated and reconnected`, "info");
  }
}

/**
 * The former `/mcp-logout <server>` handler body, extracted so the
 * `/mcp logout` subcommand reuses it.
 * Deletes the keyring entry, closes the managed client (if any) so the next
 * connect re-evaluates auth with the entry gone. Fail-closed: a keyring
 * error is returned, not thrown.
 */
export function mcpLogoutServer(name: string, getManager: () => ServerManager): { ok: boolean; error?: string } {
  try {
    deleteAuthEntry(name);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  // Close the managed client (if any) so the next connect re-evaluates
  // auth with the entry now gone.
  getManager().getClient(name)?.close();
  return { ok: true };
}
