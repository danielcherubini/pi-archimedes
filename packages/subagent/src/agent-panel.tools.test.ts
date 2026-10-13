/**
 * The `/agents` panel's tools edit gate.
 *
 * The panel edits tools through the multi-select picker (`[t]`), whose list is
 * `pi.getAllTools()`. Its commit is the only place a tools list is written from
 * the panel, so that is where the **lexical** rules are enforced: an entry pi
 * cannot read as a name is refused with the entry named, and the value the agent
 * had before the picker opened stays exactly as it was.
 *
 * Membership (is this a tool right now?) is deliberately NOT checked here — see
 * `tool-validation.ts` for why that belongs at dispatch.
 */

import { describe, it, expect } from "vitest";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { createAgentPanel } from "./agent-panel.js";
import type { AgentConfig } from "./agents.js";

const theme = { fg: (_token: string, text: string) => text, bold: (text: string) => text };

const ENTER = "\r";
const DOWN = "\x1b[B";
const ESCAPE = "\x1b";
const SPACE = " ";

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: "reviewer",
    description: "reviews things",
    systemPrompt: "be terse",
    source: "user",
    filePath: "/tmp/agents/reviewer.md",
    tools: ["read"],
    ...overrides,
  };
}

function makePanel(agents: AgentConfig[], tools: Array<{ name: string; description: string }>) {
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
    tools,
  );
}

/** list → detail → edit → cursor on the tools row → picker open. */
function openToolPicker(panel: ReturnType<typeof makePanel>): void {
  panel.handleInput(ENTER); // detail
  panel.handleInput("e"); // edit (mutable copy)
  panel.handleInput(DOWN); // name → description
  panel.handleInput(DOWN); // description → tools
  panel.handleInput("t"); // open the tool picker
}

function drawn(panel: ReturnType<typeof makePanel>): string[] {
  return panel.render(90).map((l) => stripTerminalSequences(l));
}

function rowContaining(lines: string[], needle: string): string | undefined {
  return lines.find((l) => l.includes(needle));
}

describe("/agents tool picker: lexical entries are refused at commit", () => {
  it("a selected entry that is not a legal name is refused, naming the entry", () => {
    const panel = makePanel([makeAgent()], [
      { name: "+danger", description: "an extension tool whose name reads as a modifier" },
      { name: "read", description: "read" },
    ]);
    openToolPicker(panel);
    panel.handleInput(SPACE); // select "+danger" (first row)
    panel.handleInput(ENTER); // commit
    const lines = drawn(panel);
    expect(rowContaining(lines, "Error:")).toBeTruthy();
    // The entry has to be legible, not clipped off the end of one row.
    expect(lines.some((l) => l.includes('+danger"'))).toBe(true);
  });

  it("a refused commit leaves the previously selected tools exactly as they were", () => {
    const panel = makePanel([makeAgent({ tools: ["read", "bash"] })], [
      { name: "-minus", description: "reads as a removal" },
      { name: "read", description: "read" },
    ]);
    openToolPicker(panel);
    panel.handleInput(SPACE); // select "-minus" on top of the pre-selected pair
    panel.handleInput(ENTER);
    const lines = drawn(panel);
    expect(rowContaining(lines, "tools: read, bash")).toBeTruthy();
    expect(rowContaining(lines, "tools: read, bash, -minus")).toBeUndefined();
  });

  it("a legal selection still commits (the gate does not eat valid input)", () => {
    const panel = makePanel([makeAgent({ tools: ["read"] })], [
      { name: "read", description: "read" },
      { name: "bash", description: "bash" },
    ]);
    openToolPicker(panel);
    panel.handleInput(DOWN); // to bash
    panel.handleInput(SPACE);
    panel.handleInput(ENTER);
    const lines = drawn(panel);
    expect(rowContaining(lines, "Error:")).toBeUndefined();
    expect(rowContaining(lines, "tools: read, bash")).toBeTruthy();
  });

  it("clearing every tool commits an empty allowlist, which is not a lexical error", () => {
    const panel = makePanel([makeAgent({ tools: ["read"] })], [
      { name: "read", description: "read" },
    ]);
    openToolPicker(panel);
    panel.handleInput(SPACE); // deselect the only entry
    panel.handleInput(ENTER);
    const lines = drawn(panel);
    expect(rowContaining(lines, "Error:")).toBeUndefined();
    expect(rowContaining(lines, "tools: (not set)")).toBeTruthy();
  });

  it("discarding after a commit leaves the original agent's preserved line intact", () => {
    // The edit copy is `{ ...agent }`, so `extraFields` is shared with the
    // original until something copies it. A commit that deleted the preserved
    // raw `tools` value in place therefore deleted it from the ORIGINAL agent as
    // well: commit, then discard, and the agent's own record no longer carried
    // the line the config read promised to keep — so the next save wrote no
    // `tools:` key and the allowlist vanished from the file.
    const broken = makeAgent({
      extraFields: { tools: "read, +web_search" },
    });
    delete broken.tools; // the read path leaves no allowlist in force
    broken.toolsError = 'Agent "reviewer" has a tools entry starting with "+": "+web_search".';
    const panel = makePanel([broken], [{ name: "read", description: "read" }]);
    openToolPicker(panel);
    panel.handleInput(SPACE); // select read on top of the rejected config's empty set
    panel.handleInput(ENTER); // commit (marks the edit dirty)
    panel.handleInput(ESCAPE); // escape a dirty edit → discard prompt
    panel.handleInput("y"); // discard
    panel.handleInput(ESCAPE); // back to the detail screen
    const lines = drawn(panel);
    expect(rowContaining(lines, "tools: read, +web_search")).toBeTruthy();
    // And the rejection it belongs to, since this agent is unchanged on disk.
    expect(lines.some((l) => l.includes('"+web_search"'))).toBe(true);
  });
});

describe("/agents detail screen: a rejected tools list says so", () => {
  it("shows the config-read rejection on the agent that carries it", () => {
    const broken = makeAgent();
    delete broken.tools; // the read path leaves no allowlist in force
    broken.toolsError = 'Agent "reviewer" lists the tool "read" twice (in /tmp/agents/reviewer.md).';
    const panel = makePanel([broken], []);
    panel.handleInput(ENTER); // detail
    const lines = drawn(panel);
    expect(rowContaining(lines, '"read" twice')).toBeTruthy();
    expect(rowContaining(lines, "/tmp/agents/reviewer.md")).toBeTruthy();
  });
});
