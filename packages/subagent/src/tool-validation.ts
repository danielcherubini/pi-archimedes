import type { AgentConfig } from "./agents.js";

// ── Tool-name validation, split by what each site is allowed to know ────────
//
// Two questions look similar and are not:
//
//   **Lexical** — can this string be a tool *name* at all? Empty/whitespace
//   entries, duplicates, and entries starting with `+` or `-` cannot. pi 1.1.0
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
