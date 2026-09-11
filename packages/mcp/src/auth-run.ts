/**
 * Shared OAuth run: the single place that wraps `ServerClient.authenticate`
 * — the SINGLE auth entry point — behind a visible status indicator and
 * the post-auth close+reconnect that re-reads the freshly stored token from
 * the keyring into the Bearer header.
 *
 * Design (fixes the BorderedLoader bug):
 * - The authorization URL is surfaced via `ctx.ui.notify` BEFORE `open()` is
 *   called, so the user always sees it (the old BorderedLoader approach
 *   silently swallowed the notify because the loader re-painted over it).
 * - Progress is shown via `ctx.ui.setStatus` (non-blocking) instead of a
 *   custom UI that owns the screen.
 * - An `onAuthorizationInput` fallback is wired up so remote/headless users
 *   (where the browser redirect can't reach the local callback server) can
 *   paste the full callback URL and complete the flow.
 * - Cancellation is driven by an AbortController tied to the session signal
 *   (headless) or a separate controller the caller can abort (UI path).
 *
 * Call sites: the `/mcp auth` command (`commands-auth.ts`) and the inline
 * auto-auth's UI branch (`auto-auth.ts`). Each maps the structured
 * `AuthRunOutcome` onto its own notification/return strings, which differ
 * between the two user-visible surfaces.
 */
import {
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import open from "open";
import { recordClientOutcome } from "./metadata-cache.js";
import type { AuthenticateOptions } from "./auth-flow.js";
import type { ServerClient, ServerStatus } from "./server-client.js";

/**
 * Outcome of an auth attempt.
 *
 * - `cancelled` — the flow was aborted (signal or "OAuth cancelled" error).
 * - `flow-error` — the flow failed for a real reason; `error` carries the
 *   underlying message.
 * - `reconnect-failed` — auth succeeded but close/connect threw; `error`
 *   carries the underlying message.
 * - `reconnected` — close+connect succeeded; `status`/`tools` snapshot the
 *   client so callers can recheck (e.g. ADR 0001's needs-auth loop) and
 *   report the tool count without re-reading the client.
 */
export type AuthRunOutcome =
  | { kind: "cancelled" }
  | { kind: "flow-error"; error: string }
  | { kind: "reconnect-failed"; error: string }
  | { kind: "reconnected"; status: ServerStatus; tools: number };

function toMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Open the browser for an authorization URL, swallowing failures (no
 * browser available, headless). Callers decide how far to surface the URL.
 */
export async function openAuthUrl(url: string): Promise<void> {
  try {
    await open(url);
  } catch {
    // No browser available — swallow; the caller's notification already
    // shows the URL so the user can visit it manually.
  }
}

/**
 * Post-auth step, shared by every call site: close + reconnect the client
 * so the freshly stored token is used immediately (connect re-reads the
 * keyring for the Bearer header), then recheck the client.
 */
export async function reconnectAfterAuth(client: ServerClient): Promise<AuthRunOutcome> {
  try {
    try {
      await client.close();
      await client.connect();
    } finally {
      // ADR 0004 settle point: the post-auth close+reconnect is a genuine
      // connection settle — record the outcome so a successful auth clears
      // the stale "needs-auth" (and a failed reconnect leaves "error") in
      // the persisted ledger instead of sticking across sessions.
      recordClientOutcome(client);
    }
  } catch (e) {
    return { kind: "reconnect-failed", error: toMessage(e) };
  }
  return { kind: "reconnected", status: client.status, tools: client.tools.length };
}

/**
 * Run `ServerClient.authenticate` with a visible status indicator and an
 * `onAuthorizationInput` fallback for remote/headless environments.
 *
 * - The authorization URL is shown via `ctx.ui.notify` BEFORE `open()` fires,
 *   so it is always visible regardless of whether the browser opens.
 * - `ctx.ui.setStatus` tracks progress without owning the screen.
 * - `ctx.ui.confirm` + `ctx.ui.input` provide a manual-paste path for users
 *   whose browser redirect cannot reach the local callback server.
 * - On success the client is closed + reconnected so the fresh token is read
 *   from the keyring immediately.
 *
 * `ctx` must have a UI — headless callers (print/RPC) use `openAuthUrl` and
 * `reconnectAfterAuth` directly (see `autoAuthenticate` in `auto-auth.ts`).
 */
export async function runAuthWithLoader(
  ctx: ExtensionContext,
  client: ServerClient,
  options: {
    /** Status label, e.g. `Authenticating <server>…`. */
    loaderLabel: string;
  },
): Promise<AuthRunOutcome> {
  const statusKey = `mcp-auth-${client.name}`;
  ctx.ui.setStatus(statusKey, options.loaderLabel);

  try {
    const opts: AuthenticateOptions = {
      onAuthorizationUrl: async (url: URL) => {
        const urlStr = url.toString();
        // Notify FIRST so the URL is visible before open() fires — the old
        // BorderedLoader approach re-painted over this notification silently.
        ctx.ui.notify(
          `Opening browser for ${client.name}… if it didn't open, visit:\n${urlStr}`,
          "info",
        );
        await openAuthUrl(urlStr);
      },
      onAuthorizationInput: async (url: URL, signal: AbortSignal) => {
        // Fallback for remote/headless: ask the user to paste the callback URL.
        const urlStr = url.toString();
        const confirmed = await ctx.ui.confirm(
          `Authenticate ${client.name}`,
          `Open this URL in your browser:\n${urlStr}\n\nAfter approving, select Yes to paste the callback URL.`,
          { signal },
        );
        if (!confirmed || signal.aborted) return undefined;
        return ctx.ui.input(
          `Complete ${client.name} OAuth`,
          "Paste the full callback URL from your browser address bar",
          { signal },
        );
      },
    };

    try {
      await client.authenticate(opts);
    } catch (e) {
      const msg = toMessage(e);
      if (msg === "OAuth cancelled") return { kind: "cancelled" };
      return { kind: "flow-error", error: msg };
    }

    return reconnectAfterAuth(client);
  } finally {
    ctx.ui.setStatus(statusKey, undefined);
  }
}
