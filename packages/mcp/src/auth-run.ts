/**
 * Shared OAuth run (plan-026): the single place that wraps
 * `ServerClient.authenticate` — the SINGLE auth entry point — behind the
 * `BorderedLoader` progress UI (tui.md Pattern 2), the loader's
 * `onAbort` → `AbortController` cancellation, the "Opening browser…"
 * notification for the authorization URL, and the post-auth
 * close+reconnect that re-reads the freshly stored token from the keyring
 * into the Bearer header.
 *
 * Call sites: the `/mcp auth` command (`commands-auth.ts`) and the inline
 * auto-auth's UI branch (`auto-auth.ts`). Each maps the structured
 * `AuthRunOutcome` onto its own notification/return strings, which differ
 * between the two user-visible surfaces.
 */
import {
  BorderedLoader,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import open from "open";
import { recordClientOutcome } from "./metadata-cache.js";
import type { ServerClient, ServerStatus } from "./server-client.js";

/**
 * Outcome of an auth attempt.
 *
 * - `cancelled` — the loader was esc-closed OR the flow rejected with
 *   exactly "OAuth cancelled" (an external abort). Both call sites treat
 *   these identically.
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
    // No browser available — swallow; the caller's notification (if any)
    // still shows the URL so the user can visit it manually.
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
 * Run `ServerClient.authenticate` behind a `BorderedLoader` (esc aborts
 * the flow; the authorization URL is opened in the browser and announced
 * via an info notification) and, on success, perform the post-auth
 * close+reconnect.
 *
 * `ctx` must have a UI — headless callers (print/RPC) run the flow plainly
 * and reuse `openAuthUrl`/`reconnectAfterAuth` (see `autoAuthenticate`).
 */
export async function runAuthWithLoader(
  ctx: ExtensionContext,
  client: ServerClient,
  options: {
    /** Loader label, e.g. `Authenticating <server>… (esc to cancel)`. */
    loaderLabel: string;
  },
): Promise<AuthRunOutcome> {
  const controller = new AbortController();
  type LoaderOutcome =
    | { kind: "done" }
    | { kind: "error"; error: string }
    | null; // null = esc-closed loader
  const outcome = await ctx.ui.custom<LoaderOutcome>((tui, theme, _keybindings, done) => {
    const loader = new BorderedLoader(tui, theme, options.loaderLabel);
    let settled = false;
    const settle = (value: LoaderOutcome) => {
      if (!settled) {
        settled = true;
        done(value);
      }
    };
    loader.onAbort = () => {
      controller.abort();
      settle(null);
    };
    void client
      .authenticate({
        signal: controller.signal,
        onAuthorizationUrl: async (url: URL) => {
          await openAuthUrl(url.toString());
          ctx.ui.notify(
            `Opening browser… if it didn't open, visit: ${url.toString()}`,
            "info",
          );
        },
      })
      .then(
        () => settle({ kind: "done" }),
        // An esc-abort already settled `null`; this rejects with
        // "OAuth cancelled" and is swallowed by the settle guard.
        (e: unknown) => settle({ kind: "error", error: toMessage(e) }),
      );
    return loader;
  });
  if (outcome === null) return { kind: "cancelled" };
  if (outcome.kind === "error") {
    // A flow aborted from OUTSIDE the loader (agent abort) rejects with
    // "OAuth cancelled" — that is a cancellation, not a failure.
    if (outcome.error === "OAuth cancelled") return { kind: "cancelled" };
    return { kind: "flow-error", error: outcome.error };
  }

  return reconnectAfterAuth(client);
}
