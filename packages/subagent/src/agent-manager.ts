/**
 * Agent Manager — thin orchestrator.
 * Wires agent-panel (TUI) and agent-store (file I/O) together.
 *
 * Both `createAgentManager` and `saveAgent` are re-exported here so that
 * existing callers (including the lazy import in index.ts) continue to resolve.
 */

import type { AgentConfig } from "./agents.js";
import { createAgentPanel } from "./agent-panel.js";
export { saveAgent } from "./agent-store.js";

interface Theme {
  fg(token: string, text: string): string;
  bold(text: string): string;
}

interface TUIContext {
  requestRender(): void;
}

interface ModelInfo {
  id: string;
  provider: string;
  fullId: string;
}

interface ToolInfo {
  name: string;
  description: string;
}

interface Component {
  render(width: number): string[];
  handleInput(data: string): void;
  invalidate(): void;
  dispose(): void;
}

export function createAgentManager(
  globalAgents: AgentConfig[],
  userAgents: AgentConfig[],
  projectAgents: AgentConfig[],
  globalDir: string | null,
  userDir: string,
  projectDir: string | null,
  tui: TUIContext,
  theme: Theme,
  done: () => void,
  models: ModelInfo[],
  tools: ToolInfo[],
): Component {
  return createAgentPanel(
    globalAgents,
    userAgents,
    projectAgents,
    globalDir,
    userDir,
    projectDir,
    tui,
    theme,
    done,
    models,
    tools,
  );
}
