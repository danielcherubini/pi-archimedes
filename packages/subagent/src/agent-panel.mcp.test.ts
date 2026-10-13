/**
 * The `/agents` panel's half of the tool-allowlist contract: the detail screen
 * has to say whether an agent's child runs with MCP tools, and the tools field
 * has to refuse entries the `pi` CLI cannot take as a name.
 *
 * The panel is driven through its own `handleInput` so the assertions run on the
 * frames a user would actually see (same approach as the width audit).
 */

import { describe, it, expect } from "vitest";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { createAgentPanel } from "./agent-panel.js";
import type { AgentConfig } from "./agents.js";

const theme = { fg: (_token: string, text: string) => text, bold: (text: string) => text };

const ENTER = "\r";

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: "reviewer",
    description: "reviews things",
    systemPrompt: "be terse",
    source: "user",
    filePath: "/tmp/agents/reviewer.md",
    tools: ["read", "bash"],
    ...overrides,
  };
}

function makePanel(agents: AgentConfig[]) {
  return createAgentPanel(
    agents,
    [],
    [],
    null,
    "/tmp/agents",
    null,
    { requestRender: () => {} },
    theme,
    () => {},
    [],
    [
      { name: "read", description: "read a file" },
      { name: "bash", description: "run a command" },
    ],
  );
}

/** The frame as drawn text (ANSI stripped), one entry per row. */
function drawn(panel: ReturnType<typeof makePanel>): string[] {
  return panel.render(84).map((l) => stripTerminalSequences(l));
}

function rowContaining(lines: string[], needle: string): string | undefined {
  return lines.find((l) => l.includes(needle));
}

describe("/agents detail screen: the mcp opt-in is visible", () => {
  it("shows mcp: true for an agent that opted in", () => {
    const panel = makePanel([makeAgent({ mcp: true })]);
    panel.handleInput(ENTER);
    const lines = drawn(panel);
    expect(rowContaining(lines, "Agent:")).toBeTruthy();
    expect(rowContaining(lines, "mcp: true")).toBeTruthy();
  });

  it("shows the closed default for an agent with no mcp key", () => {
    const panel = makePanel([makeAgent()]);
    panel.handleInput(ENTER);
    const lines = drawn(panel);
    const row = rowContaining(lines, "mcp:");
    expect(row).toBeTruthy();
    expect(row).not.toContain("true");
  });
});
