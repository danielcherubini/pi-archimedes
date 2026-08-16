/**
 * Settings Manager TUI component.
 * Center-screen overlay with 2 modes: List and Prompt (free-input field edit).
 * Mirrors the chrome of the /agents manager (see agent-manager.ts).
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { SettingItem } from "@earendil-works/pi-tui";
import { matchesKey, Key, CURSOR_MARKER, truncateToWidth } from "@earendil-works/pi-tui";
import {
  visibleWidth,
  padEnd,
  wrapText,
  renderHeader,
  renderFooter,
  wrapWithBorder,
  borderContentWidth,
} from "@pi-archimedes/core/overlay";

// ── Public types ────────────────────────────────────────────────────────────

export interface PromptDescriptor {
  kind: "text" | "number";
  label: string;
  min?: number;
}

export interface SettingsManagerOptions {
  items: SettingItem[];
  /** Free-input fields keyed by item.id — Enter on these opens prompt mode. */
  prompts: Record<string, PromptDescriptor>;
  theme: Theme;
  onChange: (id: string, newValue: string) => void;
  onSave: () => void;
  onClose: () => void;
}

// ── Constants ───────────────────────────────────────────────────────────────

const VISIBLE_ROWS = 20;

// ── State ───────────────────────────────────────────────────────────────────

interface SettingsManagerState {
  mode: "list" | "prompt";
  /** Index into filteredItems. */
  selectedIndex: number;
  /** "" = no search. */
  searchQuery: string;
  /** Search input armed (toggled by /, cleared by esc). */
  filterActive: boolean;
  /** Recomputed when searchQuery changes. */
  filteredItems: SettingItem[];
  /** item.id while in prompt mode. */
  promptField: string | null;
  /** Seeded from item.currentValue on prompt entry. */
  promptValue: string;
  promptError: string | null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function filterItemsByLabel(items: SettingItem[], query: string): SettingItem[] {
  if (!query) return items;
  const q = query.toLowerCase();
  return items.filter((item) => item.label.toLowerCase().includes(q));
}

/** ASCII printable — list-mode SEARCH input (matches the /agents agent-manager pattern). */
function isPrintableChar(data: string): boolean {
  return data.length === 1 && data >= " " && data <= "~";
}

/** Single non-control code unit — free-text PROMPT fields accept accented/Cyrillic/CJK chars. */
function isPromptTextChar(data: string): boolean {
  if (data.length !== 1) return false;
  const cp = data.codePointAt(0);
  if (cp === undefined) return false;
  // Accept single code points >= 0x20, excluding DEL (0x7f) and the C1 range (0x80..0x9f).
  if (cp < 0x20 || cp === 0x7f) return false;
  if (cp >= 0x80 && cp <= 0x9f) return false;
  return true;
}

// ── Component ───────────────────────────────────────────────────────────────

export function createSettingsManager(opts: SettingsManagerOptions): {
  render(width: number): string[];
  handleInput(data: string): void;
  invalidate(): void;
  dispose(): void;
} {
  const state: SettingsManagerState = {
    mode: "list",
    selectedIndex: 0,
    searchQuery: "",
    filterActive: false,
    filteredItems: opts.items,
    promptField: null,
    promptValue: "",
    promptError: null,
  };

  const theme = opts.theme;

  // ── Render (list mode) ──────────────────────────────────────────────────

  function renderList(contentWidth: number): string[] {
    const lines: string[] = [];

    lines.push(renderHeader(" Settings ", contentWidth, theme));
    lines.push(padEnd("", contentWidth));

    if (state.filterActive) {
      lines.push(padEnd(`Search: ${state.searchQuery}${CURSOR_MARKER}`, contentWidth));
    }

    lines.push(padEnd("", contentWidth));

    // Label column width: widest label across all items, capped at 30.
    const maxLabelWidth = Math.min(
      30,
      opts.items.reduce((max, item) => Math.max(max, visibleWidth(item.label)), 0),
    );

    const start = Math.max(
      0,
      Math.min(state.selectedIndex - 10, state.filteredItems.length - VISIBLE_ROWS),
    );
    const end = Math.min(start + VISIBLE_ROWS, state.filteredItems.length);

    for (let i = start; i < end; i++) {
      const item = state.filteredItems[i];
      if (!item) continue;
      const isCursor = i === state.selectedIndex;
      const prefix = isCursor ? "> " : "  ";

      // Truncate before padding so an over-long label can never overflow the row.
      const label = truncateToWidth(item.label, maxLabelWidth, "");
      const labelCol = isCursor
        ? theme.fg("accent", padEnd(label, maxLabelWidth))
        : padEnd(label, maxLabelWidth);

      // Compose the full value string (with edit marker) BEFORE truncation so
      // the marker is never clipped.
      const descriptor = opts.prompts[item.id];
      const valueString = descriptor
        ? `${item.currentValue}  ${theme.fg("dim", "edit…")}`
        : item.currentValue;
      const remainingWidth = Math.max(1, contentWidth - 2 - maxLabelWidth - 2);
      const valueCol = isCursor
        ? truncateToWidth(valueString, remainingWidth, "")
        : theme.fg("dim", truncateToWidth(valueString, remainingWidth, ""));

      lines.push(padEnd(`${prefix}${labelCol}  ${valueCol}`, contentWidth));
    }

    // Feedback when search filters to zero items.
    if (state.filteredItems.length === 0) {
      lines.push(padEnd(theme.fg("dim", "No matching settings"), contentWidth));
    }

    // Scroll indicator
    if (state.filteredItems.length > VISIBLE_ROWS) {
      lines.push(theme.fg("dim", `  (${state.selectedIndex + 1}/${state.filteredItems.length})`));
    }

    // Description of the selected item
    const selected = state.filteredItems[state.selectedIndex];
    if (selected && selected.description) {
      lines.push(padEnd("", contentWidth));
      for (const line of wrapText(selected.description, contentWidth - 2)) {
        lines.push(theme.fg("dim", `  ${line}`));
      }
    }

    lines.push(padEnd("", contentWidth));
    lines.push(
      renderFooter(
        " [↑↓] move  [←→] value  [enter] edit  [/] search  [s] save  [esc] close ",
        contentWidth,
        theme,
      ),
    );

    return lines;
  }

  // ── Render (prompt mode) ────────────────────────────────────────────────

  function renderPrompt(width: number): string[] {
    const contentWidth = borderContentWidth(width);
    const descriptor = state.promptField ? opts.prompts[state.promptField] : undefined;
    // Guard the impossible state — render must be total and the overlay frame
    // must never collapse, even without a descriptor.
    if (!descriptor) return wrapWithBorder([], width, theme);

    const lines: string[] = [];

    lines.push(renderHeader(" Settings ", contentWidth, theme));
    lines.push(padEnd("", contentWidth));
    lines.push(padEnd("", contentWidth));
    lines.push(theme.fg("dim", `  ${descriptor.label}`));
    lines.push(padEnd(`  ${state.promptValue}${CURSOR_MARKER}`, contentWidth));
    lines.push(padEnd("", contentWidth));
    if (state.promptError) {
      lines.push(theme.fg("error", `  ${state.promptError}`));
    }
    lines.push(padEnd("", contentWidth));
    lines.push(renderFooter(" [enter] confirm  [esc] cancel ", contentWidth, theme));

    return wrapWithBorder(lines, width, theme);
  }

  function render(width: number): string[] {
    if (state.mode === "prompt") return renderPrompt(width);
    return wrapWithBorder(renderList(borderContentWidth(width)), width, theme);
  }

  // ── Input (list mode) ───────────────────────────────────────────────────

  function handleListInput(data: string): void {
    if (matchesKey(data, Key.up)) {
      if (state.filteredItems.length === 0) return;
      state.selectedIndex =
        (state.selectedIndex - 1 + state.filteredItems.length) % state.filteredItems.length;
    } else if (matchesKey(data, Key.down)) {
      if (state.filteredItems.length === 0) return;
      state.selectedIndex = (state.selectedIndex + 1) % state.filteredItems.length;
    } else if (matchesKey(data, Key.left) || matchesKey(data, Key.right)) {
      const item = state.filteredItems[state.selectedIndex];
      if (!item || !item.values || item.values.length <= 1) return;
      const values = item.values;
      const currentIdx = Math.max(0, values.indexOf(item.currentValue));
      const nextIndex = matchesKey(data, Key.left)
        ? (currentIdx - 1 + values.length) % values.length
        : (currentIdx + 1) % values.length;
      const next = values[nextIndex];
      if (next === undefined) return;
      item.currentValue = next;
      opts.onChange(item.id, next);
    } else if (matchesKey(data, Key.enter)) {
      const item = state.filteredItems[state.selectedIndex];
      if (!item) return;
      if (opts.prompts[item.id]) {
        state.mode = "prompt";
        state.promptField = item.id;
        state.promptValue = item.currentValue;
        state.promptError = null;
      }
    } else if (matchesKey(data, "/")) {
      // Re-pressing while active is a no-op.
      state.filterActive = true;
    } else if (matchesKey(data, Key.backspace)) {
      if (state.filterActive && state.searchQuery.length > 0) {
        state.searchQuery = state.searchQuery.slice(0, -1);
        state.filteredItems = filterItemsByLabel(opts.items, state.searchQuery);
        state.selectedIndex = 0;
      }
    } else if (matchesKey(data, Key.escape)) {
      if (state.filterActive) {
        state.searchQuery = "";
        state.filterActive = false;
        state.filteredItems = opts.items;
        state.selectedIndex = 0;
      } else {
        opts.onClose();
      }
    } else if (isPrintableChar(data) && state.filterActive) {
      // Must come before the "s" branch so typing "s" in search doesn't save.
      state.searchQuery += data;
      state.filteredItems = filterItemsByLabel(opts.items, state.searchQuery);
      state.selectedIndex = 0;
    } else if (matchesKey(data, "s")) {
      if (!state.filterActive) {
        opts.onSave();
      }
    }
  }

  // ── Input (prompt mode) ─────────────────────────────────────────────────

  function handlePromptInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      // Discard typed value — item.currentValue untouched.
      state.mode = "list";
      state.promptField = null;
      state.promptError = null;
    } else if (matchesKey(data, Key.enter)) {
      const field = state.promptField;
      const descriptor = field ? opts.prompts[field] : undefined;
      if (!field || !descriptor) {
        state.mode = "list";
        state.promptField = null;
        state.promptError = null;
        return;
      }

      // Resolve the item FIRST — never mutate config if the target is gone.
      const item = opts.items.find((i) => i.id === field);
      if (!item) {
        state.mode = "list";
        state.promptField = null;
        state.promptError = null;
        return;
      }

      let normalized: string;
      if (descriptor.kind === "number") {
        const n = parseInt(state.promptValue, 10);
        if (!Number.isFinite(n) || n < (descriptor.min ?? 0)) {
          state.promptError = "must be >= " + (descriptor.min ?? 0);
          return;
        }
        normalized = String(n);
      } else {
        normalized = state.promptValue;
      }

      opts.onChange(field, normalized);
      item.currentValue = normalized;
      state.mode = "list";
      state.promptField = null;
      state.promptError = null;
      // selectedIndex stays on the field.
    } else if (matchesKey(data, Key.backspace)) {
      if (state.promptValue.length > 0) {
        state.promptValue = state.promptValue.slice(0, -1);
        state.promptError = null;
      }
    } else if (isPromptTextChar(data)) {
      const field = state.promptField;
      const descriptor = field ? opts.prompts[field] : undefined;
      if (!descriptor) return;
      // Number fields accept digits only (matches the old submenu behavior).
      if (descriptor.kind === "number" && !/^\d$/.test(data)) return;
      state.promptValue += data;
      state.promptError = null;
    }
    // Unmatched control/navigation input is swallowed in prompt mode;
    // printable chars (including s, /) are appended as text.
  }

  function handleInput(data: string): void {
    if (state.mode === "prompt") {
      handlePromptInput(data);
    } else {
      handleListInput(data);
    }
  }

  return {
    render,
    handleInput,

    invalidate(): void {
      // No-op — the component owns all of its state.
    },

    dispose(): void {
      // No timers or subscriptions to clean up.
    },
  };
}
