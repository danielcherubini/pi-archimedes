# Pre-spawn model validation in the subagent extension

When an LLM dispatches a subagent with a bogus `model` (most often by mirroring the `agent` name into `model`, e.g. `agent: "general", model: "general"`), the value flows unchanged through `spawn.ts` into the child `pi --model <value>` process, which calls pi core's `resolveCliModel`, prints `Model "X" not found. Use --list-models…` in red, and `exit(1)` — a wasted spawn (~5s, zero tokens) plus orchestrator self-diagnosis, recurring on the first subagent call of fresh sessions. We decided to **validate the `model` parameter inside the subagent tool's `execute()` before spawning**, returning a friendly `isError` tool result that names the problem and lists available models, rather than leaving resolution entirely to the child.

## Considered Options

- **Leave resolution to the child (status quo).** Least code, but every bogus model becomes a raw CLI error from a doomed child process — confusing and wasteful.
- **Anti-mirror check only** (reject when `model === agent`). Zero false-reject risk, but catches only the exact mirror pattern, not other bogus models.
- **Registry validation (chosen).** Match `model` against `ctx.modelRegistry.getAvailable()` on exact `id` / `provider/id`; reject if no match, with an adaptive message (agent-name hint when `model === agent`, config-pointing message when an agent's configured `model:` is invalid).

## Consequences

- The subagent package now carries a small subset of the child's model-matching logic (`findExactModelReferenceMatch`-style exact + bare-id matching, thinking-suffix tolerance). This can drift from pi core's resolver, which also does fuzzy/partial matching we deliberately do **not** replicate — fuzzy patterns the child might accept are rejected here. Acceptable because `model` override is discouraged (the implement skill forbids it), so legitimate fuzzy usage is near-zero.
- Validation is exact-match against `getAll()` (all known models — a pure name-existence check), mirroring how the child's `resolveCliModel` resolves against all models; auth-status checks are left to the child, which surfaces accurate auth errors.
- Fails fast with no child spawned, matching the existing unknown-agent error pattern; `spawn.ts` remains a pure spawner.
