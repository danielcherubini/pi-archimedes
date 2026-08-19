/**
 * `/mcp-auth` and `/mcp-logout` commands (plan-026).
 *
 * `/mcp-auth <server>` runs the OAuth flow through the server client's
 * SINGLE auth entry point (`ServerClient.authenticate`) while a
 * `BorderedLoader` (tui.md Pattern 2) shows progress. Esc fires the
 * loader's `onAbort`, which forwards to the flow's `AbortController`; the
 * cancelled flow rethrows "OAuth cancelled", so cancel and failure stay
 * distinguishable in the notification. On success the client is closed and
 * reconnected, which re-reads the freshly stored token.
 *
 * The loader/cancel/open-URL/reconnect machinery is shared with the inline
 * auto-auth in `auth-run.ts`; this module maps the structured outcome onto
 * its own user-facing notifications.
 *
 * `/mcp-logout <server>` deletes the keyring entry and closes the
 * managed client (if any) so the next connect re-evaluates auth.
 *
 * The command layer never calls the auth-flow module directly: the
 * url/oauth config always come from the client's server definition.
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { deleteAuthEntry } from "./auth-storage.js";
import { extractOAuthConfig } from "./auth-flow.js";
import { runAuthWithLoader } from "./auth-run.js";
import type { ServerManager } from "./server-manager.js";
import type { HttpServerDef } from "./types.js";

export interface AuthCommandDeps {
  /**
   * Fresh-config lookup. Only http/sse defs are returned (stdio servers
   * cannot OAuth) — anything else, including unknown or stdio servers,
   * yields undefined.
   */
  getServerDef: (name: string) => HttpServerDef | undefined;
  /** Module-level server manager (session-resilient getter). */
  getManager: () => ServerManager;
}

export function registerAuthCommands(
  pi: ExtensionAPI,
  deps: AuthCommandDeps,
): void {
  pi.registerCommand("mcp-auth", {
    description: "Authenticate an MCP server via OAuth (Usage: /mcp-auth <server>)",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/mcp-auth requires an interactive TUI", "error");
        return;
      }
      const name = args.trim().split(/\s+/)[0] ?? "";
      if (!name) {
        ctx.ui.notify("Usage: /mcp-auth <server>", "info");
        return;
      }

      const def = deps.getServerDef(name);
      if (!def) {
        ctx.ui.notify(`Unknown server: ${name}`, "error");
        return;
      }
      if (!extractOAuthConfig(def.auth)) {
        ctx.ui.notify(`Server ${name} is not configured for OAuth`, "error");
        return;
      }
      const client = deps.getManager().getClient(name);
      if (!client) {
        ctx.ui.notify(
          `Server ${name} is not managed yet — start a new session and try again`,
          "error",
        );
        return;
      }

      // Esc in the loader aborts the flow; aborts (esc or the agent's own)
      // surface as "cancelled", other failures keep their message.
      const outcome = await runAuthWithLoader(ctx, client, {
        loaderLabel: `Authenticating ${name}… (esc to cancel)`,
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
          `${name} is authenticated, but reconnecting failed: ${outcome.error}`,
          "error",
        );
        return;
      }
      // Success: the client was closed + reconnected so the fresh token is
      // used immediately (connect re-reads the keyring for the Bearer
      // header); the outcome snapshots its post-reconnect status.
      if (outcome.status === "connected") {
        ctx.ui.notify(
          `✓ ${name} authenticated — ${outcome.tools} tools available`,
          "info",
        );
      } else {
        ctx.ui.notify(`✓ ${name} authenticated and reconnected`, "info");
      }
    },
  });

  pi.registerCommand("mcp-logout", {
    description: "Clear stored OAuth credentials for an MCP server (Usage: /mcp-logout <server>)",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const name = args.trim().split(/\s+/)[0] ?? "";
      if (!name) {
        ctx.ui.notify("Usage: /mcp-logout <server>", "info");
        return;
      }
      try {
        deleteAuthEntry(name);
      } catch (e) {
        ctx.ui.notify(
          `Could not log out of ${name}: ${e instanceof Error ? e.message : String(e)}`,
          "error",
        );
        return;
      }
      // Close the managed client (if any) so the next connect re-evaluates
      // auth with the entry now gone.
      deps.getManager().getClient(name)?.close();
      ctx.ui.notify(`Logged out of ${name}`, "info");
    },
  });
}
