/**
 * Local OAuth callback server for the `authorization_code` flow.
 *
 * The provider redirects the browser back to
 * `http://localhost:<port>/callback?code=...&state=...[&iss=...]`. This
 * singleton `node:http` server (bound to 127.0.0.1 only) validates the CSRF
 * `state` against waiters registered via {@link waitForCallback} (or states
 * pre-accepted via {@link reserveAuthState}) and hands the code straight to
 * the waiting promise — the code is never stored anywhere.
 *
 * Bind lifecycle:
 * - `ensureCallbackServer({ port: 0 })` binds an OS-assigned port (dynamic
 *   clients); `strictPort` binds the exact requested port (pre-registered
 *   clients with a fixed redirect URI) and rejects with a clear error naming
 *   the port on EADDRINUSE/EACCES.
 * - A `bindingPromise` mutex serializes concurrent binds. Joiners that
 *   requested the same target inherit its outcome (the resolved port on
 *   success, the clear error on failure); different-target callers wait out
 *   the in-flight bind but never inherit its failure, then rebind for
 *   themselves. A generation counter invalidates binds started before a
 *   `stopCallbackServer()`, so a stop racing an in-flight bind can never
 *   resurrect a dead server.
 *
 * Cancellation: `waitForCallback(state, signal)` rejects with
 * `"OAuth cancelled"` when the signal aborts, and `"OAuth callback timed
 * out"` after {@link CALLBACK_TIMEOUT_MS}.
 *
 * No external dependencies — `node:http`, `node:url` only.
 */

import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export const DEFAULT_CALLBACK_PORT = 19876;
export const DEFAULT_CALLBACK_PATH = "/callback";
/** How long a waiter blocks for the browser to complete the redirect. */
export const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

/** Successful callback resolution handed to the waiting auth flow. */
export interface OAuthCallbackResult {
  code: string;
  /** RFC 9207 issuer echoed in the redirect (multi-tenant providers). */
  iss?: string;
}

export interface EnsureCallbackServerOptions {
  /**
   * Bind exactly `port`. On EADDRINUSE/EACCES the returned promise rejects
   * with a clear error naming the port instead of falling back to a
   * different one.
   */
  strictPort?: boolean;
  /** Port to bind; `0` (and the default) lets the OS assign a free port. */
  port?: number;
  /** Path the handler accepts; default `/callback`. */
  path?: string;
}

/** The server holds an OAuth authorization code — loopback only. */
const HOST = "127.0.0.1";

interface RunningServer {
  server: Server;
  /** Actual bound port (resolved from the OS for port 0). */
  port: number;
  path: string;
}

interface PendingAuth {
  resolve: (result: OAuthCallbackResult) => void;
  reject: (error: Error) => void;
}

let running: RunningServer | undefined;
/** In-flight bind (mutex): concurrent ensureCallbackServer calls join it. */
let bindingPromise: Promise<number> | undefined;
/**
 * The requested target (port + path) of `bindingPromise`. Set together with
 * the promise, cleared when the bind settles; lets joiners tell a
 * same-target join (inherit the outcome) from a foreign-target wait (never
 * inherit that bind's failure).
 */
let bindingTarget: { port: number; path: string } | undefined;
/**
 * Bumped by stopCallbackServer(). A bind whose generation is stale at the
 * listening/error moment has been stopped mid-flight and must fail instead
 * of re-arming the singleton.
 */
let callbackGeneration = 0;
/** States a `waitForCallback` waiter is waiting on (map value wins). */
const pendingAuths = new Map<string, PendingAuth>();
/** States accepted by the handler before a waiter registers on them. */
const reservedAuthStates = new Set<string>();

/**
 * Callback port: `MCP_OAUTH_CALLBACK_PORT` override, else 19876.
 * Invalid values (non-numeric, out of 1–65535) fall back to the default.
 */
export function getCallbackPort(): number {
  const raw = process.env.MCP_OAUTH_CALLBACK_PORT;
  if (raw === undefined) return DEFAULT_CALLBACK_PORT;
  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) return parsed;
  return DEFAULT_CALLBACK_PORT;
}

export function getCallbackPath(): string {
  return DEFAULT_CALLBACK_PATH;
}

/**
 * Mark `oauthState` as an accepted CSRF state before a waiter exists for it
 * (keeps it accepted even once a waiter registers).
 */
export function reserveAuthState(oauthState: string): void {
  reservedAuthStates.add(oauthState);
}

/**
 * Ensure the singleton callback server is bound; resolves the actual
 * listening port. Reuses the running server when it satisfies the request
 * (same path; same exact port when `strictPort`). A rebind is required for a
 * different target, in which case the old server is stopped first.
 */
export async function ensureCallbackServer(
  opts: EnsureCallbackServerOptions = {},
): Promise<number> {
  const desiredPort = opts.port ?? 0;
  const desiredPath = opts.path ?? getCallbackPath();
  const strict = opts.strictPort ?? false;

  const satisfies = (s: RunningServer): boolean =>
    s.path === desiredPath && (!strict || s.port === desiredPort);

  // Join any in-flight bind, re-checking singleton state after each await.
  // While we wait, that bind may settle and a NEW bind may have started (a
  // different-target caller rebound right after a swallowed foreign
  // failure). Reusing the original captured promise to justify a second
  // `bindNewServer` here would bump the generation counter and invalidate
  // the newer still-in-flight bind, spuriously rejecting one of two
  // legitimate callers with "OAuth callback server stopped" — so the loop
  // rejoins a newer in-flight bind instead, keeping the `bindingPromise`
  // mutex serializing concurrent binds.
  while (true) {
    // Reuses the running server when it satisfies the request (same path;
    // same exact port when `strictPort`).
    if (running && satisfies(running)) {
      return running.port;
    }

    const pendingBind = bindingPromise;
    if (!pendingBind) {
      break; // nothing in flight — rebind below
    }

    // A bind may be in flight: same-target joiners inherit its outcome
    // (the resolved port on success, the clear error on failure);
    // different-target callers wait it out but never inherit its failure —
    // they rebind below.
    const sameTarget =
      bindingTarget?.port === desiredPort && bindingTarget?.path === desiredPath;
    try {
      await pendingBind;
    } catch (error) {
      if (sameTarget) throw error;
      // A foreign target's bind failed — not this caller's error. Loop
      // re-checks for a newer in-flight bind before rebounding.
      continue;
    }
    // Success: loop re-checks `running`/satisfies at the top and returns
    // the right port (or falls through to rebind if the server stopped
    // meanwhile).
  }

  if (running) {
    await stopCallbackServer();
  }

  return bindNewServer(desiredPort, desiredPath);
}

function bindNewServer(port: number, path: string): Promise<number> {
  const generation = ++callbackGeneration;
  const server = createServer(handleRequest);

  const binding = new Promise<number>((resolve, reject) => {
    let settled = false;

    const releaseMutex = (): void => {
      if (bindingPromise === binding) {
        bindingPromise = undefined;
        bindingTarget = undefined;
      }
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      releaseMutex();
      reject(error);
    };
    const succeed = (actualPort: number): void => {
      if (settled) return;
      settled = true;
      releaseMutex();
      resolve(actualPort);
    };

    server.once("error", (error: NodeJS.ErrnoException) => {
      if (generation !== callbackGeneration) {
        // Stopped while binding — stopCallbackServer() already took over.
        server.close(() => undefined);
        fail(new Error("OAuth callback server stopped"));
        return;
      }
      fail(describeBindError(error, port));
    });

    server.listen(port, HOST, () => {
      if (generation !== callbackGeneration) {
        // Stopped mid-bind: never resurrect a dead server.
        server.close(() => undefined);
        fail(new Error("OAuth callback server stopped"));
        return;
      }
      const address = server.address();
      const actualPort =
        address !== null && typeof address !== "string" ? address.port : port;
      running = { server, port: actualPort, path };
      succeed(actualPort);
    });
  });

  bindingTarget = { port, path };
  bindingPromise = binding;
  return binding;
}

function describeBindError(error: NodeJS.ErrnoException, port: number): Error {
  switch (error.code) {
    case "EADDRINUSE":
      return new Error(
        `Cannot bind OAuth callback server: port ${port} is already in use — ` +
          `stop the other process or change the callback port ` +
          `(MCP_OAUTH_CALLBACK_PORT, or the pre-registered redirect URI)`,
      );
    case "EACCES":
      return new Error(
        `Cannot bind OAuth callback server: no permission to bind port ${port}`,
      );
    default:
      return new Error(`Cannot bind OAuth callback server on port ${port}: ${error.message}`);
  }
}

/**
 * Wait for the callback for `oauthState`. Resolves `{ code, iss? }`.
 *
 * Rejects with:
 * - `"OAuth callback timed out"` after {@link CALLBACK_TIMEOUT_MS}
 * - `"OAuth cancelled"` when `signal` aborts (immediately, if already aborted)
 * - `"OAuth callback server stopped"` when the singleton is stopped
 * - the provider's `error` / `error_description` for a rejected redirect
 *
 * Registering a second waiter for the same state supersedes the first
 * (one state per flow); the superseded waiter rejects.
 */
export function waitForCallback(
  oauthState: string,
  signal?: AbortSignal,
): Promise<OAuthCallbackResult> {
  if (signal?.aborted) {
    return Promise.reject(new Error("OAuth cancelled"));
  }

  // A waiter now owns the state; a prior reservation is redundant.
  reservedAuthStates.delete(oauthState);

  return new Promise<OAuthCallbackResult>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onAbort = (): void => {
      finish(() => reject(new Error("OAuth cancelled")));
    };

    /** Settle at most once; releases the timer, abort listener, and state map entry. */
    const finish = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      if (pendingAuths.get(oauthState) === entry) {
        pendingAuths.delete(oauthState);
      }
      settle();
    };

    const entry: PendingAuth = {
      resolve: (result) => finish(() => resolve(result)),
      reject: (error) => finish(() => reject(error)),
    };

    // A state belongs to one flow: a new waiter supersedes the old one.
    const superseded = pendingAuths.get(oauthState);
    pendingAuths.set(oauthState, entry);
    if (superseded) {
      // Its own finish() clears the map entry (ownership check keeps the new
      // entry in place), the timer, and any abort listener.
      superseded.reject(new Error("OAuth callback waiter superseded"));
    }

    timer = setTimeout(() => {
      finish(() => reject(new Error("OAuth callback timed out")));
    }, CALLBACK_TIMEOUT_MS);

    if (signal) {
      signal.addEventListener("abort", onAbort);
    }
  });
}

/**
 * Stop the singleton: bumps the generation (killing in-flight binds), rejects
 * every pending waiter with `"OAuth callback server stopped"`, and closes the
 * server. Resolves once the server is fully closed. No-op when not running.
 */
export async function stopCallbackServer(): Promise<void> {
  callbackGeneration++;

  const inFlight = bindingPromise;
  bindingPromise = undefined;
  bindingTarget = undefined;

  for (const [state, pending] of [...pendingAuths]) {
    pendingAuths.delete(state);
    pending.reject(new Error("OAuth callback server stopped"));
  }

  const current = running;
  running = undefined;

  if (inFlight) {
    // The stale bind detects the generation change, closes its own server,
    // and rejects — swallow so an unawaited bind cannot crash the process.
    inFlight.catch(() => undefined);
  }

  if (!current) return;
  await closeServer(current.server);
}

function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolve) => {
    server.close(() => resolve());
    // Kill idle keep-alive sockets so close() completes promptly.
    server.closeAllConnections?.();
  });
}

/** Never throws out to the http server (a thrown handler would surface as a 500 crash). */
function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = running?.path ?? getCallbackPath();

    if (url.pathname !== path) {
      sendText(res, 404, "Not found");
      return;
    }

    const code = url.searchParams.get("code");
    const iss = url.searchParams.get("iss");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");

    // CSRF: state is required; identical responses do not leak which
    // states are pending, reserved, or unknown.
    if (!state) {
      sendText(res, 400, "Missing required state parameter");
      return;
    }

    const pending = pendingAuths.get(state);
    const isReserved = pending === undefined && reservedAuthStates.has(state);

    if (error) {
      if (!pending && !isReserved) {
        sendText(res, 400, "Invalid or expired state parameter");
        return;
      }
      const message = errorDescription || error;
      if (pending) {
        pendingAuths.delete(state);
        pending.reject(new Error(message));
      } else {
        reservedAuthStates.delete(state);
      }
      sendHtml(res, 200, htmlError(message));
      return;
    }

    if (!pending && !isReserved) {
      sendText(res, 400, "Invalid or expired state parameter");
      return;
    }

    if (!code) {
      if (pending) {
        pendingAuths.delete(state);
        pending.reject(
          new Error(
            "No authorization code received — re-run the auth flow and, if prompted, " +
              "paste the full callback URL from your browser address bar",
          ),
        );
      } else {
        reservedAuthStates.delete(state);
      }
      sendHtml(
        res,
        200,
        htmlManual(
          "The redirect completed without an authorization code. Re-run the auth " +
            "command in your terminal; if it prompts, paste the full callback URL " +
            "from your browser address bar.",
        ),
      );
      return;
    }

    if (pending) {
      pendingAuths.delete(state);
      pending.resolve({ code, ...(iss ? { iss } : {}) });
      sendHtml(res, 200, htmlSuccess());
    } else {
      // Accepted state but no live waiter (e.g. pi restarted mid-flow):
      // hand the hand-off off to the user manually.
      reservedAuthStates.delete(state);
      sendHtml(
        res,
        200,
        htmlManual(
          "Authorization succeeded, but no flow was waiting in the terminal. " +
            "Copy the full callback URL from your browser address bar, start the " +
            "auth command again, and paste it when prompted.",
        ),
      );
    }
  } catch {
    try {
      sendText(res, 500, "Internal error");
    } catch {
      // Response already destroyed — nothing left to do.
    }
  }
}

function sendText(res: ServerResponse, status: number, body: string): void {
  if (res.writableEnded) return;
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  if (res.writableEnded) return;
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

/** Self-contained, no external assets, light/dark aware via system colors. */
function htmlPage(
  title: string,
  badgeClass: "ok" | "err" | "info",
  badge: string,
  message: string,
  autoCloseMs?: number,
): string {
  const script = autoCloseMs
    ? `\n<script>\n\tsetTimeout(() => {\n\t\ttry { window.close(); } catch {\n\t\t\t/* browsers block programmatic close; the user closes manually */\n\t\t}\n\t}, ${autoCloseMs});\n</script>\n`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<title>${escapeHtml(title)}</title>
<style>
:root { color-scheme: light dark; }
body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: Canvas; color: CanvasText; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
.card { max-width: 26rem; margin: 1rem; padding: 2rem 1.75rem; border: 1px solid color-mix(in srgb, currentColor 25%, transparent); border-radius: 12px; text-align: center; }
.badge { display: inline-block; margin-bottom: 0.75rem; padding: 0.2rem 0.7rem; border-radius: 999px; font-size: 0.85rem; font-weight: 600; }
.ok { color: #1a7f37; background: rgba(26, 127, 55, 0.12); }
.err { color: #c62828; background: rgba(198, 40, 40, 0.12); }
.info { color: CanvasText; border: 1px solid color-mix(in srgb, currentColor 40%, transparent); }
h1 { margin: 0 0 0.5rem; font-size: 1.25rem; }
p { margin: 0; line-height: 1.5; font-size: 0.95rem; }
</style>
</head>
<body>
<div class="card">
<span class="badge ${badgeClass}">${escapeHtml(badge)}</span>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(message)}</p>
</div>${script}
</body>
</html>
`;
}

function htmlSuccess(): string {
  return htmlPage(
    "pi MCP — authentication complete",
    "ok",
    "Success",
    "The OAuth flow completed. You can close this window and return to the terminal.",
    2000,
  );
}

function htmlError(message: string): string {
  return htmlPage("pi MCP — authentication failed", "err", "Error", message);
}

function htmlManual(note: string): string {
  return htmlPage("pi MCP — manual hand-off", "info", "Copy & paste", note);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
