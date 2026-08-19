/**
 * The `/mcp panel` management panel (plan-027, Task 3).
 *
 * Mode-based `string[]` overlay component built on the shared overlay chrome
 * (`@pi-archimedes/core/overlay`) — structurally identical to the `/agents`
 * manager (`packages/subagent/src/agent-manager.ts`): `renderHeader` at top,
 * a cursor-highlighted flat list of expandable server→tools rows, bracket-
 * hinted `renderFooter` lines at the bottom, everything wrapped by
 * `wrapWithBorder` (ADR 0003). No pi-tui `SelectList`/`DynamicBorder`/
 * `Input`/`Focusable`.
 *
 * States and keys (filter = self-managed string, agent-manager style):
 * - flat list of servers; `enter` expands/collapses (EXCEPT on a needs-auth
 *   server: `enter` runs the in-panel OAuth flow — ADR 0005)
 * - `space` toggles the direct-tools selection (server row → all of its
 *   tools as a group; tool row → the single tool); dirty servers tracked via
 *   `changedServers` (any tool with isDirect !== wasDirect) for the save
 * - `e` enables/disables (writeServerDisabled + client teardown on disable;
 *   identical semantics to `/mcp enable|disable`), `l` logs out
 *   (mcpLogoutServer), `r` reconnects + records the settled outcome
 *   (ADR 0004), `a` authenticates (in-panel, same flow as `enter`)
 * - `/` begins filter mode: printable chars (incl. space) append, backspace
 *   edits; while the filter is non-empty, e/l/a/r are INERT (so their
 *   letters can be typed into the query) and `esc`/`ctrl+c` still close
 * - `ctrl+s` writes `directTools` for each changed server
 *   (writeServerDirectTools), notifies "/reload to apply", closes
 * - `esc`/`ctrl+c` outside `authing`: close, discard (unsaved toggles are
 *   lost, by design — no confirm)
 *
 * Status resolution (ADR 0004): a LIVE client with a verified status
 * (connected / needs-auth / error) wins; else the persisted outcome from
 * `loadMetadataCache().serverStatuses` (with the staleness suffix from its
 * `at` timestamp); else "cached". `def.disabled === true` always renders
 * "disabled". Every in-panel settle point (auth reconnect, manual
 * reconnect) records the outcome via `recordClientOutcome` (→ the single
 * `recordServerOutcome` recorder).
 *
 * In-panel auth (ADR 0005): the panel does NOT reuse `runAuthWithLoader`
 * (the command-path BorderedLoader presentation). It enters an `authing`
 * substate rendered as a transient notice line; only the UX-neutral shared
 * plumbing is reused: `ServerClient.authenticate` (single flow entry point),
 * `openAuthUrl`, `reconnectAfterAuth`/`AuthRunOutcome`. `esc` aborts via the
 * flow's AbortController (surfaces as a CANCELLATION, not an error);
 * `ctrl+c` aborts AND closes the panel; every other key is ignored until
 * the flow settles.
 */
import { CURSOR_MARKER, Key, matchesKey } from "@earendil-works/pi-tui";
import type { TUI } from "@earendil-works/pi-tui";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  OVERLAY_CHROME,
  borderContentWidth,
  hardTruncate,
  padEnd,
  renderFooter,
  renderHeader,
  visibleWidth,
  wrapWithBorder,
} from "@pi-archimedes/core/overlay";
import { extractOAuthConfig } from "./auth-flow.js";
import { openAuthUrl, reconnectAfterAuth, type AuthRunOutcome } from "./auth-run.js";
import { mcpLogoutServer } from "./commands-auth.js";
import { isHttpDef, loadMcpConfig, resolveServerSettings } from "./config.js";
import { writeServerDisabled, writeServerDirectTools } from "./config-write.js";
import { loadMetadataCache, recordClientOutcome } from "./metadata-cache.js";
import type { ServerManager } from "./server-manager.js";
import type { ServerStatus } from "./server-client.js";
import type { CachedTool, McpConfig, ServerDef, ServerOutcomeRecord } from "./types.js";

// ── State shapes ─────────────────────────────────────────────────────────────

export interface ToolRow {
  name: string;
  description: string;
  /** Current direct-tools selection state (what ctrl+s would write). */
  isDirect: boolean;
  /** Direct state as resolved from config when the panel opened (dirty baseline). */
  wasDirect: boolean;
}

export type ServerRowStatus = "connected" | "cached" | "needs-auth" | "disabled" | "error";

export interface ServerRow {
  name: string;
  expanded: boolean;
  status: ServerRowStatus;
  /** First-line error text for needs-auth/error rows. */
  failureMessage?: string;
  /** Timestamp of the persisted outcome that drove this row ("X ago" suffix). */
  statusAt?: number;
  tools: ToolRow[];
  /** True when valid cached tool metadata exists for this server. */
  hasCachedData: boolean;
}

/** One navigable line in the flat visible list. */
export type VisibleRow =
  | { kind: "server"; server: ServerRow }
  | { kind: "tool"; server: ServerRow; tool: ToolRow };

/** Dependencies injected by commands.ts — the seams the panel touches. */
export interface McpPanelDeps {
  /** loadAllServerDefs() — INCLUDES disabled servers (they have status). */
  getServerDefs: () => Record<string, ServerDef>;
  getCachedTools: (serverName: string, def: ServerDef) => CachedTool[] | undefined;
  /** Module-level singleton via getter (session-resilient across /reload). */
  getManager: () => ServerManager;
}

// ── Pure helpers (exported for unit tests) ───────────────────────────────────

/**
 * Flat list of visible rows: every server in order; an EXPANDED server's
 * tool rows interleave immediately after its own row (in tool order).
 * Collapsed servers contribute only their server row.
 */
export function buildVisibleRows(servers: ServerRow[]): VisibleRow[] {
  const rows: VisibleRow[] = [];
  for (const s of servers) {
    rows.push({ kind: "server", server: s });
    if (s.expanded) {
      for (const t of s.tools) {
        rows.push({ kind: "tool", server: s, tool: t });
      }
    }
  }
  return rows;
}

/**
 * Filter servers for the `[/] search` box: case-insensitive substring over
 * the server name AND every tool's name/description (a server is kept when
 * any of those matches). Empty query passes the original array through
 * unchanged (same reference).
 */
export function filterRows(servers: ServerRow[], query: string): ServerRow[] {
  if (query.length === 0) return servers;
  const q = query.toLowerCase();
  return servers.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.tools.some(
        (t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
      ),
  );
}

/** Flip one tool's direct selection without touching wasDirect. */
export function toggleTool(tool: ToolRow): void {
  tool.isDirect = !tool.isDirect;
}

/**
 * The per-server save value derived from tool isDirect states (same rule as
 * the agent-manager tool picker): all direct → `true`, none direct →
 * `false`, otherwise the exact subset of direct tool names in row order.
 * An empty tool list counts as "all direct" → `true`.
 */
export function computeSelection(toolRows: ToolRow[]): true | false | string[] {
  if (toolRows.every((t) => t.isDirect)) return true;
  if (toolRows.every((t) => !t.isDirect)) return false;
  return toolRows.filter((t) => t.isDirect).map((t) => t.name);
}

// ── Small display helpers ────────────────────────────────────────────────────

function firstLine(text: string | null | undefined): string | undefined {
  const line = text?.split("\n")[0]?.trim();
  return line === undefined || line.length === 0 ? undefined : line;
}

/**
 * Staleness formatting for persisted outcomes (ADR 0004). Deliberately
 * duplicated from commands.ts instead of imported: commands.ts lazily loads
 * THIS module for /mcp panel, so a static import back would create a cycle.
 */
function formatAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${Math.max(1, s)}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  if (d < 45) return `${Math.max(1, Math.round(d / 7))}w ago`;
  return `${Math.max(1, Math.round(d / 30))}mo ago`;
}

/** "(X ago)" — omitted for fresh (<1m) entries or unknown timestamps. */
function ageSuffix(at: number | undefined): string {
  if (at === undefined) return "";
  const age = Date.now() - at;
  if (age < 60_000) return "";
  return ` (${formatAge(age)})`;
}

// ── Row seeding ──────────────────────────────────────────────────────────────

interface RowSources {
  globalConfig: McpConfig;
  outcomes: Record<string, ServerOutcomeRecord>;
  manager: ServerManager;
  getCachedTools: (name: string, def: ServerDef) => CachedTool[] | undefined;
}

/** Verified connection states — the only ones a row may claim live. */
function isVerifiedStatus(s: ServerStatus): s is "connected" | "needs-auth" | "error" {
  return s === "connected" || s === "needs-auth" || s === "error";
}

/**
 * Build/refresh one ServerRow from (defs, live manager, persisted outcomes,
 * cache). Status: `disabled` wins; a live client whose captured status is
 * VERIFIED (connected/needs-auth/error) wins next — "disconnected"/
 * "connecting" are not verified, so ADR 0004 falls back to the persisted
 * outcome; then the outcome (a persisted `connected` reads as "cached", i.e.
 * was connected across sessions); else "cached". Tools: live (only while
 * connected) wins over valid cache; wasDirect/isDirect seed from the
 * resolved directTools setting.
 */
function buildRow(name: string, def: ServerDef, sources: RowSources): ServerRow {
  const client = sources.manager.getClient(name);
  const clientStatus = client ? client.status : undefined;
  const live = client && clientStatus !== undefined && isVerifiedStatus(clientStatus);
  const outcome = live ? undefined : sources.outcomes[name];

  let status: ServerRowStatus;
  let statusAt: number | undefined;
  let failureMessage: string | undefined;
  if (def.disabled === true) {
    status = "disabled";
  } else if (live && clientStatus) {
    status = clientStatus;
    if (clientStatus !== "connected" && client) failureMessage = firstLine(client.error);
  } else if (outcome) {
    status = outcome.status === "connected" ? "cached" : outcome.status;
    statusAt = outcome.at;
    if (outcome.status !== "connected") failureMessage = firstLine(outcome.error);
  } else {
    status = "cached";
  }

  const cached = sources.getCachedTools(name, def);
  const liveTools = live && clientStatus === "connected" && client ? client.tools : undefined;
  const direct = resolveServerSettings(def, sources.globalConfig).directTools;
  // Config arrives from JSON without runtime validation — a non-boolean,
  // non-array directTools must not throw (mirror of filterDirectTools).
  const isDirectFor = (toolName: string): boolean =>
    Array.isArray(direct) ? direct.includes(toolName) : direct !== false;
  const tools: ToolRow[] = (liveTools ?? cached ?? []).map((t) => ({
    name: t.name,
    description: t.description ?? "",
    isDirect: isDirectFor(t.name),
    wasDirect: isDirectFor(t.name),
  }));

  const row: ServerRow = { name, expanded: false, status, tools, hasCachedData: cached !== undefined };
  if (statusAt !== undefined) row.statusAt = statusAt;
  if (failureMessage !== undefined) row.failureMessage = failureMessage;
  return row;
}

// ── Component ────────────────────────────────────────────────────────────────

interface McpPanelState {
  servers: ServerRow[];
  cursor: number;
  filter: string;
  filterMode: boolean;
  /** In-panel OAuth in flight (ADR 0005) — every key but esc/ctrl+c is inert. */
  authing: { serverName: string } | null;
  /** Servers with any tool where isDirect !== wasDirect (the ctrl+s dirty set). */
  changedServers: Set<string>;
  /** Transient result line rendered above the footer. */
  notice: { text: string; tone: "info" | "success" | "error" } | null;
}

interface McpPanelComponent {
  render(width: number): string[];
  handleInput(data: string): void;
  invalidate(): void;
  dispose(): void;
}

const HINTS_FIRST =
  " [↑/↓] move  [space] toggle  [enter] expand/auth  [a] auth  [e] en/dis  ";
const HINTS_SECOND =
  "[l] logout  [r] reconnect  [/] search  [ctrl+s] save  [esc] close ";

/**
 * Build the overlay component. `ctx` is captured for `ctx.cwd` (config
 * write-back) and `ctx.ui.notify` (command-path parity toasts); everything
 * else is a direct import or an injected dep.
 */
function makeMcpPanel(
  servers: ServerRow[],
  tui: TUI,
  theme: Theme,
  done: () => void,
  deps: McpPanelDeps,
  ctx: ExtensionCommandContext,
): McpPanelComponent {
  const state: McpPanelState = {
    servers,
    cursor: 0,
    filter: "",
    filterMode: false,
    authing: null,
    changedServers: new Set(),
    notice: null,
  };

  let authController: AbortController | null = null;
  let disposed = false;
  let cachedWidth: number | undefined;
  let cachedLines: string[] | undefined;

  function requestRender(): void {
    cachedWidth = undefined;
    cachedLines = undefined;
    if (!disposed) tui.requestRender();
  }

  function setNotice(text: string, tone: "info" | "success" | "error"): void {
    state.notice = { text, tone };
  }

  /** Recompute the ctrl+s dirty set from isDirect vs wasDirect. */
  function syncChanged(): void {
    state.changedServers = new Set(
      state.servers
        .filter((s) => s.tools.some((t) => t.isDirect !== t.wasDirect))
        .map((s) => s.name),
    );
  }

  function rowByName(name: string): ServerRow | undefined {
    return state.servers.find((s) => s.name === name);
  }

  /**
   * Visible rows for cursor/render. Unfiltered → buildVisibleRows. With a
   * filter → the matching servers auto-interleave only their matching tool
   * rows (a server-name hit keeps ALL of its tools).
   */
  function visibleRows(): VisibleRow[] {
    const filtered = filterRows(state.servers, state.filter);
    if (state.filter.length === 0) return buildVisibleRows(filtered);
    const q = state.filter.toLowerCase();
    const rows: VisibleRow[] = [];
    for (const s of filtered) {
      rows.push({ kind: "server", server: s });
      const nameHit = s.name.toLowerCase().includes(q);
      for (const t of s.tools) {
        if (nameHit || t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)) {
          rows.push({ kind: "tool", server: s, tool: t });
        }
      }
    }
    return rows;
  }

  /** Keep the cursor inside the (possibly shorter) visible list. */
  function clampCursor(): void {
    const max = Math.max(0, visibleRows().length - 1);
    if (state.cursor > max) state.cursor = max;
  }

  function rowSources(): RowSources {
    return {
      globalConfig: loadMcpConfig(),
      outcomes: loadMetadataCache().serverStatuses ?? {},
      manager: deps.getManager(),
      getCachedTools: deps.getCachedTools,
    };
  }

  /**
   * Re-seed one server's status + tool list from the live manager and cache,
   * preserving the expansion and any isDirect overrides the user made
   * (wasDirect re-seeds identically from config, so the dirty set stays
   * meaningful across a refresh).
   */
  function refreshRow(name: string): void {
    const def = deps.getServerDefs()[name];
    const existing = rowByName(name);
    if (def === undefined || existing === undefined) return;
    const fresh = buildRow(name, def, rowSources());
    for (const t of fresh.tools) {
      const prev = existing.tools.find((p) => p.name === t.name);
      if (prev) t.isDirect = prev.isDirect;
    }
    existing.status = fresh.status;
    existing.tools = fresh.tools;
    existing.hasCachedData = fresh.hasCachedData;
    if (fresh.statusAt !== undefined) existing.statusAt = fresh.statusAt;
    else delete existing.statusAt;
    if (fresh.failureMessage !== undefined) existing.failureMessage = fresh.failureMessage;
    else delete existing.failureMessage;
    syncChanged();
  }

  function closePanel(): void {
    disposed = true;
    done();
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  function toggleEnabled(name: string): void {
    const def = deps.getServerDefs()[name];
    if (def === undefined) {
      setNotice(`Unknown server: ${name}`, "error");
      requestRender();
      return;
    }
    const disable = def.disabled !== true;
    try {
      // Identical semantics to /mcp enable|disable: single-field write-back
      // to <cwd>/<CONFIG_DIR_NAME>/mcp.json (ADR 0002) + tearing down the
      // live client on disable; nothing applies until /reload.
      writeServerDisabled(ctx.cwd, name, disable);
      if (disable) deps.getManager().getClient(name)?.close();
      refreshRow(name);
      const message = `✓ ${name} ${disable ? "disabled" : "enabled"} — run /reload to apply`;
      setNotice(message, "info");
      ctx.ui.notify(message, "info");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setNotice(message, "error");
      ctx.ui.notify(`/mcp panel: ${message}`, "error");
    }
    requestRender();
  }

  function logout(name: string): void {
    const result = mcpLogoutServer(name, deps.getManager);
    if (!result.ok) {
      const message = `Could not log out of ${name}: ${result.error ?? "unknown error"}`;
      setNotice(message, "error");
      ctx.ui.notify(message, "error");
      requestRender();
      return;
    }
    refreshRow(name);
    // The persisted needs-auth outcome (ADR 0004) described the token that
    // was JUST deleted — it is unverified until the next settle, so demote
    // the row to "cached" rather than claiming a stale 401.
    const s = rowByName(name);
    if (s?.status === "needs-auth") {
      s.status = "cached";
      delete s.statusAt;
      delete s.failureMessage;
    }
    setNotice(`Logged out of ${name}`, "info");
    requestRender();
  }

  function reconnect(name: string): void {
    const def = deps.getServerDefs()[name];
    if (def?.disabled === true) {
      setNotice(`${name} is disabled — press [e] to enable, then /reload`, "error");
      requestRender();
      return;
    }
    const client = deps.getManager().getClient(name);
    if (!client) {
      setNotice(`${name}: no managed connection — run /reload to pick up config changes`, "error");
      requestRender();
      return;
    }
    setNotice(`Reconnecting ${name}…`, "info");
    requestRender();
    void (async () => {
      await client.close();
      try {
        await client.connect();
      } catch {
        // A failed connect settles the client into "error" (client.error);
        // the refresh below renders it.
      }
      // ADR 0004: persist the settled outcome at this settle point.
      recordClientOutcome(client);
      if (disposed) return;
      refreshRow(name);
      const s = rowByName(name);
      if (s?.status === "connected") {
        setNotice(`✓ ${name} connected (${s.tools.length} tools)`, "success");
      } else if (s?.status === "needs-auth") {
        setNotice(`⚠ ${name} needs auth — press [a] to authenticate`, "info");
      } else {
        setNotice(`✗ ${name} error — ${s?.failureMessage ?? "connect failed"}`, "error");
      }
      requestRender();
    })();
  }

  /**
   * In-panel OAuth (ADR 0005). Enters the `authing` substate and runs the
   * flow off-thread; the settle point refreshes the row, records the
   * outcome, and renders a transient result line.
   */
  function startAuth(name: string): void {
    if (state.authing !== null) return; // one flow at a time (same client)
    const def = deps.getServerDefs()[name];
    if (def === undefined) {
      setNotice(`Unknown server: ${name}`, "error");
      requestRender();
      return;
    }
    // Single OAuth-eligibility check (parity with /mcp auth + the adapter's
    // canAuthenticate): an http def with a resolvable OAuth config.
    if (!isHttpDef(def) || extractOAuthConfig(def.auth) === null) {
      setNotice(
        `${name} is not configured for OAuth — set auth: "oauth" (or an OAuth config) in mcp.json`,
        "error",
      );
      requestRender();
      return;
    }
    const client = deps.getManager().getClient(name);
    if (!client) {
      setNotice(`${name} is not managed yet — start a new session and try again`, "error");
      requestRender();
      return;
    }
    state.authing = { serverName: name };
    setNotice(`Authenticating ${name}… (esc to cancel)`, "info");
    requestRender();

    const controller = new AbortController();
    authController = controller;
    void (async () => {
      let outcome: AuthRunOutcome;
      try {
        await client.authenticate({
          signal: controller.signal,
          onAuthorizationUrl: async (url: URL) => {
            await openAuthUrl(url.toString());
            // Parity with the command path: announce the full URL too (the
            // browser may be unavailable — headless, remote).
            ctx.ui.notify(`Opening browser… if it didn't open, visit: ${url.toString()}`, "info");
          },
        });
        // Flow finished authenticated: post-auth close + reconnect
        // (re-reads the freshly stored token), structured result.
        outcome = await reconnectAfterAuth(client);
      } catch (e) {
        // An esc/ctrl+c abort rejects with exactly "OAuth cancelled" — that
        // is a CANCELLATION. Anything else is a real flow failure.
        outcome =
          e instanceof Error && e.message === "OAuth cancelled"
            ? { kind: "cancelled" }
            : { kind: "flow-error", error: e instanceof Error ? e.message : String(e) };
      }
      settleAuth(name, controller, outcome);
    })();
  }

  function settleAuth(name: string, controller: AbortController, outcome: AuthRunOutcome): void {
    // The panel was closed while the flow ran: don't touch a disposed tui,
    // but still persist the settled outcome (ADR 0004).
    if (disposed || authController !== controller) {
      if (outcome.kind === "reconnected") {
        const c = deps.getManager().getClient(name);
        if (c) recordClientOutcome(c);
      }
      return;
    }
    state.authing = null;
    authController = null;
    if (outcome.kind === "cancelled") {
      // esc abort (or an external abort) — cancellation, not an error.
      setNotice("Authentication cancelled", "info");
    } else if (outcome.kind === "flow-error") {
      setNotice(`✗ ${name}: ${outcome.error}`, "error");
    } else if (outcome.kind === "reconnect-failed") {
      setNotice(`${name} is authenticated, but reconnecting failed: ${outcome.error}`, "error");
    } else {
      // reconnected — ADR 0004: record the settled outcome, refresh the row
      // (status + live tools), success line.
      const client = deps.getManager().getClient(name);
      if (client) recordClientOutcome(client);
      refreshRow(name);
      setNotice(
        outcome.status === "connected"
          ? `✓ ${name} authenticated — ${outcome.tools} tools available`
          : `✓ ${name} authenticated and reconnected`,
        "success",
      );
    }
    requestRender();
  }

  function saveSelection(): void {
    if (state.changedServers.size === 0) {
      ctx.ui.notify("/mcp panel: no changes to save", "info");
      closePanel();
      return;
    }
    try {
      let count = 0;
      for (const name of state.changedServers) {
        const s = rowByName(name);
        if (s === undefined) continue;
        // true = all direct, false = none, string[] = the subset.
        writeServerDirectTools(ctx.cwd, name, computeSelection(s.tools));
        count++;
      }
      ctx.ui.notify(
        `✓ Saved direct tools for ${count} server${count === 1 ? "" : "s"} — run /reload to apply`,
        "info",
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setNotice(message, "error");
      ctx.ui.notify(`/mcp panel: ${message}`, "error");
      requestRender();
      return; // failed write → stay open so the user can fix and retry
    }
    closePanel();
  }

  // ── Input ──────────────────────────────────────────────────────────────────

  function handleInput(data: string): void {
    // authing substate (ADR 0005): esc cancels, ctrl+c cancels + closes,
    // EVERYTHING ELSE IS IGNORED until the flow settles.
    if (state.authing !== null) {
      if (matchesKey(data, Key.escape)) {
        // Aborts the flow; it then rejects with "OAuth cancelled" and the
        // settle renders "Authentication cancelled" (a cancellation, not an
        // error).
        authController?.abort();
      } else if (matchesKey(data, Key.ctrl("c"))) {
        authController?.abort();
        closePanel();
      }
      return;
    }

    // Close: esc/ctrl+c — discard, NO confirm (unsaved toggles are lost, by
    // design). This also covers the filter state.
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      closePanel();
      return;
    }

    const rows = visibleRows();

    if (matchesKey(data, Key.up)) {
      if (state.cursor > 0) {
        state.cursor--;
        requestRender();
      }
      return;
    }
    if (matchesKey(data, Key.down)) {
      if (state.cursor < rows.length - 1) {
        state.cursor++;
        requestRender();
      }
      return;
    }

    if (matchesKey(data, "/" )) {
      state.filterMode = true;
      requestRender();
      return;
    }

    if (matchesKey(data, Key.backspace)) {
      if (state.filter.length > 0) {
        state.filter = state.filter.slice(0, -1);
        state.cursor = 0;
        requestRender();
      }
      return;
    }

    const selected = rows[state.cursor];
    const server = selected?.kind === "server" ? selected.server : undefined;
    const tool = selected?.kind === "tool" ? selected.tool : undefined;

    if (matchesKey(data, Key.ctrl("s"))) {
      saveSelection();
      return;
    }

    // enter: needs-auth server → IN-PANEL AUTH only (no expand — ADR 0005);
    // any other server row → expand/collapse; tool rows are inert.
    if (matchesKey(data, Key.enter)) {
      if (server && server.status === "needs-auth") {
        startAuth(server.name);
        return;
      }
      if (server && state.filter.length === 0) {
        server.expanded = !server.expanded;
        clampCursor();
        requestRender();
      }
      return;
    }

    // space: while filter mode is active or a filter is set, " " is a
    // printable filter char (agent-manager printable set); otherwise
    // toggle (server row → group, tool row → one).
    if (matchesKey(data, Key.space) && state.filter.length === 0 && !state.filterMode) {
      if (server) {
        // Group toggle: all-off → all-on, otherwise all-off.
        const target = !server.tools.some((t) => t.isDirect);
        for (const t of server.tools) t.isDirect = target;
        syncChanged();
        requestRender();
      } else if (tool) {
        toggleTool(tool);
        syncChanged();
        requestRender();
      }
      return;
    }

    if (state.filter.length > 0 || state.filterMode) {
      // Filter mode: printable chars (including " ", which is in the
      // [" ", "~"] range) append to the query; e/l/a/r are INERT so their
      // letters can be typed; backspace is handled above. filterMode is
      // reset on the first typed char (agent-manager parity).
      if (data.length === 1 && data >= " " && data <= "~") {
        state.filter += data;
        state.filterMode = false;
        state.cursor = 0;
        requestRender();
      }
      return;
    }

    // Filter empty — the single-char actions (server rows only).
    if (server) {
      if (matchesKey(data, "e")) {
        toggleEnabled(server.name);
        return;
      }
      if (matchesKey(data, "l")) {
        logout(server.name);
        return;
      }
      if (matchesKey(data, "a")) {
        startAuth(server.name);
        return;
      }
      if (matchesKey(data, "r")) {
        reconnect(server.name);
      }
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  function statusGlyph(status: ServerRowStatus): string {
    switch (status) {
      case "connected":
        return theme.fg("success", "●");
      case "needs-auth":
        return theme.fg("warning", "⚠");
      case "error":
        return theme.fg("error", "✗");
      case "disabled":
        return theme.fg("dim", "⊘");
      case "cached":
        return theme.fg("dim", "○");
    }
  }

  function renderRowLine(row: VisibleRow, selected: boolean, contentWidth: number): string {
    let text: string;
    if (row.kind === "server") {
      const s = row.server;
      const caret = s.expanded ? "▾" : "▸";
      const directCount = s.tools.filter((t) => t.isDirect).length;
      text =
        `${caret} ${statusGlyph(s.status)} ` +
        theme.fg("accent", s.name) +
        ` (${directCount}/${s.tools.length} tools)` +
        ageSuffix(s.statusAt);
    } else {
      const mark = row.tool.isDirect ? "●" : theme.fg("dim", "○");
      const desc = row.tool.description.length > 0 ? ` ${theme.fg("dim", row.tool.description)}` : "";
      text = `    ${mark} ${row.tool.name}${desc}`;
    }
    const line = selected ? theme.fg("accent", text) : text;
    return hardTruncate(line, contentWidth);
  }

  function renderLines(contentWidth: number): string[] {
    const lines: string[] = [];

    // Header (accent), same shape as /agents.
    lines.push(renderHeader(` MCP Servers [${state.servers.length}] `, contentWidth, theme));

    // Active filter line (dim).
    if (state.filter.length > 0) {
      const marker = state.filterMode ? CURSOR_MARKER : "";
      lines.push(padEnd(theme.fg("dim", `◎ ${state.filter}`) + marker, contentWidth));
    }

    // Flat visible list, cursor row highlighted with accent.
    const rows = visibleRows();
    if (rows.length === 0) {
      lines.push(
        padEnd(
          theme.fg(
            "dim",
            state.filter.length > 0 ? "No matching servers" : "No MCP servers configured",
          ),
          contentWidth,
        ),
      );
    } else {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row === undefined) continue;
        lines.push(renderRowLine(row, i === state.cursor, contentWidth));
        // First-line failure text under error/needs-auth rows (indented to
        // align with the server name).
        if (row.kind === "server") {
          const s = row.server;
          if ((s.status === "error" || s.status === "needs-auth") && s.failureMessage) {
            lines.push(
              hardTruncate(
                theme.fg("dim", `    ${s.failureMessage}${ageSuffix(s.statusAt)}`),
                contentWidth,
              ),
            );
          }
        }
      }
    }

    // Transient result line (latest action's outcome).
    if (state.notice) {
      const token =
        state.notice.tone === "error" ? "error" : state.notice.tone === "success" ? "success" : "dim";
      lines.push(hardTruncate(theme.fg(token, state.notice.text), contentWidth));
    }

    // Footer (dim, bracket hints). At the standard 84-char overlay width the
    // single string is 116 visible chars > the 80-char content width and
    // renderFooter does NOT wrap — so it is pre-split into two lines when
    // (and only when) it overflows.
    const single = HINTS_FIRST + HINTS_SECOND;
    if (visibleWidth(single) <= contentWidth) {
      lines.push(renderFooter(single, contentWidth, theme));
    } else {
      lines.push(renderFooter(HINTS_FIRST, contentWidth, theme));
      lines.push(renderFooter(HINTS_SECOND, contentWidth, theme));
    }

    return lines;
  }

  return {
    render(width: number): string[] {
      if (cachedLines && cachedWidth === width) return cachedLines;
      const bordered = wrapWithBorder(renderLines(borderContentWidth(width)), width, theme);
      cachedWidth = width;
      cachedLines = bordered;
      return bordered;
    },

    handleInput,

    invalidate(): void {
      cachedWidth = undefined;
      cachedLines = undefined;
    },

    dispose(): void {
      disposed = true;
      // Cancel a flow still in flight so it cannot touch the closed tui;
      // settleAuth's disposed-guard keeps it from re-rendering.
      authController?.abort();
      authController = null;
    },
  };
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Open the management panel as a centered overlay (shared chrome, ADR 0003).
 * `pi` is part of the stable panel API (the reference adapter's
 * openMcpPanel takes it too) but unused here — the panel's tool list comes
 * from the manager/cache, not `pi.getAllTools()`.
 */
export async function openMcpPanel(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  deps: McpPanelDeps,
): Promise<void> {
  void pi;
  if (!ctx.hasUI) {
    ctx.ui.notify("/mcp panel requires an interactive TUI", "error");
    return;
  }

  const defs = deps.getServerDefs();
  const sources: RowSources = {
    globalConfig: loadMcpConfig(),
    outcomes: loadMetadataCache().serverStatuses ?? {},
    manager: deps.getManager(),
    getCachedTools: deps.getCachedTools,
  };
  const servers = Object.entries(defs).map(([name, def]) => buildRow(name, def, sources));

  await ctx.ui.custom<void>(
    (tui: TUI, theme: Theme, _keybindings, done: () => void) =>
      makeMcpPanel(servers, tui, theme, done, deps, ctx),
    { overlay: true, overlayOptions: OVERLAY_CHROME },
  );
}
