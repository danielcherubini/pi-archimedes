/**
 * The `/mcp` command (plan-027, Task 2): a single dispatcher with text
 * subcommands. The standalone `/mcp-auth` and `/mcp-logout` commands are
 * retired — they live on as `/mcp auth <server>` and `/mcp logout <server>`
 * on top of the shared fns in `commands-auth.ts` (unchanged UX).
 *
 * Dispatch: the first whitespace-separated token of the raw args string
 * selects the subcommand; `""` behaves like `status`, so bare `/mcp`
 * reports status. `panel` opens the management panel (lazy-loaded from
 * `panel.ts`); `setup` opens the onboarding panel (lazy-loaded from
 * `setup-panel.ts`).
 *
 * Dependency discipline: only what the subcommands touch is injected
 * (manager / defs / cache readers). `writeServerDisabled`, `deleteAuthEntry`
 * (inside `mcpLogoutServer`), `extractOAuthConfig` and `loadMetadataCache`
 * are imported directly — none of them need a seam.
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { isHttpDef } from "./config.js";
import { mcpLogoutServer, runMcpAuthCommand } from "./commands-auth.js";
import { writeServerDisabled } from "./config-write.js";
import { loadMetadataCache, recordClientOutcome } from "./metadata-cache.js";
import type { ServerManager } from "./server-manager.js";
import type { CachedTool, ServerDef, ServerOutcomeRecord } from "./types.js";

/** Dependencies injected by index.ts — the seams every subcommand touches. */
export interface McpCommandDeps {
  /** Module-level singleton via getter (session-resilient across /reload). */
  getManager: () => ServerManager;
  /** loadAllServerDefs() — INCLUDES disabled servers (they have status). */
  getServerDefs: () => Record<string, ServerDef>;
  getCachedTools: (serverName: string, def: ServerDef) => CachedTool[] | undefined;
  getCachedPrompts: (serverName: string, def: ServerDef) => Array<{ name: string; description?: string }> | undefined;
}

/** Result of splitting the raw args string into subcommand + rest. */
export interface ParsedSubcommand {
  subcommand: string;
  rest: string[];
}

/**
 * Split the raw `/mcp` args string: first whitespace-separated token is the
 * subcommand, the remainder is `rest`. An empty (or whitespace-only) string
 * defaults to `status`, so bare `/mcp` reports status.
 */
export function parseMcpSubcommand(args: string): ParsedSubcommand {
  const tokens = args.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return { subcommand: "status", rest: [] };
  return { subcommand: tokens[0]!, rest: tokens.slice(1) };
}

const USAGE =
  "Usage: /mcp [status | tools [server] | prompts [server] | reconnect [server] | " +
  "enable <server> | disable <server> | logout <server> | auth <server> | panel | setup]";

/** Register the `/mcp` dispatcher command on pi. */
export function registerMcpCommand(pi: ExtensionAPI, deps: McpCommandDeps): void {
  pi.registerCommand("mcp", {
    description:
      "Manage MCP servers (Usage: /mcp [status | tools | prompts | reconnect | enable | disable | logout | auth | panel | setup] …)",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const { subcommand, rest } = parseMcpSubcommand(args);
      try {
        switch (subcommand) {
          case "status":
            await cmdStatus(deps, ctx);
            break;
          case "tools":
            cmdTools(deps, rest[0], ctx);
            break;
          case "prompts":
            cmdPrompts(deps, rest[0], ctx);
            break;
          case "reconnect":
            await cmdReconnect(deps, rest[0], ctx);
            break;
          case "enable":
            await cmdToggleEnabled(deps, rest[0], ctx, false);
            break;
          case "disable":
            await cmdToggleEnabled(deps, rest[0], ctx, true);
            break;
          case "logout":
            await cmdLogout(deps, rest[0], ctx);
            break;
          case "auth":
            await cmdAuth(deps, rest[0], ctx);
            break;
          case "panel":
            await cmdPanel(pi, deps, ctx);
            break;
          case "setup":
            await cmdSetup(pi, ctx);
            break;
          default:
            ctx.ui.notify(USAGE, "info");
        }
      } catch (e) {
        // Subcommand failures (e.g. a refused config write-back) surface as
        // a single error notification rather than an unhandled rejection.
        ctx.ui.notify(`/mcp ${subcommand}: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
    },
  });
}

// ── status ──────────────────────────────────────────────────────────────────

function cmdStatus(deps: McpCommandDeps, ctx: ExtensionCommandContext): void {
  const defs = deps.getServerDefs();
  const names = Object.keys(defs);
  if (names.length === 0) {
    ctx.ui.notify("No MCP servers configured — run /mcp setup", "info");
    return;
  }
  const outcomes = loadMetadataCache().serverStatuses ?? {};
  const lines = names.map((name) =>
    statusLine(name, defs[name]!, deps.getManager(), outcomes[name], deps),
  );
  ctx.ui.notify(lines.join("\n"), "info");
}

function statusLine(
  name: string,
  def: ServerDef,
  manager: ServerManager,
  outcome: ServerOutcomeRecord | undefined,
  deps: McpCommandDeps,
): string {
  if (def.disabled === true) {
    return `○ ${name}: disabled (run /mcp enable ${name}, then /reload)`;
  }
  const client = manager.getClient(name);
  const age = ageSuffix(outcome?.at);
  if (client?.status === "connected") {
    return `✓ ${name}: connected (${client.tools.length} tools)`;
  }
  if (client?.status === "needs-auth") {
    return `⚠ ${name}: needs auth${age} — run /mcp auth ${name}`;
  }
  if (client?.status === "error") {
    return `✗ ${name}: error${age} — ${firstLine(client.error) ?? "connect failed"}`;
  }
  // Not connected live — the persisted outcome (ADR 0004) is the freshest
  // truth across sessions.
  if (outcome?.status === "needs-auth") {
    return `⚠ ${name}: needs auth${age} — run /mcp auth ${name}`;
  }
  if (outcome?.status === "error") {
    return `✗ ${name}: error${age} — ${outcome.error ?? "connect failed"}`;
  }
  const cached = deps.getCachedTools(name, def);
  const note = cachedNote(cached);
  if (outcome?.status === "connected") {
    return `○ ${name}: was connected${age}${note}`;
  }
  return `○ ${name}: not connected${note}`;
}

function cachedNote(tools: CachedTool[] | undefined): string {
  if (!tools || tools.length === 0) return "";
  return ` (${tools.length} tools cached)`;
}

/** Staleness suffix for a persisted outcome — omitted for fresh (<1m) entries. */
function ageSuffix(at: number | undefined): string {
  if (at === undefined) return "";
  const age = Date.now() - at;
  if (age < 60_000) return "";
  return ` (${formatAge(age)})`;
}

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

function firstLine(text: string | null | undefined): string | undefined {
  const line = text?.split("\n")[0]?.trim();
  return line === undefined || line.length === 0 ? undefined : line;
}

// ── tools / prompts (cache only — no connections) ──────────────────────────

function cmdTools(deps: McpCommandDeps, server: string | undefined, ctx: ExtensionCommandContext): void {
  const defs = deps.getServerDefs();
  if (server !== undefined) {
    const def = defs[server];
    if (def === undefined) {
      ctx.ui.notify(`Unknown server: ${server}`, "error");
      return;
    }
    ctx.ui.notify(toolListFor(server, def, deps) ?? "(no cached tool metadata)", "info");
    return;
  }
  const names = Object.keys(defs);
  if (names.length === 0) {
    ctx.ui.notify("No MCP servers configured — run /mcp setup", "info");
    return;
  }
  const blocks = names.map((name) => {
    const def = defs[name]!;
    const header = `${name}${def.disabled === true ? " (disabled)" : ""}:`;
    const body = toolListFor(name, def, deps) ?? "(no cached tool metadata)";
    return `${header}\n  ${body.replace(/\n/g, "\n  ")}`;
  });
  ctx.ui.notify(blocks.join("\n\n"), "info");
}

function toolListFor(name: string, def: ServerDef, deps: McpCommandDeps): string | undefined {
  const tools = deps.getCachedTools(name, def);
  if (!tools) return undefined;
  if (tools.length === 0) return "(no tools)";
  return tools
    .map((t) => (t.description ? `${t.name} — ${t.description}` : t.name))
    .join("\n");
}

function cmdPrompts(deps: McpCommandDeps, server: string | undefined, ctx: ExtensionCommandContext): void {
  const defs = deps.getServerDefs();
  const listFor = (name: string, def: ServerDef): string | undefined => {
    const prompts = deps.getCachedPrompts(name, def);
    if (!prompts) return undefined;
    if (prompts.length === 0) return "(no prompts)";
    return prompts
      .map((p) => (p.description ? `${p.name} — ${p.description}` : p.name))
      .join("\n");
  };
  if (server !== undefined) {
    const def = defs[server];
    if (def === undefined) {
      ctx.ui.notify(`Unknown server: ${server}`, "error");
      return;
    }
    ctx.ui.notify(listFor(server, def) ?? "(no cached prompt metadata)", "info");
    return;
  }
  const names = Object.keys(defs);
  if (names.length === 0) {
    ctx.ui.notify("No MCP servers configured — run /mcp setup", "info");
    return;
  }
  const blocks = names.map((name) => {
    const def = defs[name]!;
    const header = `${name}${def.disabled === true ? " (disabled)" : ""}:`;
    const body = listFor(name, def) ?? "(no cached prompt metadata)";
    return `${header}\n  ${body.replace(/\n/g, "\n  ")}`;
  });
  ctx.ui.notify(blocks.join("\n\n"), "info");
}

// ── reconnect ───────────────────────────────────────────────────────────────

async function cmdReconnect(deps: McpCommandDeps, server: string | undefined, ctx: ExtensionCommandContext): Promise<void> {
  const defs = deps.getServerDefs();
  const manager = deps.getManager();

  let targets: string[];
  if (server !== undefined) {
    const def = defs[server];
    if (def === undefined) {
      ctx.ui.notify(`Unknown server: ${server}`, "error");
      return;
    }
    if (def.disabled === true) {
      ctx.ui.notify(`Server ${server} is disabled (run /mcp enable ${server}, then /reload)`, "error");
      return;
    }
    targets = [server];
  } else {
    targets = Object.keys(defs).filter((name) => defs[name]!.disabled !== true);
    if (targets.length === 0) {
      ctx.ui.notify("No enabled servers to reconnect", "info");
      return;
    }
  }

  // Bring the manager up to date with the current ENABLED, well-formed set
  // (same pattern the proxy actions use) so a fresh or removed server is
  // handled correctly. Disabled servers never get a managed client.
  const enabled = Object.fromEntries(
    Object.entries(defs).filter(
      ([, d]) => d.disabled !== true && ("url" in d || "command" in d),
    ),
  );
  manager.sync(enabled);

  const lines: string[] = [];
  for (const name of targets) {
    const client = manager.getClient(name);
    if (!client) {
      lines.push(`✗ ${name}: no managed connection — run /reload to pick up config changes`);
      continue;
    }
    await client.close();
    try {
      await client.connect();
    } catch {
      // A failed connect settles the client into "error" (message on
      // client.error) — nothing else to do here.
    }
    // ADR 0004: persist the settled outcome (one recorder per settle point).
    recordClientOutcome(client);
    if (client.status === "connected") {
      lines.push(`✓ ${name}: connected (${client.tools.length} tools)`);
    } else if (client.status === "needs-auth") {
      lines.push(`⚠ ${name}: needs auth — run /mcp auth ${name}`);
    } else {
      lines.push(`✗ ${name}: error — ${firstLine(client.error) ?? "connect failed"}`);
    }
  }
  ctx.ui.notify(lines.join("\n"), "info");
}

// ── enable / disable (write-back to <cwd>/.pi/mcp.json, ADR 0002) ──────────

async function cmdToggleEnabled(
  deps: McpCommandDeps,
  server: string | undefined,
  ctx: ExtensionCommandContext,
  disable: boolean,
): Promise<void> {
  const verb = disable ? "disable" : "enable";
  if (server === undefined) {
    ctx.ui.notify(`Usage: /mcp ${verb} <server>`, "info");
    return;
  }
  const def = deps.getServerDefs()[server];
  if (def === undefined) {
    ctx.ui.notify(`Unknown server: ${server}`, "error");
    return;
  }
  const isDisabled = def.disabled === true;
  if (disable === isDisabled) {
    ctx.ui.notify(`Server ${server} is already ${disable ? "disabled" : "enabled"}`, "error");
    return;
  }
  // Throws on an unparseable override file — the dispatcher's catch renders it.
  writeServerDisabled(ctx.cwd, server, disable);
  if (disable) {
    // Drop the live connection so the server is torn down at /reload.
    deps.getManager().getClient(server)?.close();
  }
  ctx.ui.notify(`✓ ${server} ${disable ? "disabled" : "enabled"} — run /reload to apply`, "info");
}

// ── logout (shared fn — keyring delete + client close) ──────────────────────

async function cmdLogout(deps: McpCommandDeps, server: string | undefined, ctx: ExtensionCommandContext): Promise<void> {
  if (server === undefined) {
    ctx.ui.notify("Usage: /mcp logout <server>", "info");
    return;
  }
  const result = mcpLogoutServer(server, deps.getManager);
  if (!result.ok) {
    ctx.ui.notify(`Could not log out of ${server}: ${result.error}`, "error");
    return;
  }
  ctx.ui.notify(`Logged out of ${server}`, "info");
}

// ── panel (lazy-loads the TUI component — same pattern as /agents) ─────────

async function cmdPanel(pi: ExtensionAPI, deps: McpCommandDeps, ctx: ExtensionCommandContext): Promise<void> {
  const { openMcpPanel } = await import("./panel.js");
  // deps is a structural superset of McpPanelDeps (extra getCachedPrompts
  // seam is simply unused by the panel); ctx.cwd supplies the write-back
  // target for e / ctrl+s (ADR 0002).
  await openMcpPanel(pi, ctx, deps);
}

// ── setup (lazy-loads the onboarding panel — same pattern as panel) ─────────

async function cmdSetup(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const { openMcpSetupPanel } = await import("./setup-panel.js");
  await openMcpSetupPanel(pi, ctx);
}

// ── auth (delegates to the extracted runMcpAuthCommand) ─────────────────────

async function cmdAuth(deps: McpCommandDeps, server: string | undefined, ctx: ExtensionCommandContext): Promise<void> {
  if (server === undefined) {
    ctx.ui.notify("Usage: /mcp auth <server>", "info");
    return;
  }
  // The http-only single-server lookup is derived at the call site —
  // stdio and unknown servers both read as "unknown" for OAuth — and stays
  // test-injectable through getServerDefs (the seam the deps expose).
  const d = deps.getServerDefs()[server];
  const def = d !== undefined && isHttpDef(d) ? d : undefined;
  await runMcpAuthCommand(server, ctx, {
    getServerDef: () => def,
    getManager: deps.getManager,
  });
}
