/**
 * Pure, stateless row helpers for the `/mcp panel` management panel.
 *
 * Everything in this module is a pure function or type definition — no
 * side effects, no closure over mutable state. Extracted from panel.ts so
 * that unit tests can import them directly and so that panel.ts can focus
 * on the stateful component logic.
 */
import { isHttpDef, resolveServerSettings } from "./config.js";
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

// ── Row-seeding support ───────────────────────────────────────────────────────

export interface RowSources {
  globalConfig: McpConfig;
  outcomes: Record<string, ServerOutcomeRecord>;
  manager: ServerManager;
  getCachedTools: (name: string, def: ServerDef) => CachedTool[] | undefined;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

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

// ── Display helpers ───────────────────────────────────────────────────────────

export function firstLine(text: string | null | undefined): string | undefined {
  const line = text?.split("\n")[0]?.trim();
  return line === undefined || line.length === 0 ? undefined : line;
}

/**
 * Staleness formatting for persisted outcomes (ADR 0004). Deliberately
 * duplicated from commands.ts instead of imported: commands.ts lazily loads
 * panel.ts for /mcp panel, so a static import back would create a cycle.
 */
export function formatAge(ms: number): string {
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
export function ageSuffix(at: number | undefined): string {
  if (at === undefined) return "";
  const age = Date.now() - at;
  if (age < 60_000) return "";
  return ` (${formatAge(age)})`;
}

// ── Row seeding ───────────────────────────────────────────────────────────────

/** Verified connection states — the only ones a row may claim live. */
export function isVerifiedStatus(s: ServerStatus): s is "connected" | "needs-auth" | "error" {
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
export function buildRow(name: string, def: ServerDef, sources: RowSources): ServerRow {
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


