// ── Plugin manager: manifest + archimedes.plugins registration gate ───────
//
// Core is intentionally NOT in the manifest — it is always registered.
// Every other package meta composes is listed here, default-enabled.
// A plugin is "installed" when its `load()` import resolves; a missing
// package is simply never registered (and hidden from the /plugins menu).

import { loadConfig, saveConfig } from "@pi-archimedes/core/settings-io";

export interface PluginDef {
  id: string;              // matches package npm name suffix, e.g. "mcp"
  label: string;           // human label, e.g. "MCP"
  description: string;     // one-liner shown in the menu
  defaultEnabled: boolean; // defaults to true for all current plugins
  load: () => Promise<unknown>; // lazy import for instance probing + future lazy mount
}

// Array order = menu display order. There is no separate order constant.
export const PLUGINS: PluginDef[] = [
  { id: "footer",       label: "Footer status bar",  description: "Status bar with cost/timer",                      defaultEnabled: true, load: () => import("@pi-archimedes/footer") },
  { id: "todo",         label: "Todo list",          description: "manage_todo_list tool + widget",              defaultEnabled: true, load: () => import("@pi-archimedes/todo") },
  { id: "ask",          label: "Ask tool",           description: "Structured in-conversation questions",            defaultEnabled: true, load: () => import("@pi-archimedes/ask") },
  { id: "notify",       label: "Notifications",      description: "Delayed desktop notifications",                defaultEnabled: true, load: () => import("@pi-archimedes/notify") },
  { id: "session-name", label: "Session naming",     description: "Auto session name via git diff",                 defaultEnabled: true, load: () => import("@pi-archimedes/session-name") },
  { id: "diff",         label: "Diff rendering",     description: "Shiki-powered diff display",                    defaultEnabled: true, load: () => import("@pi-archimedes/diff") },
  { id: "image-paste",  label: "Image paste",        description: "Clipboard image paste",                           defaultEnabled: true, load: () => import("@pi-archimedes/image-paste") },
  { id: "subagent",     label: "Subagents",          description: "Live subagent dispatch (general, reviewer, …)",  defaultEnabled: true, load: () => import("@pi-archimedes/subagent") },
  { id: "mcp",          label: "MCP",                description: "MCP client adapter + /mcp commands",              defaultEnabled: true, load: () => import("@pi-archimedes/mcp") },
  // future: sudo (plan-030) — added there; until then a non-existent entry is just "not installed"
];

// ── Config: archimedes.plugins is a partial { id → boolean } map ─────────
// Absent or true = enabled; explicit false = disabled.

export interface PluginsConfig { [id: string]: boolean }

const NAMESPACE = "archimedes.plugins";

export function loadPluginsConfig(): PluginsConfig {
  return loadConfig(NAMESPACE, {}) as PluginsConfig;
}

export function savePluginsConfig(cfg: PluginsConfig): void {
  saveConfig(NAMESPACE, cfg);
}

export function isPluginEnabled(id: string): boolean {
  const cfg = loadPluginsConfig();
  if (cfg[id] === false) return false;
  const def = PLUGINS.find((p) => p.id === id);
  return def ? def.defaultEnabled : true; // unknown id defaults on
}
