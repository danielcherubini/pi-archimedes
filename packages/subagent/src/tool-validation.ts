import type { AgentConfig } from "./agents.js";

// ── Tool-name validation, split by what each site is allowed to know ────────
//
// Two questions look similar and are not:
//
//   **Lexical** — can this string be a tool *name* at all? Empty/whitespace
//   entries, duplicates, entries containing a comma (the child re-splits the one
//   argv string on commas, so a comma means two entries by then), and entries
//   starting with `+` or `-` cannot. pi 1.1.0
//   made `+name`/`-name` **modifiers** on the default tool set, and its own CLI
//   parser rejects a `--tools` list that mixes them with plain names outright —
//   the flag is dropped with `Error: --tools: tool names cannot be mixed with
//   +name or -name entries` and exit code 1, so such a list does not merely
//   misbehave, it takes the whole allowlist (and the run) down with it. Nothing
//   else about the entry matters here, and that is what lets the config read
//   (`agents.ts`) and the `/agents` panel reject malformed input: neither site has
//   a tool registry — `discoverAgents()` is pure filesystem and
//   `pi.getAllTools()` needs the `ExtensionAPI` handle.
//
//   **Membership** — does pi have this tool *right now*? Needs the handle, so it
//   is asked at dispatch, and the answer is a warning naming the entry, never a
//   refusal: a legitimate name is absent whenever the plugin that provides it is
//   toggled off or the MCP server behind it is disconnected. Failing there would
//   make `tools: web_search` unusable for anyone who disabled `web`.
//
// Shape and wording follow the model pre-validation precedent (ADR 0008,
// `model-validation.ts`): a pure gate returning `{ ok }`, a message that names
// the offending value and the file it came from, and says what to do instead.

export interface ValidateToolsContext {
  /** Agent name the entry belongs to (used to address the message). */
  agentName?: string | undefined;
  /** File path of the agent config whose `tools:` field is being validated. */
  agentFilePath?: string | undefined;
}

export type ValidateToolsResult = { ok: true } | { ok: false; error: string };

function address(context: ValidateToolsContext): { subject: string; where: string } {
  return {
    subject: context.agentName ? `Agent "${context.agentName}"` : "This agent config",
    where: context.agentFilePath ? ` (in ${context.agentFilePath})` : "",
  };
}

/**
 * Split a `tools:` value into entries.
 *
 * Empty entries are **kept** — filtering them here is what made a malformed list
 * look legitimate. Entries are trimmed, because that is what the child receives.
 */
export function splitToolEntries(raw: string): string[] {
  if (raw.length === 0) return [];
  return raw.split(",").map((entry) => entry.trim());
}

/**
 * Split one YAML list entry the way the child will.
 *
 * `--tools` is a single argv string that the host re-splits on commas
 * (`pi/dist/cli/args.js`: `args[++i].split(",")`), so a list entry written
 * `"read,+bash"` is *two* entries by the time anything judges it. Validating the
 * unsplit form certifies a list the child never runs with — and the resulting
 * mix of names and modifiers is rejected wholesale by pi, so the child ends up
 * with no allowlist at all. An entry without a comma is returned as the trimmed
 * single entry, so a deliberate empty entry (`- ""`) stays visible for the name
 * rules to report rather than vanishing here.
 */
function splitListEntry(item: string): string[] {
  return item.includes(",") ? splitToolEntries(item) : [item.trim()];
}

export type ReadToolEntriesResult = { entries: string[] } | { error: string };

/**
 * Read a `tools:` **frontmatter value** as entries, before any name rules apply.
 *
 * pi's frontmatter parser hands over whatever YAML said, and there are three
 * spellings in the wild: the comma-separated string this suite's writer emits,
 * a hand-written block list (`tools:\n  - read`), and an inline list
 * (`tools: [read]`) — the two list forms both arrive as real arrays. All three
 * mean the same allowlist, and a list entry is comma-split on the way in so the
 * entries judged here are the entries the child receives (`splitListEntry`).
 * Anything else (a number, a mapping, a list holding a
 * mapping) is not a tool list, and must be *said* to be broken rather than
 * skipped: an allowlist this function refuses to read is a child that runs with
 * every tool the host has, which is the whole thing ADR 0028 is about.
 */
export function readToolEntries(
  raw: unknown,
  context: ValidateToolsContext = {},
): ReadToolEntriesResult {
  const { subject, where } = address(context);
  if (typeof raw === "string") return { entries: splitToolEntries(raw) };
  if (Array.isArray(raw)) {
    const entries: string[] = [];
    for (const item of raw) {
      if (typeof item !== "string") {
        return {
          error: `${subject} has a tools entry that is not a tool name${where}: ${JSON.stringify(item) ?? String(item)}. Each entry is a tool name on its own line (or one comma-separated list).`,
        };
      }
      entries.push(...splitListEntry(item));
    }
    return { entries };
  }
  return {
    error: `${subject}'s tools field${where} is not a list of tool names: ${JSON.stringify(raw) ?? String(raw)}. Write it as "read, bash" or as a YAML list with one tool name per entry.`,
  };
}

/**
 * Reject entries that cannot be tool names. Order matters: the first problem in
 * list order is reported, so the user fixes one thing at a time.
 */
export function validateToolEntries(
  entries: readonly string[],
  context: ValidateToolsContext = {},
): ValidateToolsResult {
  const { subject, where } = address(context);
  const seen = new Set<string>();

  for (const [index, entry] of entries.entries()) {
    // An entry that is only whitespace is the empty entry it trims to; the list
    // the child receives is trimmed, so it is reported that way.
    if (entry.trim() === "") {
      return {
        ok: false,
        error: `${subject} has an empty entry${where} in its tools list: "" (entry ${index + 1} of ${entries.length}). Entries are comma-separated tool names — remove the stray comma.`,
      };
    }
    const sign = entry.startsWith("+") ? "+" : entry.startsWith("-") ? "-" : "";
    if (sign !== "") {
      return {
        ok: false,
        error: `${subject} has a tools entry starting with "${sign}"${where}: "${entry}". pi reads +name/-name entries as modifiers on the default tool set, not as tool names, and a list that mixes them with names is rejected outright — the whole allowlist is dropped. Use the bare name "${entry.slice(1)}" to allow it, or leave it out.`,
      };
    }
    // The comma rule sits *after* the modifier rule deliberately: for an entry
    // like `+a,b` the modifier is what the child chokes on first, and that
    // message says more. `readToolEntries` already splits commas on the read
    // path, so this rule guards every other caller (`applyToolEntries`, and
    // anything that builds an AgentConfig directly): the list we validate has to
    // be the list the child runs with, because pi re-splits the one argv string
    // it is handed and drops a mixed list outright.
    if (entry.includes(",")) {
      const parts = entry.split(",").map((part) => part.trim()).filter((part) => part !== "");
      return {
        ok: false,
        error: `${subject} has a tools entry containing a comma${where}: "${entry}". The allowlist reaches the child as one comma-separated list, so this entry becomes ${parts.length} entries by the time pi reads it — write them separately (${parts.map((part) => `"${part}"`).join(", ")}).`,
      };
    }
    if (seen.has(entry)) {
      return {
        ok: false,
        error: `${subject} lists the tool "${entry}" twice${where} in its tools list. List each tool once.`,
      };
    }
    seen.add(entry);
  }

  return { ok: true };
}

/**
 * Write a tools list onto an agent config, or refuse it.
 *
 * The edit-site half of the rule: a rejected value leaves `agent.tools` exactly
 * as it was — a half-applied list is what a user would otherwise hand to a child
 * without noticing. Returns the error message, or `null` when it applied.
 *
 * A commit also settles the two pieces of state that describe the list it is
 * replacing. The config read keeps an unreadable `tools:` in `extraFields` so a
 * save cannot delete the user's line, and records `toolsError` so dispatch and
 * the panel refuse the agent; both are claims about the *old* value, and
 * `serializeAgent` writes `tools` and every extra field — so leaving them
 * behind puts a second (or, after a clear, the only) `tools:` key back in the
 * file and the agent reads as broken again after a reload.
 */
export function applyToolEntries(
  agent: AgentConfig,
  entries: readonly string[],
  context: ValidateToolsContext = {},
): string | null {
  // Normalised first: the allowlist reaches the child as names, so " read " and
  // "read" are the same entry here, not two.
  const normalized = entries.map((entry) => entry.trim());
  const result = validateToolEntries(normalized, {
    agentName: context.agentName ?? agent.name,
    agentFilePath: context.agentFilePath ?? agent.filePath,
  });
  if (!result.ok) return result.error;
  if (normalized.length > 0) {
    agent.tools = [...normalized];
  } else {
    delete agent.tools;
  }
  delete agent.toolsError;
  if (agent.extraFields) {
    delete agent.extraFields.tools;
    if (Object.keys(agent.extraFields).length === 0) delete agent.extraFields;
  }
  return null;
}

/**
 * `*` matches any characters, as pi's own `--tools` / `--exclude-tools` entries
 * accept it (mirrors `createToolNameMatcher` in pi's `core/mcp-servers.js`, which
 * is not part of pi's public API surface).
 */
function patternRegExp(pattern: string): RegExp {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`);
}

/**
 * Entries that no currently-registered tool satisfies.
 *
 * Membership, so this belongs at dispatch (where `pi.getAllTools()` is in
 * scope). A `*` entry is judged the way the host judges it — satisfied when at
 * least one available tool matches — so `mcp__radius__*` is not reported while
 * that server's tools are connected.
 */
export function unknownToolEntries(
  entries: readonly string[],
  knownNames: Iterable<string>,
): string[] {
  const known = [...knownNames];
  return entries.filter((entry) => {
    if (entry.includes("*")) {
      const pattern = patternRegExp(entry);
      return !known.some((name) => pattern.test(name));
    }
    return !known.includes(entry);
  });
}

/**
 * The dispatch warning for unavailable entries.
 *
 * It says the run is proceeding because that is the decision worth reading:
 * the alternative reading of an absent tool is "this config is broken", and it
 * is usually wrong (plugin off, MCP server down).
 */
export function formatUnknownToolsWarning(agentName: string, entries: readonly string[]): string {
  const listed = entries.map((entry) => `"${entry}"`).join(", ");
  return [
    `Subagent "${agentName}" asked for tool(s) pi does not currently have: ${listed}.`,
    "The run proceeds without them — expected while the plugin that provides a tool is off, or its MCP server is disconnected.",
  ].join(" ");
}
