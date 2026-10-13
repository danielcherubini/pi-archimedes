import { describe, it, expect } from "vitest";
import {
  splitToolEntries,
  readToolEntries,
  validateToolEntries,
  applyToolEntries,
  unknownToolEntries,
  formatUnknownToolsWarning,
} from "./tool-validation.js";
import type { AgentConfig } from "./agents.js";

// ── The split this module encodes ───────────────────────────────────────────
//
// Two questions, asked at two different moments:
//
//   * Can this string be a tool name at all? — **lexical**. Answerable anywhere,
//     including at config read, where there is no tool registry: `discoverAgents()`
//     is pure filesystem. Rejects here.
//   * Does pi have this tool right now? — **membership**. Needs the ExtensionAPI
//     handle (`pi.getAllTools()`), so it can only be asked at dispatch, and the
//     answer is a warning, never a refusal: a legitimate name is absent whenever
//     its plugin is toggled off or its MCP server is disconnected.
//
// Nothing in this file asserts that a name is or is not a known tool except in
// the `unknownToolEntries` block, which is the membership half.

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: "reviewer",
    description: "d",
    systemPrompt: "p",
    source: "user",
    filePath: "/tmp/agents/reviewer.md",
    ...overrides,
  };
}

const CTX = { agentName: "reviewer", agentFilePath: "/tmp/agents/reviewer.md" };

describe("splitToolEntries", () => {
  it("keeps empty entries so they can be reported instead of filtered away", () => {
    expect(splitToolEntries("read,,bash")).toEqual(["read", "", "bash"]);
    expect(splitToolEntries("read, bash ")).toEqual(["read", "bash"]);
    expect(splitToolEntries(" ")).toEqual([""]);
    expect(splitToolEntries("")).toEqual([]);
  });
});

describe("validateToolEntries (lexical only)", () => {
  it("accepts a plain list of names", () => {
    expect(validateToolEntries(["read", "bash", "mcp__radius__query"], CTX)).toEqual({ ok: true });
    expect(validateToolEntries([], CTX)).toEqual({ ok: true });
  });

  it("rejects an empty entry and names it", () => {
    const result = validateToolEntries(["read", "", "bash"], CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('""');
      expect(result.error).toContain("reviewer");
      expect(result.error).toContain("/tmp/agents/reviewer.md");
    }
  });

  it("rejects a whitespace-only entry as the empty entry it parses to", () => {
    const result = validateToolEntries(splitToolEntries("read,   , bash"), CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('""');
      expect(result.error).toMatch(/empty/i);
    }
  });

  it("rejects a leading-+ entry as a modifier and names it", () => {
    const result = validateToolEntries(["read", "+web_search"], CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("+web_search");
      // The reason matters: pi reads it as a modifier, not a name.
      expect(result.error).toMatch(/modifier/i);
    }
  });

  it("rejects a leading-- entry as a modifier and names it", () => {
    const result = validateToolEntries(["-bash"], CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("-bash");
  });

  it("rejects a duplicated entry and names it", () => {
    const result = validateToolEntries(["read", "bash", "read"], CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("read");
      expect(result.error).toMatch(/twice|more than once/i);
    }
  });

  it("reports the first problem it finds, in list order", () => {
    const result = validateToolEntries(["read", "read", "+bash"], CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toContain("+bash");
  });

  it("says the field and file when both are known, and degrades to a generic message when not", () => {
    const named = validateToolEntries(["read", "read"], { agentName: "explore" });
    expect(!named.ok && named.error).toContain("explore");
    const bare = validateToolEntries(["read", "read"]);
    expect(bare.ok).toBe(false);
    if (!bare.ok) expect(bare.error).toContain("read");
  });
});

describe("applyToolEntries (the edit-site half: reject leaves the previous value alone)", () => {
  it("applies a valid list", () => {
    const agent = makeAgent({ tools: ["bash"] });
    const error = applyToolEntries(agent, ["read", "bash"], CTX);
    expect(error).toBeNull();
    expect(agent.tools).toEqual(["read", "bash"]);
  });

  it("an empty list means no allowlist, and clears the field", () => {
    const agent = makeAgent({ tools: ["bash"] });
    expect(applyToolEntries(agent, [], CTX)).toBeNull();
    expect(agent.tools).toBeUndefined();
  });

  it("a rejected entry leaves the previous list intact", () => {
    const agent = makeAgent({ tools: ["read", "bash"] });
    const error = applyToolEntries(agent, ["read", "+bash"], CTX);
    expect(error).toBeTruthy();
    expect(agent.tools).toEqual(["read", "bash"]);
  });

  it("a rejected empty entry leaves the previous list intact", () => {
    const agent = makeAgent({ tools: ["read"] });
    expect(applyToolEntries(agent, ["read", "  "], CTX)).toBeTruthy();
    expect(agent.tools).toEqual(["read"]);
  });

  it("a rejected duplicate leaves the previous list intact", () => {
    const agent = makeAgent();
    expect(applyToolEntries(agent, ["read", "read"], CTX)).toBeTruthy();
    expect(agent.tools).toBeUndefined();
  });
});

describe("applyToolEntries: a commit replaces the rejected value it is superseding", () => {
  // The config read keeps an unreadable `tools:` in `extraFields` so that saving
  // an agent cannot silently delete the line the user typed (`agents.ts`). That
  // promise is to the *rejected* value. Once the panel commits a list, the old
  // raw value has to go with the rejection: `serializeAgent` writes `tools` and
  // then every extra field, so a surviving `extraFields.tools` puts a SECOND
  // `tools:` key in the file (or the only one, when the list was cleared) and the
  // agent comes back broken after a reload.
  const rejected = () =>
    makeAgent({
      toolsError:
        'Agent "reviewer" has a tools entry starting with "+" (in /tmp/agents/reviewer.md): "+web_search".',
      extraFields: { tools: "read, +web_search", owner: "someone" },
    });

  it("drops the preserved raw value when a valid list is committed", () => {
    const agent = rejected();
    expect(applyToolEntries(agent, ["read"], CTX)).toBeNull();
    expect(agent.tools).toEqual(["read"]);
    expect(agent.extraFields ?? {}).not.toHaveProperty("tools");
    // Only the superseded value goes; unrelated extras stay.
    expect(agent.extraFields?.owner).toBe("someone");
  });

  it("drops the preserved raw value when the allowlist is cleared", () => {
    // Clearing is the case that used to look like success and change nothing:
    // `tools` was deleted, the raw value stayed, and the writer put the broken
    // line straight back.
    const agent = rejected();
    expect(applyToolEntries(agent, [], CTX)).toBeNull();
    expect(agent.tools).toBeUndefined();
    expect(agent.extraFields ?? {}).not.toHaveProperty("tools");
  });

  it("clears the stale rejection so the agent dispatches again in this session", () => {
    const agent = rejected();
    expect(applyToolEntries(agent, ["read"], CTX)).toBeNull();
    expect(agent.toolsError).toBeUndefined();
  });

  it("a REFUSED commit destroys neither the list, the raw value, nor the rejection", () => {
    const agent = rejected();
    expect(applyToolEntries(agent, ["read", "+x"], CTX)).toBeTruthy();
    expect(agent.tools).toBeUndefined();
    expect(agent.extraFields?.tools).toBe("read, +web_search");
    expect(agent.toolsError).toBeTruthy();
  });

  it("never mutates the extraFields object it was handed", () => {
    // `/agents` builds its edit copy with `{ ...agent }` (`agent-panel.ts`), so
    // `extraFields` is ONE object shared with `state.editOriginal` and with the
    // discovered agent. Deleting a key in place therefore discards the preserved
    // raw value from the *original* too: commit, then discard the edit, and the
    // next save writes no `tools:` line at all — the allowlist disappears from
    // the file without the user asking. Copy instead.
    const shared = { tools: "read, +web_search", owner: "someone" };
    const agent = makeAgent({ extraFields: shared });
    expect(applyToolEntries(agent, ["read"], CTX)).toBeNull();
    expect(shared.tools).toBe("read, +web_search");
    expect(agent.extraFields).not.toBe(shared);
    expect(agent.extraFields?.owner).toBe("someone");
  });

  it("drops the whole extraFields object when tools was the only field", () => {
    // An empty record would otherwise render as an empty "extra fields" section
    // and be re-written as nothing at all.
    const agent = makeAgent({ extraFields: { tools: "read, +x" } });
    expect(applyToolEntries(agent, ["read"], CTX)).toBeNull();
    expect(agent.extraFields).toBeUndefined();
  });
});

describe("unknownToolEntries (membership, asked at dispatch)", () => {
  const KNOWN = ["read", "bash", "mcp__radius__query"];

  it("reports entries pi does not currently have", () => {
    expect(unknownToolEntries(["read", "web_search"], KNOWN)).toEqual(["web_search"]);
  });

  it("reports nothing when every entry is available", () => {
    expect(unknownToolEntries(["read", "bash"], KNOWN)).toEqual([]);
  });

  it("treats a * entry as a pattern over the tools pi actually has", () => {
    expect(unknownToolEntries(["mcp__radius__*"], KNOWN)).toEqual([]);
    expect(unknownToolEntries(["mcp__nope__*"], KNOWN)).toEqual(["mcp__nope__*"]);
  });

  it("names every offending entry in the warning", () => {
    const warning = formatUnknownToolsWarning("reviewer", ["web_search", "sudo_exec"]);
    expect(warning).toContain("web_search");
    expect(warning).toContain("sudo_exec");
    // The whole point of warn-not-fail: the run still happens.
    expect(warning).toMatch(/proceed|continues/i);
  });
});

describe("readToolEntries: every YAML spelling of a tools value", () => {
  // pi's frontmatter parser hands the config read whatever YAML said, so the
  // comma string this suite writes is only one of three shapes that mean
  // "allowlist". Reading only that one silently dropped list-shaped configs —
  // no allowlist at all, which is the unrestricted child ADR 0028 forbids.
  const ok = (r: ReturnType<typeof readToolEntries>) => ("entries" in r ? r.entries : undefined);

  it("reads the comma-separated form the suite's writer emits", () => {
    expect(ok(readToolEntries("read, bash"))).toEqual(["read", "bash"]);
  });

  it("reads a block list, trimming each entry", () => {
    expect(ok(readToolEntries(["read", " bash "]))).toEqual(["read", "bash"]);
  });

  it("reads an inline list, and keeps an empty entry visible for the name rules to reject", () => {
    expect(ok(readToolEntries(["read", ""]))).toEqual(["read", ""]);
  });

  it("reports an entry that is not a string, naming it", () => {
    const r = readToolEntries(["read", { count: 2 }], { agentName: "probe" });
    expect("error" in r ? r.error : undefined).toMatch(/not a tool name/);
    expect("error" in r ? r.error : "").toContain('{"count":2}');
    expect("error" in r ? r.error : "").toContain('Agent "probe"');
  });

  it("reports a value that is not a list at all, and says what to write instead", () => {
    const r = readToolEntries(42, { agentFilePath: "/x/probe.md" });
    expect("error" in r ? r.error : undefined).toMatch(/not a list of tool names/);
    expect("error" in r ? r.error : "").toContain("/x/probe.md");
    expect("error" in r ? r.error : "").toContain("read, bash");
  });

  it("an absent key is the caller's business, not an error here (it never reaches this gate)", () => {
    expect(ok(readToolEntries(""))).toEqual([]);
  });

  it("splits a list entry that carries a comma, because the child splits it too", () => {
    // `--tools` is ONE argv string the host re-splits on commas
    // (`pi/dist/cli/args.js`: `args[++i].split(",")`), so an entry written
    // `"read,+bash"` in a YAML list reaches the child as two entries — the
    // validator has to look at the same list the child will run with, or it
    // certifies a shape it never sees.
    expect(ok(readToolEntries(["read,+bash"]))).toEqual(["read", "+bash"]);
    expect(ok(readToolEntries([" read , bash "]))).toEqual(["read", "bash"]);
  });

  it("keeps a hidden modifier visible for the name rules, so the read rejects it", () => {
    const entries = readToolEntries(["read,+bash"]);
    if (!("entries" in entries)) throw new Error("expected entries");
    const check = validateToolEntries(entries.entries, CTX);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.error).toContain("+bash");
  });
});

describe("validateToolEntries: a comma inside one entry", () => {
  it("is refused rather than certified, because the child would split it", () => {
    // The read path splits, so this rule guards every *other* caller —
    // `applyToolEntries` and anything that builds an AgentConfig directly. A
    // list we validated must be the list the child runs with: pi would turn
    // `["read,+bash"]` into `--tools read,+bash`, reject the whole flag as
    // mixed names-and-modifiers, and run the child with NO allowlist at all
    // (verified against a live 1.2.0 child: exit 1, `Error: --tools: tool
    // names cannot be mixed with +name or -name entries`).
    const result = validateToolEntries(["read", "read,+bash"], CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("read,+bash");
      expect(result.error).toContain("reviewer");
    }
  });

  it("is refused even when it is the only entry", () => {
    expect(validateToolEntries(["a,b"], CTX).ok).toBe(false);
  });
});
