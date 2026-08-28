// ── Plugin manager: manifest + per-namespace `enabled` gate ──────────────
//
// Core is intentionally NOT in the manifest — it is always registered.
// Every other package meta composes is listed here. A plugin is "enabled"
// unless settings.json carries `archimedes.<pkg>.enabled === false` (the
// uniform default-on now lives in isConfigEnabled's strict `!== false`).
// A plugin is "installed" when its `load()` import resolves; a missing
// package is simply never registered (and hidden from the /plugins menu).

import { isConfigEnabled, setConfigEnabled, loadConfig, removeConfig } from "@pi-archimedes/core/settings-io";

export interface PluginDef {
  id: string;              // matches package npm name suffix, e.g. "mcp"
  label: string;           // human label, e.g. "MCP"
  description: string;     // one-liner shown in the menu
  namespace: string;       // "archimedes.mcp" — the settings.json key holding this plugin's { enabled, ...settings }
  load: () => Promise<unknown>; // lazy import for instance probing + future lazy mount
}

// Array order = menu display order. There is no separate order constant.
export const PLUGINS: PluginDef[] = [
  { id: "footer",       label: "Footer status bar",  description: "Status bar with cost/timer",                      namespace: "archimedes.footer",      load: () => import("@pi-archimedes/footer") },
  { id: "todo",         label: "Todo list",          description: "manage_todo_list tool + widget",                  namespace: "archimedes.todo",        load: () => import("@pi-archimedes/todo") },
  { id: "ask",          label: "Ask tool",           description: "Structured in-conversation questions",            namespace: "archimedes.ask",         load: () => import("@pi-archimedes/ask") },
  { id: "notify",       label: "Notifications",      description: "Delayed desktop notifications",                   namespace: "archimedes.notify",      load: () => import("@pi-archimedes/notify") },
  { id: "session-name", label: "Session naming",     description: "Auto session name via git diff",                  namespace: "archimedes.sessionName", load: () => import("@pi-archimedes/session-name") },
  { id: "diff",         label: "Diff rendering",     description: "Shiki-powered diff display",                      namespace: "archimedes.diff",        load: () => import("@pi-archimedes/diff") },
  { id: "image-paste",  label: "Image paste",        description: "Clipboard image paste",                           namespace: "archimedes.imagePaste",  load: () => import("@pi-archimedes/image-paste") },
  { id: "subagent",     label: "Subagents",          description: "Live subagent dispatch (general, reviewer, …)",  namespace: "archimedes.subagent",    load: () => import("@pi-archimedes/subagent") },
  { id: "mcp",          label: "MCP",                description: "MCP client adapter + /mcp commands",             namespace: "archimedes.mcp",         load: () => import("@pi-archimedes/mcp") },
  // future: sudo (plan-030) — added there; until then a non-existent entry is just "not installed"
];

// ── Gate: settings[archimedes.<pkg>].enabled, strict `!== false` ─────────
// Absent file/namespace/key = enabled; explicit false = disabled.

export function isPluginEnabled(id: string): boolean {
  const def = PLUGINS.find((p) => p.id === id);
  if (!def) return true; // unknown id defaults on (unchanged plan-031 semantics)
  return isConfigEnabled(def.namespace);
}

export function setPluginEnabled(id: string, enabled: boolean): boolean {
  const def = PLUGINS.find((p) => p.id === id);
  if (!def) return false;
  setConfigEnabled(def.namespace, enabled);
  return true;
}

// ── One-time migration: legacy archimedes.plugins { id → boolean } map ───
// Plan 031 stored the gate in a single standalone namespace. Only explicit
// false entries need moving (true / non-boolean = default-on = nothing to
// write); unknown ids are dropped and the legacy key is removed afterwards,
// so a second run is a no-op.

export function migrateLegacyPluginsMap(): void {
  const legacy = loadConfig("archimedes.plugins", {}) as Record<string, unknown>;
  if (Object.keys(legacy).length === 0) return; // nothing to do — idempotent on re-run
  for (const [id, value] of Object.entries(legacy)) {
    const def = PLUGINS.find((p) => p.id === id);
    if (!def) continue;                    // unknown id: drop
    if (value === false) setConfigEnabled(def.namespace, false);
    // explicit true / non-boolean: equals default-on → nothing to write
  }
  removeConfig("archimedes.plugins");
}
