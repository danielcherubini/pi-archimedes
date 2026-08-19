/**
 * The `/mcp setup` onboarding panel (plan-027, Task 4).
 *
 * Mode-based `string[]` overlay built on the shared overlay chrome
 * (`@pi-archimedes/core/overlay`) — structurally identical to the `/mcp panel`
 * management panel (`panel.ts`) and the `/agents` manager: `renderHeader`
 * at top, cursor-highlighted flat lists, bracket-hinted `renderFooter`
 * lines at the bottom, everything wrapped by `wrapWithBorder` (ADR 0003).
 * No pi-tui `SelectList`/`DynamicBorder`/`Input`/`Focusable`.
 *
 * Modes and keys:
 * - `menu` (entry): "Scaffold minimal .mcp.json" / "Add a known server" /
 *   "Import from another tool" / "Cancel"; `enter` runs the selected action,
 *   `esc` closes
 * - `import`: checklist of `discoverHostConfigs(ctx.cwd)` results
 *   (`[x] cursor  ~/.cursor/mcp.json`); `space` toggles the check;
 *   `enter` on a CHECKED row previews (then confirms) just that host;
 *   `w` previews (then confirms) everything checked; `esc` → menu
 * - `preview`: plain list of the server names to be added — the
 *   add-if-absent diff, so servers already in `.mcp.json` are NOT listed;
 *   `enter`/`y` writes the selection to `<cwd>/.mcp.json` via
 *   `mergeServerDefinitions` and returns to `import` with a success line;
 *   `n`/`esc` cancels
 * - `known`: small curated `{ name, def }` list; `enter` adds that entry
 *   (add-if-absent — an existing entry is never overwritten); `esc` → menu
 * - `scaffold`: shows the minimal `.mcp.json` content; `enter` writes it
 *   ONLY when `<cwd>/.mcp.json` is absent (never clobbers — when present,
 *   the panel says so); `esc` → menu
 *
 * All writes target `<cwd>/.mcp.json` — the project-shared DEFINITIONS file
 * from the normal config cascade, NOT the Pi override under
 * `<cwd>/<CONFIG_DIR_NAME>/`. Every successful write notifies the user to
 * run `/reload`.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { Key, matchesKey } from "@earendil-works/pi-tui";
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
import { existingProjectServerNames, mergeServerDefinitions, writeJsonFileAtomic } from "./config-write.js";
import { discoverHostConfigs, type HostConfig } from "./host-configs.js";
import type { ServerDef } from "./types.js";

// ── Known servers (curated, deliberately small) ─────────────────────────────

export interface KnownServer {
  name: string;
  summary: string;
  def: ServerDef;
}

/**
 * The "Add a known server" presets. Keep this list small — it is surfaced
 * verbatim in the TUI and every entry becomes a bare entry in `.mcp.json`.
 */
export const KNOWN_SERVERS: readonly KnownServer[] = [
  {
    name: "context7",
    summary: "Upstash Context7 — up-to-date library docs",
    def: { command: "npx", args: ["-y", "@upstash/context7-mcp"] },
  },
  {
    name: "chrome-devtools",
    summary: "Chrome DevTools MCP (official, Chrome team)",
    def: { command: "npx", args: ["-y", "chrome-devtools-mcp@latest"] },
  },
  {
    name: "deepwiki",
    summary: "DeepWiki — ask questions about any GitHub repo",
    def: { command: "npx", args: ["-y", "mcp-deepwiki@latest"] },
  },
  {
    name: "fetch",
    summary: "Fetch web pages as markdown (reference server)",
    def: { command: "uvx", args: ["mcp-server-fetch"] },
  },
];

/** The minimal `.mcp.json` the scaffold mode writes (absent files only). */
export const SCAFFOLD_MCP_JSON = '{\n  "mcpServers": {}\n}\n';

// ── Import preview (pure, exported for future unit tests) ───────────────────

/** The import preview: which names the add-if-absent write will actually add. */
export interface ImportPreview {
  /** Which source(s) drive this preview (agent labels, `+`-joined). */
  sourceLabel: string;
  /** The server names that will be written (new ones only, first-seen order). */
  adding: string[];
  /** Selected servers already present in `.mcp.json` (kept untouched). */
  alreadyPresent: number;
  /** All selected defs — `mergeServerDefinitions` still applies add-if-absent. */
  defs: Record<string, ServerDef>;
}

/**
 * Derive the preview for a set of checked host configs: union their servers
 * in discovery order (first seen wins a name clash), then diff against the
 * names already in `<cwd>/.mcp.json`. Returns null when nothing is selected.
 */
export function computeImportPreview(
  hostConfigs: readonly HostConfig[],
  checked: ReadonlySet<number>,
  existingNames: readonly string[],
): ImportPreview | null {
  const existing = new Set(existingNames);
  const defs: Record<string, ServerDef> = {};
  const order: string[] = [];
  const labels: string[] = [];
  for (let i = 0; i < hostConfigs.length; i++) {
    if (!checked.has(i)) continue;
    const host = hostConfigs[i];
    if (host === undefined) continue;
    labels.push(host.agent);
    for (const [name, def] of Object.entries(host.servers)) {
      if (!(name in defs)) {
        defs[name] = def;
        order.push(name);
      }
    }
  }
  if (order.length === 0) return null;
  const adding = order.filter((n) => !existing.has(n));
  return {
    sourceLabel: labels.join(" + "),
    adding,
    alreadyPresent: order.length - adding.length,
    defs,
  };
}

// ── Component ────────────────────────────────────────────────────────────────

type SetupMode = "menu" | "import" | "preview" | "known" | "scaffold";

interface SetupPanelState {
  mode: SetupMode;
  menuCursor: number;
  importCursor: number;
  knownCursor: number;
  hostConfigs: HostConfig[];
  /** True after the first import-mode discovery (re-discovered each entry). */
  discovered: boolean;
  /** Indices into hostConfigs the user checked ([space]). */
  checked: Set<number>;
  preview: ImportPreview | null;
  /** Transient result line rendered above the footer. */
  notice: { text: string; tone: "info" | "success" | "error" } | null;
}

interface McpSetupPanelComponent {
  render(width: number): string[];
  handleInput(data: string): void;
  invalidate(): void;
  dispose(): void;
}

const MENU_ACTIONS = [
  "Scaffold minimal .mcp.json",
  "Add a known server",
  "Import from another tool",
  "Cancel",
] as const;

/**
 * Footer hint parts per mode (bracket style). The parts are joined and
 * rendered as ONE footer line when they fit `borderContentWidth`; otherwise
 * they are pre-split one per line (renderFooter does not wrap).
 */
const FOOTERS: Record<SetupMode, readonly string[]> = {
  menu: [" [↑/↓] move  [enter] select  [esc] close "],
  import: [
    " [↑/↓] move  [space] check  [enter] preview checked  ",
    "[w] write all checked  [esc] back ",
  ],
  preview: [" [enter] write  [n / esc] cancel "],
  known: [" [↑/↓] move  [enter] add  [esc] back "],
  scaffold: [" [enter] write (if absent)  [esc] back "],
};

/** Path with `~` substituted for the home prefix (display only). */
function displayPath(p: string): string {
  const home = homedir();
  if (p.startsWith(home + sep)) return `~${p.slice(home.length)}`;
  return p;
}

/**
 * Build the overlay component. `ctx` is captured for `ctx.cwd` (the
 * `<cwd>/.mcp.json` write target) and `ctx.ui.notify` (toast parity with the
 * command path); everything else is a direct import.
 */
function makeSetupPanel(
  tui: TUI,
  theme: Theme,
  done: () => void,
  ctx: ExtensionCommandContext,
): McpSetupPanelComponent {
  const state: SetupPanelState = {
    mode: "menu",
    menuCursor: 0,
    importCursor: 0,
    knownCursor: 0,
    hostConfigs: [],
    discovered: false,
    checked: new Set<number>(),
    preview: null,
    notice: null,
  };

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

  function closePanel(): void {
    if (disposed) return;
    disposed = true;
    done();
  }

  function projectTarget(): string {
    return join(ctx.cwd, ".mcp.json");
  }

  // ── Mode transitions ─────────────────────────────────────────────────────

  function enterMenu(): void {
    state.mode = "menu";
    state.preview = null;
  }

  function enterImportMode(): void {
    // Re-discover so the checklist matches current reality; checks that
    // reference paths still present are preserved across menu round-trips.
    const previousChecked = new Map<string, boolean>();
    for (let i = 0; i < state.hostConfigs.length; i++) {
      const host = state.hostConfigs[i];
      if (host !== undefined) previousChecked.set(host.path, state.checked.has(i));
    }
    let fresh: HostConfig[];
    try {
      fresh = discoverHostConfigs(ctx.cwd);
    } catch {
      fresh = state.hostConfigs; // defensive: never throw into the input path
    }
    state.hostConfigs = fresh;
    state.discovered = true;
    state.checked = new Set(
      fresh
        .map((host, i) => (previousChecked.get(host.path) === true ? i : -1))
        .filter((i) => i >= 0),
    );
    state.importCursor = Math.min(state.importCursor, Math.max(0, fresh.length - 1));
    state.mode = "import";
    state.preview = null;
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  function runMenuAction(): void {
    const action = MENU_ACTIONS[state.menuCursor];
    switch (action) {
      case "Scaffold minimal .mcp.json":
        state.mode = "scaffold";
        requestRender();
        return;
      case "Add a known server":
        state.mode = "known";
        requestRender();
        return;
      case "Import from another tool":
        enterImportMode();
        requestRender();
        return;
      case "Cancel":
      default:
        closePanel();
        return;
    }
  }

  /**
   * Build and show the preview for the given host indices (checked set for
   * `w`, a single index for `enter` on a checked row). Refuses to open when
   * nothing NEW would be added, and on an unreadable `.mcp.json` it surfaces
   * the reader's error instead of guessing the diff.
   */
  function openPreviewFor(indices: number[]): void {
    let existingNames: string[];
    try {
      existingNames = existingProjectServerNames(ctx.cwd);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setNotice(message, "error");
      ctx.ui.notify(`/mcp setup: ${message}`, "error");
      requestRender();
      return;
    }
    const preview = computeImportPreview(state.hostConfigs, new Set(indices), existingNames);
    if (preview === null || preview.adding.length === 0) {
      setNotice("Nothing to add — the selected hosts contribute no new servers", "info");
      requestRender();
      return;
    }
    state.preview = preview;
    state.notice = null;
    state.mode = "preview";
    requestRender();
  }

  function cancelPreview(): void {
    state.preview = null;
    state.mode = "import";
    requestRender();
  }

  function confirmPreview(): void {
    const preview = state.preview;
    if (preview === null) {
      cancelPreview();
      return;
    }
    try {
      // The writer is add-if-absent — existing entries are untouched.
      mergeServerDefinitions(ctx.cwd, preview.defs);
    } catch (e) {
      // Failed write → stay in preview so the user can back out and retry.
      const message = e instanceof Error ? e.message : String(e);
      setNotice(message, "error");
      ctx.ui.notify(`/mcp setup: ${message}`, "error");
      requestRender();
      return;
    }
    state.checked.clear();
    const n = preview.adding.length;
    const summary = `✓ Added ${n} server${n === 1 ? "" : "s"} to .mcp.json — run /reload`;
    state.preview = null;
    setNotice(summary, "success");
    ctx.ui.notify(`${summary} to apply`, "info");
    state.mode = "import";
    requestRender();
  }

  function addKnown(): void {
    const known = KNOWN_SERVERS[state.knownCursor];
    if (known === undefined) return;
    try {
      if (existingProjectServerNames(ctx.cwd).includes(known.name)) {
        setNotice(`${known.name} is already in .mcp.json — kept as-is`, "info");
        ctx.ui.notify(`/mcp setup: ${known.name} already present in .mcp.json — kept as-is`, "info");
        requestRender();
        return;
      }
      mergeServerDefinitions(ctx.cwd, { [known.name]: known.def });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setNotice(message, "error");
      ctx.ui.notify(`/mcp setup: ${message}`, "error");
      requestRender();
      return;
    }
    setNotice(`✓ Added ${known.name} to .mcp.json — run /reload`, "success");
    ctx.ui.notify(`✓ Added ${known.name} to .mcp.json — run /reload to apply`, "info");
    requestRender();
  }

  function runScaffold(): void {
    const target = projectTarget();
    if (existsSync(target)) {
      // Never clobber an existing project file — say so instead.
      setNotice(".mcp.json already exists — not modified", "info");
      ctx.ui.notify("/mcp setup: .mcp.json already exists — not modified", "info");
      requestRender();
      return;
    }
    try {
      // Atomic tmp+rename in the same dir via the shared writer — a
      // 2-space stringification of the parsed scaffold is byte-identical
      // to SCAFFOLD_MCP_JSON itself.
      writeJsonFileAtomic(target, JSON.parse(SCAFFOLD_MCP_JSON));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setNotice(message, "error");
      ctx.ui.notify(`/mcp setup: ${message}`, "error");
      requestRender();
      return;
    }
    setNotice("✓ .mcp.json created — run /reload", "success");
    ctx.ui.notify("✓ Scaffolded .mcp.json — run /reload to apply", "info");
    requestRender();
  }

  // ── Input (per-mode handlers) ────────────────────────────────────────────

  function handleMenuInput(data: string): void {
    if (matchesKey(data, Key.up)) {
      if (state.menuCursor > 0) {
        state.menuCursor--;
        requestRender();
      }
      return;
    }
    if (matchesKey(data, Key.down)) {
      if (state.menuCursor < MENU_ACTIONS.length - 1) {
        state.menuCursor++;
        requestRender();
      }
      return;
    }
    if (matchesKey(data, Key.enter)) runMenuAction();
  }

  function handleImportInput(data: string): void {
    const rows = state.hostConfigs.length;
    if (matchesKey(data, Key.up)) {
      if (state.importCursor > 0) {
        state.importCursor--;
        requestRender();
      }
      return;
    }
    if (matchesKey(data, Key.down)) {
      if (rows > 0 && state.importCursor < rows - 1) {
        state.importCursor++;
        requestRender();
      }
      return;
    }
    if (rows === 0) return;
    if (matchesKey(data, Key.space)) {
      const i = state.importCursor;
      if (state.hostConfigs[i] === undefined) return;
      if (state.checked.has(i)) state.checked.delete(i);
      else state.checked.add(i);
      requestRender();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      // Preview (then confirm) just the checked row under the cursor.
      if (state.checked.has(state.importCursor)) openPreviewFor([state.importCursor]);
      return;
    }
    if (matchesKey(data, "w")) {
      const checked = [...state.checked].sort((a, b) => a - b);
      if (checked.length === 0) {
        setNotice("Check at least one source first ([space])", "info");
        requestRender();
      } else {
        openPreviewFor(checked);
      }
    }
  }

  function handlePreviewInput(data: string): void {
    if (matchesKey(data, Key.enter) || matchesKey(data, "y")) {
      confirmPreview();
      return;
    }
    if (matchesKey(data, "n")) cancelPreview();
  }

  function handleKnownInput(data: string): void {
    if (matchesKey(data, Key.up)) {
      if (state.knownCursor > 0) {
        state.knownCursor--;
        requestRender();
      }
      return;
    }
    if (matchesKey(data, Key.down)) {
      if (state.knownCursor < KNOWN_SERVERS.length - 1) {
        state.knownCursor++;
        requestRender();
      }
      return;
    }
    if (matchesKey(data, Key.enter)) addKnown();
  }

  function handleScaffoldInput(data: string): void {
    if (matchesKey(data, Key.enter)) runScaffold();
  }

  function handleInput(data: string): void {
    // ctrl+c closes from ANY mode (no confirm — nothing is written until a
    // confirm key is pressed, so there is nothing to lose).
    if (matchesKey(data, Key.ctrl("c"))) {
      closePanel();
      return;
    }
    // esc backs out a sub-mode; in the menu it closes the panel.
    if (matchesKey(data, Key.escape)) {
      if (state.mode === "menu") closePanel();
      else enterMenu();
      requestRender();
      return;
    }
    switch (state.mode) {
      case "menu":
        handleMenuInput(data);
        break;
      case "import":
        handleImportInput(data);
        break;
      case "preview":
        handlePreviewInput(data);
        break;
      case "known":
        handleKnownInput(data);
        break;
      case "scaffold":
        handleScaffoldInput(data);
        break;
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  function headerText(): string {
    switch (state.mode) {
      case "menu":
        return " MCP Setup ";
      case "import":
        return " MCP Setup — Import from another tool ";
      case "preview":
        return " MCP Setup — Confirm import ";
      case "known":
        return " MCP Setup — Known servers ";
      case "scaffold":
        return " MCP Setup — Scaffold .mcp.json ";
    }
  }

  function renderBody(contentWidth: number): string[] {
    switch (state.mode) {
      case "menu": {
        const lines: string[] = [];
        lines.push(theme.fg("dim", "Get started with MCP servers in this project:"));
        for (let i = 0; i < MENU_ACTIONS.length; i++) {
          const label = MENU_ACTIONS[i];
          if (label === undefined) continue;
          const prefix = i === state.menuCursor ? theme.fg("accent", "> ") : "  ";
          lines.push(hardTruncate(prefix + label, contentWidth));
        }
        return lines;
      }
      case "import": {
        const lines: string[] = [];
        if (state.hostConfigs.length === 0) {
          lines.push(theme.fg("dim", "No other-tool MCP configs found."));
          lines.push(theme.fg("dim", "(looked for cursor, claude-code, claude-desktop, vscode)"));
          return lines;
        }
        for (let i = 0; i < state.hostConfigs.length; i++) {
          const host = state.hostConfigs[i];
          if (host === undefined) continue;
          const count = Object.keys(host.servers).length;
          let line = `${state.checked.has(i) ? "[x]" : "[ ]"} ${padEnd(host.agent, 14)} ` +
            `${displayPath(host.path)} ${theme.fg("dim", `(${count})`)}`;
          if (i === state.importCursor) line = theme.fg("accent", line);
          lines.push(hardTruncate(line, contentWidth));
        }
        return lines;
      }
      case "preview": {
        const lines: string[] = [];
        const preview = state.preview;
        if (preview === null) {
          lines.push(theme.fg("dim", "Nothing to preview."));
          return lines;
        }
        lines.push(`Source : ${preview.sourceLabel}`);
        lines.push(`Target : ${displayPath(projectTarget())}`);
        const n = preview.adding.length;
        lines.push(`Will add ${n} server${n === 1 ? "" : "s"}:`);
        for (const name of preview.adding) lines.push(`  ${name}`);
        if (preview.alreadyPresent > 0) {
          lines.push(theme.fg("dim", `(${preview.alreadyPresent} already present — kept as-is)`));
        }
        return lines;
      }
      case "known": {
        const lines: string[] = [];
        for (let i = 0; i < KNOWN_SERVERS.length; i++) {
          const known = KNOWN_SERVERS[i];
          if (known === undefined) continue;
          let line = `${padEnd(known.name, 16)} ${known.summary}`;
          if (i === state.knownCursor) line = theme.fg("accent", line);
          lines.push(hardTruncate(line, contentWidth));
        }
        lines.push(theme.fg("dim", "add-if-absent: an existing entry is never overwritten"));
        return lines;
      }
      case "scaffold": {
        const lines: string[] = [];
        const exists = existsSync(projectTarget());
        lines.push(
          theme.fg(
            "dim",
            exists
              ? "Target file already exists — it will NOT be modified."
              : "Target file is absent — [enter] creates it.",
          ),
        );
        for (const jsonLine of SCAFFOLD_MCP_JSON.trimEnd().split("\n")) {
          lines.push(theme.fg("dim", jsonLine));
        }
        return lines;
      }
    }
  }

  function renderFooters(contentWidth: number): string[] {
    const parts = FOOTERS[state.mode];
    const single = parts.join("");
    // At the standard 84-char overlay width the import footer overflows the
    // 80-char content width and renderFooter does NOT wrap — so it is
    // pre-split into lines only when it overflows.
    if (visibleWidth(single) <= contentWidth) {
      return [renderFooter(single, contentWidth, theme)];
    }
    return parts.map((part) => renderFooter(part, contentWidth, theme));
  }

  function renderLines(contentWidth: number): string[] {
    const lines: string[] = [];

    lines.push(renderHeader(headerText(), contentWidth, theme));

    for (const line of renderBody(contentWidth)) {
      lines.push(hardTruncate(line, contentWidth));
    }

    // Transient result line (latest action's outcome).
    if (state.notice !== null) {
      const token =
        state.notice.tone === "error" ? "error" : state.notice.tone === "success" ? "success" : "dim";
      lines.push(hardTruncate(theme.fg(token, state.notice.text), contentWidth));
    }

    for (const footer of renderFooters(contentWidth)) lines.push(footer);

    return lines;
  }

  return {
    render(width: number): string[] {
      if (cachedLines !== undefined && cachedWidth === width) return cachedLines;
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
    },
  };
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Open the setup panel as a centered overlay (shared chrome, ADR 0003).
 * `pi` participates in the stable panel API (the management panel takes it
 * too) but is unused here — the setup flow only writes `<cwd>/.mcp.json`.
 */
export async function openMcpSetupPanel(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<void> {
  void pi;
  if (!ctx.hasUI) {
    ctx.ui.notify("/mcp setup requires an interactive TUI", "error");
    return;
  }

  await ctx.ui.custom<void>(
    (tui: TUI, theme: Theme, _keybindings, done: () => void) =>
      makeSetupPanel(tui, theme, done, ctx),
    { overlay: true, overlayOptions: OVERLAY_CHROME },
  );
}
