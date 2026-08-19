/**
 * Tool-call-time `needs-auth` handling, shared by the `mcp` proxy's call
 * action and the direct-tool executor (plan-026, Task 7).
 *
 * When the owning server's client is in the `needs-auth` state at call time:
 *
 * - autoAuth disabled (default): no authentication is initiated; the caller
 *   returns guidance content (`isError: false` — guidance, not a crash)
 *   telling the user to run `/mcp-auth <server>`.
 * - autoAuth enabled: `ServerClient.authenticate` (the SINGLE auth entry
 *   point — never `auth-flow.authenticate` directly) is called inline and the
 *   caller retries the tool call once. A `BorderedLoader` (tui.md Pattern 2,
 *   same pattern as `/mcp-auth`) shows progress when the execute context has
 *   UI; esc aborts the flow. Headless contexts run the flow plainly and the
 *   authorization URL is opened directly.
 *
 * The loader/cancel/reconnect machinery is shared with `/mcp-auth` in
 * `auth-run.ts`; this module maps the structured outcome onto the tool's
 * `{ proceed, error }` guidance result.
 */
import { type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  openAuthUrl,
  reconnectAfterAuth,
  runAuthWithLoader,
  type AuthRunOutcome,
} from "./auth-run.js";
import type { AuthenticateOptions } from "./auth-flow.js";
import type { ServerClient } from "./server-client.js";

/** Tool result for a needs-auth server: guidance, not a crash. */
export interface NeedsAuthToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: { server: string; status: "needs-auth" };
  isError: false;
}

/**
 * Guidance result for a needs-auth server. `autoAuthError` is only set when
 * autoAuth was enabled but the inline flow was cancelled or failed.
 */
export function needsAuthToolResult(
  serverName: string,
  autoAuthError?: string,
): NeedsAuthToolResult {
  const lines = [`MCP server "${serverName}" requires authentication.`];
  if (autoAuthError !== undefined) lines.push(`Auto-auth failed: ${autoAuthError}`);
  lines.push(`Run /mcp-auth ${serverName} to authenticate, then retry this call.`);
  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    details: { server: serverName, status: "needs-auth" },
    isError: false,
  };
}

/** Outcome of an inline auto-auth attempt. */
export interface AutoAuthOutcome {
  /** True when the flow succeeded AND the client was reconnected — the caller should retry the call once. */
  proceed: boolean;
  /** Error text for the guidance result when proceed is false. */
  error?: string;
}

function toMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Map the shared auth-run outcome onto the tool's guidance result. */
function toAutoAuthOutcome(outcome: AuthRunOutcome, serverName: string): AutoAuthOutcome {
  switch (outcome.kind) {
    case "cancelled":
      return { proceed: false, error: "OAuth cancelled" };
    case "flow-error":
      return { proceed: false, error: outcome.error };
    case "reconnect-failed":
      return {
        proceed: false,
        error: `authenticated, but reconnecting ${serverName} failed: ${outcome.error}`,
      };
    case "reconnected":
      if (outcome.status === "needs-auth") {
        // The freshly stored token was rejected immediately — e.g. a
        // pre-registered public client whose session needs interactive
        // re-auth (ADR 0001). Guidance points back at /mcp-auth.
        return {
          proceed: false,
          error: "auth succeeded, but the server still requires authentication",
        };
      }
      return { proceed: true };
  }
}

/**
 * Run `ServerClient.authenticate` inline.
 *
 * With a UI context the flow is wrapped in a `BorderedLoader` (same pattern
 * as `/mcp-auth`): esc aborts the flow and the cancellation is reported as
 * "OAuth cancelled". Without one (print/RPC mode) the flow runs plainly,
 * tied to the agent's abort signal when streaming.
 *
 * On success the client is closed and reconnected so the freshly stored
 * token is re-read into the Bearer header (mirrors `/mcp-auth`). Cancellation,
 * flow failure, and reconnect failure are returned as errors rather than
 * thrown into the tool call.
 */
export async function autoAuthenticate(
  ctx: ExtensionContext | undefined,
  client: ServerClient,
): Promise<AutoAuthOutcome> {
  if (ctx?.hasUI) {
    return toAutoAuthOutcome(
      await runAuthWithLoader(ctx, client, {
        loaderLabel: `Authenticating ${client.name}… (esc to cancel)`,
      }),
      client.name,
    );
  }

  try {
    // Headless: no loader to cancel with — when the agent is streaming,
    // tie the flow to its abort signal instead.
    const opts: AuthenticateOptions = {
      onAuthorizationUrl: (url: URL) => openAuthUrl(url.toString()),
    };
    if (ctx?.signal) opts.signal = ctx.signal;
    await client.authenticate(opts);
  } catch (e) {
    return { proceed: false, error: toMessage(e) };
  }

  // Success: close + reconnect so the fresh token is used immediately
  // (connect re-reads the keyring for the Bearer header — mirrors /mcp-auth)
  return toAutoAuthOutcome(await reconnectAfterAuth(client), client.name);
}
