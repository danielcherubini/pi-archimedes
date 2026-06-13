/**
 * Agent Manager TUI component.
 * Overlay with 5 screens: List, Detail, Edit, Name Input, Confirm Delete.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  matchesKey,
  Key,
  truncateToWidth,
  CURSOR_MARKER,
} from "@earendil-works/pi-tui";
import type { AgentConfig } from "./agents.js";
import { discoverAgentsAll } from "./agents.js";
import { serializeAgent, validateAgentName } from "./frontmatter-io.js";

// ── Screen constants ────────────────────────────────────────────────────────

const LIST_VIEWPORT = 8;
const EDIT_FIELDS = ["name", "description", "tools", "model", "thinking"] as const;
type EditField = (typeof EDIT_FIELDS)[number];

// ── Theme helper type ───────────────────────────────────────────────────────

interface Theme {
  fg(token: string, text: string): string;
  bold(text: string): string;
}

// ── TUI context ─────────────────────────────────────────────────────────────

interface TUIContext {
  requestRender(): void;
}

// ── Manager state ───────────────────────────────────────────────────────────

interface ManagerState {
  screen: "list" | "detail" | "edit" | "name-input" | "confirm-delete";
  agents: AgentConfig[];
  userAgents: AgentConfig[];
  projectAgents: AgentConfig[];
  userDir: string;
  projectDir: string | null;

  // List state
  listCursor: number;
  listScroll: number;
  filterQuery: string;
  filterMode: boolean;

  // Detail state
  detailAgent: AgentConfig | null;
  detailScroll: number;

  // Edit state
  editAgent: AgentConfig | null;
  editFieldIndex: number;
  editInField: boolean;
  editDirty: boolean;
  editFieldCursor: number;
  editPromptMode: boolean;       // true when editing systemPrompt via 'p'
  editPromptCursor: number;      // cursor position in prompt text
  editPromptScroll: number;      // scroll offset for prompt editor
  editDiscardPrompt: boolean;    // true when asking y/n to discard changes
  editError: string | null;

  // Name input state
  nameInputBuffer: string;
  nameInputCursor: number;
  nameInputScope: "user" | "project";
  nameInputMode: "new" | "clone";
  nameInputSource: AgentConfig | null;
  nameInputError: string | null;

  // Confirm delete state
  deleteTarget: AgentConfig | null;
  deleteFromScreen: "list" | "detail";

  // New agent tracking
  isNew: boolean;

  // Render width (stored so input handlers can compute correct scroll bounds)
  lastWidth: number;
}

// ── Component return type ───────────────────────────────────────────────────

interface Component {
  render(width: number): string[];
  handleInput(data: string): void;
  invalidate(): void;
  dispose(): void;
}

// ── Helper functions ────────────────────────────────────────────────────────

function fuzzyFilter(items: AgentConfig[], query: string): AgentConfig[] {
  if (!query) return items;
  const q = query.toLowerCase();
  return items.filter(
    (a) =>
      a.name.toLowerCase().includes(q) ||
      a.description.toLowerCase().includes(q),
  );
}

function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [];
  const lines: string[] = [];
  const paragraphs = text.split("\n");
  for (const para of paragraphs) {
    if (para.length === 0) {
      lines.push("");
      continue;
    }
    const words = para.split(/(\s+)/).filter(Boolean);
    let current = "";
    for (const word of words) {
      const test = current === "" ? word : current + word;
      if (test.length > width && current.length > 0) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

function padEnd(text: string, width: number): string {
  if (width <= 0) return "";
  const vw = visibleWidth(text);
  if (vw >= width) return text;
  return text + " ".repeat(width - vw);
}

function visibleWidth(text: string): number {
  // Strip ANSI escape sequences for width calculation
  return text.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function row(text: string, width: number, theme: Theme): string {
  return padEnd(text, width);
}

function renderHeader(text: string, width: number, theme: Theme): string {
  return theme.fg("accent", padEnd(text, width));
}

function renderFooter(text: string, width: number, theme: Theme): string {
  return theme.fg("dim", padEnd(text, width));
}

function scopeLabel(source: "user" | "project"): string {
  return source === "user" ? "user" : "proj";
}

function agentModel(a: AgentConfig): string {
  return a.model ?? "default";
}

// ── List screen ─────────────────────────────────────────────────────────────

function renderList(state: ManagerState, width: number, theme: Theme): string[] {
  const lines: string[] = [];
  const filtered = fuzzyFilter(state.agents, state.filterQuery);

  // Header
  lines.push(renderHeader(` Agents [${state.agents.length}] `, width, theme));

  // Search bar
  if (state.filterMode || state.filterQuery.length > 0) {
    const cursor = state.filterMode ? CURSOR_MARKER : "";
    const queryText = state.filterQuery.length > 0 ? state.filterQuery : "type to filter...";
    const placeholder = state.filterQuery.length === 0;
    const searchLine = `◎ ${placeholder ? theme.fg("dim", queryText) : queryText}${cursor}`;
    lines.push(padEnd(searchLine, width));
  } else {
    lines.push(padEnd(`◎ ${theme.fg("dim", "type to filter...")}`, width));
  }

  // Agent rows or empty state
  const start = state.listScroll;
  const end = Math.min(start + LIST_VIEWPORT, filtered.length);

  if (filtered.length === 0) {
    lines.push(padEnd("", width));
    lines.push(padEnd(theme.fg("dim", "No agents found"), width));
    lines.push(padEnd(theme.fg("dim", "Press n to create your first agent"), width));
  } else {
    for (let i = start; i < end; i++) {
      const agent = filtered[i];
      if (!agent) continue;
      const isCursor = i === state.listCursor;
      const cursorMark = isCursor ? ">" : " ";

      const name = truncateToWidth(agent.name, 16);
      const model = truncateToWidth(agentModel(agent), 12);
      const scope = `[${scopeLabel(agent.source)}]`;
      const desc = truncateToWidth(agent.description, Math.max(1, width - 1 - 16 - 1 - 12 - 1 - 8 - 1));

      const nameCol = isCursor
        ? theme.fg("accent", padEnd(name, 16))
        : padEnd(name, 16);
      const modelCol = theme.fg("dim", padEnd(model, 12));
      const scopeCol = theme.fg("dim", padEnd(scope, 8));
      const descCol = theme.fg("dim", desc);

      const line = `${cursorMark} ${nameCol} ${modelCol} ${scopeCol} ${descCol}`;
      lines.push(padEnd(line, width));
    }
  }

  // Fill remaining viewport rows
  while (lines.length < 2 + LIST_VIEWPORT + 2) {
    lines.push(padEnd("", width));
  }

  // Preview bar
  if (filtered.length > 0 && state.listCursor >= 0 && state.listCursor < filtered.length) {
    const previewAgent = filtered[state.listCursor];
    if (!previewAgent) {
      lines.push(padEnd("", width));
    } else {
      const preview = theme.fg(
        "dim",
        truncateToWidth(`Preview: ${previewAgent.description}`, width),
      );
      lines.push(preview);
    }
  }

  // Footer
  lines.push(renderFooter(" [enter] view  [n] new  [c] clone  [d] delete  [/] search  [esc] close ", width, theme));

  return lines;
}

function handleListInput(
  state: ManagerState,
  data: string,
  done: () => void,
  requestRender: () => void,
): "close" | void {
  const filtered = fuzzyFilter(state.agents, state.filterQuery);

  if (matchesKey(data, Key.up)) {
    if (state.listCursor > 0) {
      state.listCursor--;
      if (state.listCursor < state.listScroll) {
        state.listScroll = state.listCursor;
      }
      requestRender();
    }
  } else if (matchesKey(data, Key.down)) {
    if (state.listCursor < filtered.length - 1) {
      state.listCursor++;
      if (state.listCursor >= state.listScroll + LIST_VIEWPORT) {
        state.listScroll = state.listCursor - LIST_VIEWPORT + 1;
      }
      requestRender();
    }
  } else if (matchesKey(data, Key.enter)) {
    const selected = filtered[state.listCursor];
    if (selected) {
      state.screen = "detail";
      state.detailAgent = selected;
      state.detailScroll = 0;
      requestRender();
    }
  } else if (matchesKey(data, "n")) {
    state.screen = "name-input";
    state.nameInputMode = "new";
    state.nameInputBuffer = "";
    state.nameInputCursor = 0;
    state.nameInputScope = "user";
    state.nameInputSource = null;
    state.nameInputError = null;
    state.isNew = true;
    requestRender();
  } else if (matchesKey(data, "c")) {
    const source = filtered[state.listCursor];
    if (source) {
      state.screen = "name-input";
      state.nameInputMode = "clone";
      state.nameInputBuffer = `${source.name}-copy`;
      state.nameInputCursor = state.nameInputBuffer.length;
      state.nameInputScope = source.source;
      state.nameInputSource = source;
      state.nameInputError = null;
      state.isNew = true;
      requestRender();
    }
  } else if (matchesKey(data, "d")) {
    const target = filtered[state.listCursor];
    if (target) {
      state.screen = "confirm-delete";
      state.deleteTarget = target;
      state.deleteFromScreen = "list";
      requestRender();
    }
  } else if (matchesKey(data, "/")) {
    state.filterMode = true;
    requestRender();
  } else if (matchesKey(data, Key.backspace)) {
    if (state.filterQuery.length > 0) {
      state.filterQuery = state.filterQuery.slice(0, -1);
      state.listCursor = 0;
      state.listScroll = 0;
      requestRender();
    }
  } else if (matchesKey(data, Key.escape)) {
    if (state.filterQuery.length > 0) {
      state.filterQuery = "";
      state.filterMode = false;
      state.listCursor = 0;
      state.listScroll = 0;
      requestRender();
    } else {
      return "close";
    }
  } else {
    // Single printable char
    if (state.filterMode || state.filterQuery.length > 0) {
      if (data.length === 1 && data >= " " && data <= "~") {
        state.filterQuery += data;
        state.filterMode = false;
        state.listCursor = 0;
        state.listScroll = 0;
        requestRender();
      }
    }
  }
}

// ── Detail screen ───────────────────────────────────────────────────────────

function renderDetail(state: ManagerState, width: number, theme: Theme): string[] {
  const lines: string[] = [];
  const agent = state.detailAgent;
  if (!agent) {
    lines.push(renderHeader(" No agent selected ", width, theme));
    lines.push(renderFooter(" [esc] back ", width, theme));
    return lines;
  }

  // Header
  lines.push(renderHeader(` Agent: ${agent.name} [${scopeLabel(agent.source)}] `, width, theme));

  // Frontmatter section
  const fieldLines: string[] = [];
  fieldLines.push(theme.fg("accent", `name:`) + ` ${agent.name}`);
  fieldLines.push(theme.fg("accent", `description:`) + ` ${agent.description}`);
  if (agent.tools && agent.tools.length > 0) {
    fieldLines.push(theme.fg("accent", `tools:`) + ` ${agent.tools.join(", ")}`);
  } else {
    fieldLines.push(theme.fg("accent", `tools:`) + ` ${theme.fg("dim", "(none)")}`);
  }
  fieldLines.push(theme.fg("accent", `model:`) + ` ${agentModel(agent)}`);
  fieldLines.push(theme.fg("accent", `thinking:`) + ` ${agent.thinking ?? theme.fg("dim", "(none)")}`);

  for (const fl of fieldLines) {
    lines.push(padEnd(fl, width));
  }

  // Extra fields
  if (agent.extraFields && Object.keys(agent.extraFields).length > 0) {
    lines.push(padEnd(theme.fg("dim", "─".repeat(width)), width));
    for (const [key, value] of Object.entries(agent.extraFields).sort()) {
      lines.push(padEnd(theme.fg("dim", `${key}: ${value}`), width));
    }
  }

  // Body separator
  lines.push(padEnd(theme.fg("dim", "---"), width));

  // Body (systemPrompt) - scrollable
  const bodyLines = wrapText(agent.systemPrompt, width);
  const bodyViewport = Math.max(6, 14 - lines.length);
  const bodyStart = state.detailScroll;
  const bodyEnd = Math.min(bodyStart + bodyViewport, bodyLines.length);

  // Scroll indicator: more above
  if (bodyStart > 0) {
    lines.push(padEnd(theme.fg("dim", `↑ ${bodyStart} more`), width));
  }

  for (let i = bodyStart; i < bodyEnd; i++) {
    const line = bodyLines[i];
    if (line != null) lines.push(padEnd(line, width));
  }

  // Scroll indicator: more below
  const remainingBelow = bodyLines.length - bodyEnd;
  if (remainingBelow > 0) {
    lines.push(padEnd(theme.fg("dim", `↓ ${remainingBelow} more`), width));
  }

  // Footer
  lines.push(renderFooter(" [e] edit  [d] delete  [esc] back ", width, theme));

  return lines;
}

function handleDetailInput(
  state: ManagerState,
  data: string,
  requestRender: () => void,
): void {
  if (matchesKey(data, Key.up)) {
    if (state.detailScroll > 0) {
      state.detailScroll--;
      requestRender();
    }
  } else if (matchesKey(data, Key.down)) {
    if (state.detailAgent) {
      const bodyLines = wrapText(state.detailAgent.systemPrompt, state.lastWidth);
      const bodyViewport = Math.max(6, 14 - 9);
      if (state.detailScroll < bodyLines.length - bodyViewport) {
        state.detailScroll++;
        requestRender();
      }
    }
    requestRender();
  } else if (matchesKey(data, "e")) {
    // Create mutable copy
    const agent = state.detailAgent;
    if (agent) {
      state.screen = "edit";
      const copy: AgentConfig = { ...agent };
      if (agent.tools) copy.tools = [...agent.tools];
      state.editAgent = copy;
      state.editFieldIndex = 0;
      state.editInField = false;
      state.editDirty = false;
      state.editFieldCursor = 0;
      state.editPromptMode = false;
      state.editPromptCursor = 0;
      state.editPromptScroll = 0;
      state.editDiscardPrompt = false;
      state.editError = null;
      state.isNew = false;
      requestRender();
    }
  } else if (matchesKey(data, "d")) {
    state.screen = "confirm-delete";
    state.deleteTarget = state.detailAgent;
    state.deleteFromScreen = "detail";
    requestRender();
  } else if (matchesKey(data, Key.escape)) {
    state.screen = "list";
    requestRender();
  }
}

// ── Edit screen ─────────────────────────────────────────────────────────────

function renderEdit(state: ManagerState, width: number, theme: Theme): string[] {
  const lines: string[] = [];
  const agent = state.editAgent;
  if (!agent) return lines;

  // Discard prompt
  if (state.editDiscardPrompt) {
    lines.push(renderHeader(" Discard changes? ", width, theme));
    lines.push(padEnd("", width));
    lines.push(padEnd(theme.fg("dim", "Unsaved changes will be lost."), width));
    lines.push(padEnd("", width));
    lines.push(renderFooter(" [y] discard  [n / esc] keep editing ", width, theme));
    return lines;
  }

  // Header
  const dirtyMark = state.editDirty ? " *" : "";
  lines.push(renderHeader(` Edit: ${agent.name}${dirtyMark} `, width, theme));

  // Error line
  if (state.editError) {
    lines.push(padEnd(theme.fg("error", `Error: ${state.editError}`), width));
  }

  // System prompt edit mode
  if (state.editPromptMode) {
    lines.push(padEnd(theme.fg("dim", "systemPrompt:"), width));
    const promptLines = wrapText(agent.systemPrompt, width);
    const promptViewport = Math.max(6, 14 - lines.length - 2);
    const promptStart = state.editPromptScroll;
    const promptEnd = Math.min(promptStart + promptViewport, promptLines.length);

    for (let i = promptStart; i < promptEnd; i++) {
      const line = promptLines[i];
      if (line != null) lines.push(padEnd(line, width));
    }

    // Hint line
    lines.push(padEnd(theme.fg("dim", " [↑↓] scroll  [ctrl+s] save  [esc] done "), width));
    return lines;
  }

  // Field list
  const fields: { key: EditField; value: string; empty: boolean }[] = EDIT_FIELDS.map((key) => {
    let value: string;
    let empty: boolean;
    switch (key) {
      case "name":
        value = agent.name;
        empty = false;
        break;
      case "description":
        value = agent.description;
        empty = value.length === 0;
        break;
      case "tools":
        value = agent.tools ? agent.tools.join(", ") : "";
        empty = value.length === 0;
        break;
      case "model":
        value = agent.model ?? "";
        empty = value.length === 0;
        break;
      case "thinking":
        value = agent.thinking ?? "";
        empty = value.length === 0;
        break;
    }
    return { key, value, empty };
  });

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (!field) continue;
    const { key, value, empty } = field;
    const isCurrent = i === state.editFieldIndex;
    const prefix = isCurrent ? "> " : "  ";

    if (isCurrent && state.editInField) {
      // In-field editing
      const label = `${key}: `;
      const labelWidth = visibleWidth(label);
      const availWidth = width - labelWidth - 2; // prefix takes 2

      if (key === "description") {
        // Multi-line description editing (3 lines viewport)
        const descLines = wrapText(value, availWidth);
        lines.push(padEnd(`${prefix}${label}`, width));
        for (let j = 0; j < 3 && j < descLines.length; j++) {
          const descLine = descLines[j];
          const lineContent = padEnd(descLine ?? "", availWidth);
          // Place cursor at end of last visible line
          const displayLine = j === 2 || j === descLines.length - 1
            ? lineContent + CURSOR_MARKER
            : lineContent;
          lines.push(padEnd(`  ${displayLine}`, width));
        }
      } else {
        // Single-line editing
        const truncated = truncateToWidth(value, availWidth);
        const inputLine = `${prefix}${label}${truncated}${CURSOR_MARKER}`;
        lines.push(padEnd(inputLine, width));
      }
    } else {
      // Normal field display
      const label = `${key}: `;
      const displayValue = empty
        ? theme.fg("dim", "(not set)")
        : truncateToWidth(value, width - visibleWidth(prefix + label));
      const display = isCurrent
        ? theme.fg("accent", `${prefix}${label}`) + displayValue
        : `${prefix}${label}${displayValue}`;
      lines.push(padEnd(display, width));
    }
  }

  // Hint
  lines.push(renderFooter(" [↑↓] fields  [enter] edit  [p] prompt  [ctrl+s] save  [esc] back ", width, theme));

  return lines;
}

function handleEditInput(
  state: ManagerState,
  data: string,
  requestRender: () => void,
): void {
  // Discard prompt handling
  if (state.editDiscardPrompt) {
    if (matchesKey(data, "y")) {
      state.editDiscardPrompt = false;
      state.editDirty = false;
      // Re-read from original
      if (state.detailAgent) {
        const origCopy: AgentConfig = { ...state.detailAgent };
        if (state.detailAgent.tools) origCopy.tools = [...state.detailAgent.tools];
        state.editAgent = origCopy;
      }
      state.editFieldIndex = 0;
      state.editInField = false;
      state.editPromptMode = false;
      state.editError = null;
      requestRender();
    } else if (matchesKey(data, "n") || matchesKey(data, Key.escape)) {
      state.editDiscardPrompt = false;
      requestRender();
    }
    return;
  }

  if (!state.editAgent) return;

  // System prompt edit mode
  if (state.editPromptMode) {
    if (matchesKey(data, Key.ctrl("s"))) {
      state.editDirty = true;
      requestRender();
    } else if (matchesKey(data, Key.escape)) {
      state.editPromptMode = false;
      state.editDirty = true;
      requestRender();
    } else if (matchesKey(data, Key.up)) {
      if (state.editPromptScroll > 0) {
        state.editPromptScroll--;
        requestRender();
      }
    } else if (matchesKey(data, Key.down)) {
      const promptLines = wrapText(state.editAgent.systemPrompt, state.lastWidth);
      const promptViewport = Math.max(6, 14 - 4 - 2);
      if (state.editPromptScroll < promptLines.length - promptViewport) {
        state.editPromptScroll++;
        requestRender();
      }
    } else if (data.length === 1 && data >= " " && data <= "~") {
      // Append char to systemPrompt at cursor
      const before = state.editAgent.systemPrompt.slice(0, state.editPromptCursor);
      const after = state.editAgent.systemPrompt.slice(state.editPromptCursor);
      state.editAgent.systemPrompt = before + data + after;
      state.editPromptCursor++;
      state.editDirty = true;
      requestRender();
    } else if (matchesKey(data, Key.backspace)) {
      if (state.editPromptCursor > 0) {
        const before = state.editAgent.systemPrompt.slice(0, state.editPromptCursor - 1);
        const after = state.editAgent.systemPrompt.slice(state.editPromptCursor);
        state.editAgent.systemPrompt = before + after;
        state.editPromptCursor--;
        state.editDirty = true;
        requestRender();
      }
    }
    return;
  }

  // In-field edit mode
  if (state.editInField) {
    const field = EDIT_FIELDS[state.editFieldIndex];
    if (!field) return;
    if (matchesKey(data, Key.enter)) {
      // Exit field edit, mark dirty
      state.editInField = false;
      state.editDirty = true;
      requestRender();
    } else if (matchesKey(data, Key.escape)) {
      state.editInField = false;
      state.editDirty = true;
      requestRender();
    } else if (matchesKey(data, Key.ctrl("a"))) {
      state.editFieldCursor = 0;
      requestRender();
    } else if (matchesKey(data, Key.ctrl("e"))) {
      const val = getFieldValue(state.editAgent, field);
      state.editFieldCursor = val.length;
      requestRender();
    } else if (matchesKey(data, Key.left)) {
      if (state.editFieldCursor > 0) {
        state.editFieldCursor--;
        requestRender();
      }
    } else if (matchesKey(data, Key.right)) {
      const val = getFieldValue(state.editAgent, field);
      if (state.editFieldCursor < val.length) {
        state.editFieldCursor++;
        requestRender();
      }
    } else if (matchesKey(data, Key.backspace)) {
      if (state.editFieldCursor > 0) {
        const val = getFieldValue(state.editAgent, field);
        const newVal = val.slice(0, state.editFieldCursor - 1) + val.slice(state.editFieldCursor);
        setFieldValue(state.editAgent, field, newVal);
        state.editFieldCursor--;
        state.editDirty = true;
        requestRender();
      }
    } else if (data.length === 1 && data >= " " && data <= "~") {
      const val = getFieldValue(state.editAgent, field);
      const newVal = val.slice(0, state.editFieldCursor) + data + val.slice(state.editFieldCursor);
      setFieldValue(state.editAgent, field, newVal);
      state.editFieldCursor++;
      state.editDirty = true;
      requestRender();
    }
    return;
  }

  // Normal edit mode (field cycling)
  if (matchesKey(data, Key.up)) {
    if (state.editFieldIndex > 0) {
      state.editFieldIndex--;
      requestRender();
    }
  } else if (matchesKey(data, Key.down)) {
    if (state.editFieldIndex < EDIT_FIELDS.length - 1) {
      state.editFieldIndex++;
      requestRender();
    }
  } else if (matchesKey(data, Key.enter)) {
    const field = EDIT_FIELDS[state.editFieldIndex];
    if (field) {
      state.editInField = true;
      state.editFieldCursor = getFieldValue(state.editAgent, field).length;
      requestRender();
    }
  } else if (matchesKey(data, "p")) {
    state.editPromptMode = true;
    state.editPromptCursor = state.editAgent.systemPrompt.length;
    state.editPromptScroll = 0;
    requestRender();
  } else if (matchesKey(data, Key.ctrl("s"))) {
    saveAgent(state, requestRender);
  } else if (matchesKey(data, Key.escape)) {
    if (state.editDirty) {
      state.editDiscardPrompt = true;
      requestRender();
    } else {
      state.screen = "detail";
      requestRender();
    }
  }
}

function getFieldValue(agent: AgentConfig, field: EditField): string {
  switch (field) {
    case "name":
      return agent.name;
    case "description":
      return agent.description;
    case "tools":
      return agent.tools ? agent.tools.join(", ") : "";
    case "model":
      return agent.model ?? "";
    case "thinking":
      return agent.thinking ?? "";
  }
}

function setFieldValue(agent: AgentConfig, field: EditField, value: string): void {
  switch (field) {
    case "name":
      agent.name = value;
      break;
    case "description":
      agent.description = value;
      break;
    case "tools": {
      const parsed = value
        ? value.split(",").map((t) => t.trim()).filter(Boolean)
        : [];
      if (parsed.length > 0) {
        agent.tools = parsed;
      } else {
        delete agent.tools;
      }
      break;
    }
    case "model":
      if (value) {
        agent.model = value;
      } else {
        delete agent.model;
      }
      break;
    case "thinking":
      if (value) {
        agent.thinking = value;
      } else {
        delete agent.thinking;
      }
      break;
  }
}

// ── Save logic ──────────────────────────────────────────────────────────────

function saveAgent(state: ManagerState, requestRender: () => void): void {
  if (!state.editAgent) return;

  const agent = state.editAgent;

  // Validate name
  const nameError = validateAgentName(agent.name);
  if (nameError) {
    state.editError = nameError;
    requestRender();
    return;
  }

  // Check duplicate name within same scope
  const duplicate = state.agents.find(
    (a) => a.source === agent.source && a.name === agent.name && a.filePath !== agent.filePath,
  );
  if (duplicate) {
    state.editError = `Agent "${agent.name}" already exists in ${agent.source} scope`;
    requestRender();
    return;
  }

  // Determine target directory
  const dir = agent.source === "user" ? state.userDir : state.projectDir;
  if (!dir) {
    state.editError = "Target directory not available";
    requestRender();
    return;
  }

  const oldPath = agent.filePath;
  const newName = agent.name.endsWith(".md") ? agent.name : `${agent.name}.md`;
  const newPath = path.join(dir, newName);

  try {
    // Ensure directory exists
    fs.mkdirSync(dir, { recursive: true });

    // Serialize and write
    const content = serializeAgent(agent);
    fs.writeFileSync(newPath, content, "utf-8");

    // Handle rename if name changed
    if (oldPath && oldPath !== newPath) {
      try {
        fs.unlinkSync(oldPath);
      } catch {
        // Old file may not exist (e.g., new agent)
      }
    }

    // Update filePath
    agent.filePath = newPath;

    // Refresh agents list
    const cwd = process.cwd();
    const discovery = discoverAgentsAll(cwd);
    state.userAgents = discovery.user;
    state.projectAgents = discovery.project;
    state.agents = [...discovery.user, ...discovery.project];

    // Find the saved agent and switch to detail
    const savedAgent = state.agents.find((a) => a.name === agent.name && a.source === agent.source);
    if (savedAgent) {
      state.detailAgent = savedAgent;
      state.detailScroll = 0;
      state.screen = "detail";
    }

    state.editDirty = false;
    state.editError = null;
    requestRender();
  } catch (err) {
    state.editError = err instanceof Error ? err.message : "Failed to save agent";
    requestRender();
  }
}

// ── Name Input screen ───────────────────────────────────────────────────────

function renderNameInput(state: ManagerState, width: number, theme: Theme): string[] {
  const lines: string[] = [];

  // Header
  const title = state.nameInputMode === "new" ? " New Agent " : " Clone Agent ";
  lines.push(renderHeader(title, width, theme));

  // Label
  lines.push(padEnd(theme.fg("accent", "Name:"), width));

  // Input box
  const boxWidth = Math.min(width - 2, 60);
  const boxInner = boxWidth - 2;
  const beforeCursor = state.nameInputBuffer.slice(0, state.nameInputCursor);
  const afterCursor = state.nameInputBuffer.slice(state.nameInputCursor);
  const inputContent = `${beforeCursor}${CURSOR_MARKER}${afterCursor}`;
  const paddedInput = padEnd(inputContent, boxInner);
  lines.push(padEnd(`│${paddedInput}│`, width));

  // Scope indicator
  const scopeText = `Scope: [${state.nameInputScope}]  [tab] toggle`;
  lines.push(padEnd(theme.fg("dim", scopeText), width));

  // Cross-scope collision warning
  const otherScope = state.nameInputScope === "user" ? "project" : "user";
  const otherScopeAgents = otherScope === "user" ? state.userAgents : state.projectAgents;
  const collisionAgent = otherScopeAgents.find((a) => a.name === state.nameInputBuffer.trim());
  if (collisionAgent) {
    lines.push(padEnd(theme.fg("warning", `Warning: a ${otherScope} agent "${collisionAgent.name}" exists and will take precedence`), width));
  } else if (state.nameInputError) {
    lines.push(padEnd(theme.fg("error", `  ${state.nameInputError}`), width));
  } else {
    lines.push(padEnd("", width));
  }

  // Footer
  lines.push(renderFooter(" [enter] continue  [esc] cancel ", width, theme));

  return lines;
}

function handleNameInput(
  state: ManagerState,
  data: string,
  requestRender: () => void,
): void {
  if (matchesKey(data, Key.tab)) {
    state.nameInputScope = state.nameInputScope === "user" ? "project" : "user";
    if (state.nameInputScope === "project" && !state.projectDir) {
      state.nameInputError = "No project agents directory found";
    } else {
      state.nameInputError = null;
    }
    requestRender();
  } else if (matchesKey(data, Key.backspace)) {
    if (state.nameInputCursor > 0) {
      state.nameInputBuffer =
        state.nameInputBuffer.slice(0, state.nameInputCursor - 1) +
        state.nameInputBuffer.slice(state.nameInputCursor);
      state.nameInputCursor--;
      state.nameInputError = null;
      requestRender();
    }
  } else if (matchesKey(data, Key.left)) {
    if (state.nameInputCursor > 0) {
      state.nameInputCursor--;
      requestRender();
    }
  } else if (matchesKey(data, Key.right)) {
    if (state.nameInputCursor < state.nameInputBuffer.length) {
      state.nameInputCursor++;
      requestRender();
    }
  } else if (matchesKey(data, Key.enter)) {
    const name = state.nameInputBuffer.trim();
    const nameError = validateAgentName(name);
    if (nameError) {
      state.nameInputError = nameError;
      requestRender();
      return;
    }
    if (state.nameInputScope === "project" && !state.projectDir) {
      state.nameInputError = "No project agents directory found";
      requestRender();
      return;
    }

    // Check for duplicate name
    const duplicate = state.agents.find(
      (a) => a.name === name && a.source === state.nameInputScope,
    );
    if (duplicate) {
      state.nameInputError = `Agent "${name}" already exists`;
      requestRender();
      return;
    }

    const dir = state.nameInputScope === "user" ? state.userDir : state.projectDir;
    if (!dir) {
      state.nameInputError = "Target directory not available";
      requestRender();
      return;
    }

    const filePath = path.join(dir, `${name}.md`);

    let newAgent: AgentConfig;
    if (state.nameInputMode === "clone" && state.nameInputSource) {
      const src = state.nameInputSource;
      newAgent = {
        ...src,
        name,
        source: state.nameInputScope,
        filePath,
      };
      if (src.tools) newAgent.tools = [...src.tools];
      if (src.extraFields) newAgent.extraFields = { ...src.extraFields };
    } else {
      newAgent = {
        name,
        description: "",
        systemPrompt: "",
        source: state.nameInputScope,
        filePath,
      };
    }

    // Switch to edit screen with new agent
    state.editAgent = newAgent;
    state.editFieldIndex = 0;
    state.editInField = false;
    state.editDirty = false;
    state.editFieldCursor = 0;
    state.editPromptMode = false;
    state.editPromptCursor = 0;
    state.editPromptScroll = 0;
    state.editDiscardPrompt = false;
    state.editError = null;
    state.isNew = true;
    state.screen = "edit";
    requestRender();
  } else if (matchesKey(data, Key.escape)) {
    state.screen = "list";
    requestRender();
  } else if (data.length === 1 && data >= " " && data <= "~") {
    state.nameInputBuffer =
      state.nameInputBuffer.slice(0, state.nameInputCursor) +
      data +
      state.nameInputBuffer.slice(state.nameInputCursor);
    state.nameInputCursor++;
    state.nameInputError = null;
    requestRender();
  }
}

// ── Confirm Delete screen ───────────────────────────────────────────────────

function renderConfirmDelete(state: ManagerState, width: number, theme: Theme): string[] {
  const lines: string[] = [];
  const target = state.deleteTarget;

  if (!target) {
    lines.push(renderHeader(" Delete? ", width, theme));
    lines.push(renderFooter(" [esc] cancel ", width, theme));
    return lines;
  }

  // Header
  lines.push(renderHeader(` Delete "${target.name}"? `, width, theme));

  // File path
  lines.push(padEnd(theme.fg("dim", `File: ${target.filePath}`), width));

  // Warning
  lines.push(padEnd(theme.fg("error", "This cannot be undone."), width));

  // Spacer
  lines.push(padEnd("", width));

  // Footer
  lines.push(renderFooter(" [y] confirm  [n / esc] cancel ", width, theme));

  return lines;
}

function handleConfirmDelete(
  state: ManagerState,
  data: string,
  requestRender: () => void,
): void {
  if (matchesKey(data, "y") || data === "Y") {
    if (state.deleteTarget) {
      try {
        fs.unlinkSync(state.deleteTarget.filePath);
      } catch {
        // File may not exist
      }

      // Refresh agents list
      const cwd = process.cwd();
      const discovery = discoverAgentsAll(cwd);
      state.userAgents = discovery.user;
      state.projectAgents = discovery.project;
      state.agents = [...discovery.user, ...discovery.project];

      state.listCursor = 0;
      state.listScroll = 0;
      state.filterQuery = "";
      state.filterMode = false;
    }
    state.screen = "list";
    requestRender();
  } else if (matchesKey(data, "n") || data === "N" || matchesKey(data, Key.escape)) {
    state.screen = state.deleteFromScreen;
    requestRender();
  }
}

// ── Main factory ────────────────────────────────────────────────────────────

export function createAgentManager(
  userAgents: AgentConfig[],
  projectAgents: AgentConfig[],
  userDir: string,
  projectDir: string | null,
  tui: TUIContext,
  theme: Theme,
  done: () => void,
): Component {
  const state: ManagerState = {
    screen: "list",
    agents: [...userAgents, ...projectAgents],
    userAgents,
    projectAgents,
    userDir,
    projectDir,

    listCursor: 0,
    listScroll: 0,
    filterQuery: "",
    filterMode: false,

    detailAgent: null,
    detailScroll: 0,

    editAgent: null,
    editFieldIndex: 0,
    editInField: false,
    editDirty: false,
    editFieldCursor: 0,
    editPromptMode: false,
    editPromptCursor: 0,
    editPromptScroll: 0,
    editDiscardPrompt: false,
    editError: null,

    nameInputBuffer: "",
    nameInputCursor: 0,
    nameInputScope: "user",
    nameInputMode: "new",
    nameInputSource: null,
    nameInputError: null,

    deleteTarget: null,
    deleteFromScreen: "list",

    isNew: false,

    lastWidth: 84,
  };

  let cachedWidth: number | undefined;
  let cachedLines: string[] | undefined;

  function requestRender(): void {
    cachedWidth = undefined;
    cachedLines = undefined;
    tui.requestRender();
  }

  function handleInput(data: string): void {
    const result: "close" | void = (() => {
      switch (state.screen) {
        case "list":
          return handleListInput(state, data, done, requestRender);
        case "detail":
          return handleDetailInput(state, data, requestRender);
        case "edit":
          return handleEditInput(state, data, requestRender);
        case "name-input":
          return handleNameInput(state, data, requestRender);
        case "confirm-delete":
          return handleConfirmDelete(state, data, requestRender);
      }
    })();

    if (result === "close") {
      done();
    }
  }

  return {
    render(width: number): string[] {
      state.lastWidth = width;
      if (cachedLines && cachedWidth === width) {
        return cachedLines;
      }

      let lines: string[];
      switch (state.screen) {
        case "list":
          lines = renderList(state, width, theme);
          break;
        case "detail":
          lines = renderDetail(state, width, theme);
          break;
        case "edit":
          lines = renderEdit(state, width, theme);
          break;
        case "name-input":
          lines = renderNameInput(state, width, theme);
          break;
        case "confirm-delete":
          lines = renderConfirmDelete(state, width, theme);
          break;
      }

      cachedWidth = width;
      cachedLines = lines;
      return lines;
    },

    handleInput,

    invalidate(): void {
      cachedWidth = undefined;
      cachedLines = undefined;
    },

    dispose(): void {
      // No resources to clean up
    },
  };
}
