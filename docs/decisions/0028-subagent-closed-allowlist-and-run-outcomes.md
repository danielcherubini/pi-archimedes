---
status: accepted
date: 2026-10-13
superseded-by:
---

# Treat a subagent's tool allowlist as a closed set, and report three run outcomes

pi 1.0.4 changed `--tools` so that it *keeps* MCP tools unless an entry starts with `mcp__` and added `--no-mcp`; 1.1.0 added `+name`/`-name` entries as **modifiers** to the list rather than as names; and 1.2.0 made print mode exit `1` with a stderr warning when the final response hit the output token limit. Our spawn path is `packages/subagent/src/spawn.ts:227-233`, which joins `agent.tools` verbatim into `--tools` and appends `--exclude-tools subagent`, with no validation on either side. We decided to pass `--no-mcp` unless an agent config opts in, to validate `tools:` entries at both edit time and spawn time, and to replace the binary pass/fail result with `completed` / `truncated` / `aborted`.

A `tools:` list in an agent config reads as a closed set — "this agent may use these three tools" — and after 1.0.4 it no longer is one: a child configured with `read, bash, edit` also receives every connected MCP server, plus `codemode` and `tool_search` when `defaultTools` enables them. We chose to restore the closed reading by default because the other surprises in this range were all of the widening kind, and ADR 0010 already established that this suite prefers a privilege that must be asked for over one that arrives by inheritance. The modifier change makes the same field actively dangerous rather than merely leaky: the `/agents` panel accepts a comma-separated list (`agent-panel.ts:469,1020`), so an entry like `+web_search` used to be a nonexistent tool name that did nothing and now silently alters the meaning of the entire list. Validating entries on edit as well as on spawn follows ADR 0008's model pre-validation precedent — reject the value with a specific message before it reaches a child process — rather than inventing a second input-validation pattern.

The exit-code change is a different failure: information destroyed rather than added. `packages/subagent/src/stream.ts:206-210` reduces the child to `code ?? 1`, so once 1.2.0 exits `1` for a response truncated at the output token limit, a genuinely useful-but-cut-off answer reports as the same generic failure as a crash. That particular loss cannot be reconstructed downstream — nothing else in the result says "the answer was cut off". So the run outcome becomes three-valued, derived from the child's own `stopReason` and 1.1.0's `agent_settled.aborted` (we currently conclude on `agent_end`, `stream.ts:197`, which fires for a cancelled run too), with cost accounting preserved in all three cases.

**Considered Options**

- **MCP opt-out** — pass `--no-mcp` only when a setting asks for it, preserving today's widened behaviour for users who want MCP tools in children. Rejected: it keeps the closed-set reading wrong by default, and the fix for a user who wants MCP in a child is one config line, whereas the fix for an unexpected MCP surface is noticing it first. Defensible if the widening turns out to be what people configured for; we have no evidence either way today.
- **Validate `tools:` only at spawn** — rejected: it leaves the `/agents` panel accepting input that will fail later, and the panel is where the mistake is typed. Pre-validation is cheaper to explain than a deferred error, and ADR 0008 already does exactly this for models.
- **Keep a binary outcome and encode truncation in the message text** — rejected: the model and the Archimedes Client both consume the subagent result, and a string that happens to say "truncated" is not something either can branch on. A named outcome is also what makes a future retry-on-truncation policy expressible.
- **Trust `--exclude-tools` for MCP instead of `--no-mcp`** — rejected: exclusion is a name-matching operation over a set we cannot enumerate (servers connect at runtime), while `--no-mcp` is the host's own statement of intent.

**Consequences**

- Agent configs that *want* MCP tools in a child need an explicit opt-in field, and existing configs silently lose MCP access on upgrade. That is the intended direction of the change, but it is a behaviour change and belongs in the release notes, not only in a changelog line.
- `+`/`-` prefixed and unknown entries are now rejected where they were previously accepted and ignored, so a config that carried one by accident stops the dispatch with a message instead of quietly misbehaving.
- The run outcome is now part of the tool-result contract the calling model reads, and of what the bridge reports to the Archimedes Client; both consumers must handle `truncated` and `aborted` rather than treating non-`completed` as an error string.
- Outcome derivation depends on the child's `stopReason` and `agent_settled.aborted`, which is one more reason subagent's floor is `>=1.2.0` (ADR 0026) rather than a documentation-only number.
- `--no-mcp` and the modifier syntax are pi 1.0.4/1.1.0 CLI surface. They are CLI, not typed API, so the CI float job (ADR 0026) is what notices when they change again.
