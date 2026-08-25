/**
 * Agent store — file I/O for the Agent Manager.
 * Handles save logic: .md serialization, agents.local.json update, and rollback.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentConfig } from "./agents.js";
import { discoverAgentsAll } from "./agents.js";
import { serializeAgent, validateAgentName } from "./frontmatter-io.js";
import {
  writeLocalModel,
  deleteLocalModel,
  writeLocalThinking,
  deleteLocalThinking,
  deleteLocalAgent,
  readLocalConfig,
  setLocalConfig,
  type LocalConfig,
} from "./local-config.js";

// ── Types shared between store and panel ───────────────────────────────────

interface ModelInfo {
  id: string;
  provider: string;
  fullId: string;
}

interface ToolInfo {
  name: string;
  description: string;
}

export interface ManagerState {
  screen: "list" | "detail" | "edit" | "name-input" | "confirm-delete";
  agents: AgentConfig[];
  globalAgents: AgentConfig[];
  userAgents: AgentConfig[];
  projectAgents: AgentConfig[];
  globalDir: string | null;
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
  editPromptMode: boolean;
  editPromptCursor: number;
  editPromptScroll: number;
  editDiscardPrompt: boolean;
  editError: string | null;
  editOriginal: AgentConfig | null;
  editReturnScreen: "list" | "detail" | "name-input";

  // Name input state
  nameInputBuffer: string;
  nameInputCursor: number;
  nameInputScope: "global" | "user" | "project";
  nameInputMode: "new" | "clone";
  nameInputSource: AgentConfig | null;
  nameInputError: string | null;

  // Model picker state
  models: ModelInfo[];
  modelPickerOpen: boolean;
  modelSearchQuery: string;
  modelCursor: number;
  filteredModels: ModelInfo[];

  // Tool picker state
  tools: ToolInfo[];
  toolPickerOpen: boolean;
  toolCursor: number;
  toolSelected: Set<string>;
  toolSearch: string;
  filteredTools: ToolInfo[];

  // Confirm delete state
  deleteTarget: AgentConfig | null;
  deleteFromScreen: "list" | "detail";

  // New agent tracking
  isNew: boolean;

  // Render width (stored so input handlers can compute correct scroll bounds)
  lastWidth: number;
  lastContentWidth: number;
}

// ── Save logic ──────────────────────────────────────────────────────────────

export function saveAgent(state: ManagerState, requestRender: () => void): void {
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
  const dir = agent.source === "global" ? state.globalDir
    : agent.source === "user" ? state.userDir
    : state.projectDir;
  if (!dir) {
    state.editError = "Target directory not available";
    requestRender();
    return;
  }

  const oldPath = agent.filePath;
  const newName = agent.name.endsWith(".md") ? agent.name : `${agent.name}.md`;
  const newPath = path.join(dir, newName);

  // Capture model and thinking before entering the try block so they are
  // available in the catch block for .md rollback if a later step
  // (JSON write, etc.) fails.
  const model = agent.model;
  const thinking = agent.thinking;

  // Track whether the .md write succeeded so the catch block knows whether
  // to restore or clean up the on-disk file.
  const isRename = oldPath && oldPath !== newPath;
  let originalContent: string | undefined;
  if (!isRename && fs.existsSync(newPath)) {
    // Read existing .md content so we can restore it verbatim if a later
    // step (JSON write, re-discovery, etc.) fails.
    originalContent = fs.readFileSync(newPath, "utf-8");
  }
  let mdWritten = false;
  // Track whether the old .md file was already removed during a rename so
  // the catch block knows whether newPath is the sole surviving copy.
  let oldPathDeleted = false;
  // Track whether the JSON config write succeeded so the catch block can
  // roll it back if a later step (re-discovery, etc.) fails.
  let jsonWritten = false;
  // Snapshot of the JSON config captured before the write so the catch
  // block can restore it. Declared here (not inside try) so it is
  // accessible in the catch block.
  let jsonConfigBefore: LocalConfig = {};

  try {
    // Ensure directory exists
    fs.mkdirSync(dir, { recursive: true });

    // Build a shallow copy without the model/thinking for .md serialization
    // (both fields are stored in agents.local.json) so the live edit object
    // is NOT mutated during serialization. If the .md write fails below, the
    // live object stays intact for a retry.
    const mdAgent = { ...agent };
    delete mdAgent.model;
    delete mdAgent.thinking;

    // Serialize and write the .md file FIRST. If this fails, no JSON state
    // is persisted and the live edit object is untouched.
    const content = serializeAgent(mdAgent);
    fs.writeFileSync(newPath, content, "utf-8");
    mdWritten = true;

    // Only after the .md write succeeds, perform JSON store mutations.
    // Capture a backup of the current JSON config so we can roll it back
    // if a later step (re-discovery, etc.) fails after this write succeeds.
    jsonConfigBefore = readLocalConfig();
    // Write/remove the NEW name entries first, then clean up the OLD name.
    if (model !== undefined) {
      writeLocalModel(agent.name, model);
    } else {
      deleteLocalModel(agent.name);
    }
    if (thinking !== undefined) {
      writeLocalThinking(agent.name, thinking);
    } else {
      deleteLocalThinking(agent.name);
    }
    jsonWritten = true;

    // Handle rename: delete old JSON entry keyed by original name (after
    // the new entries are safely written) — deleteLocalAgent covers all
    // fields (model and thinking). Wrapped in try-catch so a failure here
    // does not leave the .md written but the live object un-stripped.
    const originalName = state.editOriginal?.name;
    if (originalName && originalName !== agent.name) {
      try {
        deleteLocalAgent(originalName);
      } catch {
        // Best-effort: stale entry is harmless and will be cleaned up on
        // a subsequent save/rename
      }
    }

    // Handle rename: delete old .md file if name changed
    if (oldPath && oldPath !== newPath) {
      try {
        fs.unlinkSync(oldPath);
        oldPathDeleted = true;
      } catch {
        // Old file may not exist (e.g., new agent)
      }
    }

    // Update filePath
    agent.filePath = newPath;

    // Refresh agents list
    const cwd = process.cwd();
    const discovery = discoverAgentsAll(cwd);
    state.globalAgents = discovery.global;
    state.userAgents = discovery.user;
    state.projectAgents = discovery.project;
    state.globalDir = discovery.globalDir;
    state.agents = [...discovery.global, ...discovery.user, ...discovery.project];

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

    // Only strip model/thinking from the live edit object AFTER all
    // operations (including re-discovery) have succeeded. This ensures
    // that if any step fails, the catch block can restore them to .md
    // and the live object retains them for a safe retry.
    delete agent.model;
    delete agent.thinking;
  } catch (err) {
    // Restore prior .md state if the write succeeded but a later step
    // (JSON write, re-discovery, etc.) failed:
    //   - rename (old file not yet unlinked): check whether the old file
    //     still exists. If so, delete newPath so only the original remains.
    //     If the old file is gone (deleted externally or by a prior attempt),
    //     newPath may be the sole copy — keep it with a model/thinking
    //     fallback, or delete it when there is no model/thinking to fall
    //     back on.
    //   - existing file: write the original content back verbatim.
    //   - new file with model/thinking: keep a frontmatter fallback so the
    //     overrides survive for the next retry.
    // If the old .md was already unlinked during rename (oldPathDeleted),
    // newPath is the sole surviving copy — leave it in place.
    // If the .md write itself failed (mdWritten is false) there is nothing
    // to restore on disk.
    if (mdWritten) {
      if (isRename && !oldPathDeleted) {
        if (oldPath && fs.existsSync(oldPath)) {
          // Old file still exists — safe to delete newPath and restore prior state
          try { fs.unlinkSync(newPath); } catch { /* best-effort */ }
        } else if (model !== undefined || thinking !== undefined) {
          // Old file is gone — keep newPath with model/thinking as fallback
          const fallback: AgentConfig = { ...agent };
          if (model !== undefined) fallback.model = model;
          if (thinking !== undefined) fallback.thinking = thinking;
          try { fs.writeFileSync(newPath, serializeAgent(fallback), "utf-8"); } catch { /* best-effort */ }
        } else {
          // Old file is gone and no model/thinking — delete newPath (no prior state to restore)
          try { fs.unlinkSync(newPath); } catch { /* best-effort */ }
        }
      } else if (originalContent !== undefined) {
        try { fs.writeFileSync(newPath, originalContent, "utf-8"); } catch { /* best-effort */ }
      } else if (model !== undefined || thinking !== undefined) {
        const fallback: AgentConfig = { ...agent };
        if (model !== undefined) fallback.model = model;
        if (thinking !== undefined) fallback.thinking = thinking;
        try { fs.writeFileSync(newPath, serializeAgent(fallback), "utf-8"); } catch { /* best-effort */ }
      } else {
        // New file without model/thinking — delete it (no prior state to restore)
        try { fs.unlinkSync(newPath); } catch { /* best-effort */ }
      }
    }
    // Roll back JSON if it was written but a later step failed
    if (jsonWritten) {
      try { setLocalConfig(jsonConfigBefore); } catch { /* best-effort */ }
    }
    state.editError = err instanceof Error ? err.message : "Failed to save agent";
    requestRender();
  }
}
