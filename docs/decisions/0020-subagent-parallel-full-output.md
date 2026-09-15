---
status: accepted
date: 2026-09-15
superseded-by:
---

# Subagent parallel results carry full child output, untruncated

Parallel `subagent` dispatch returns each task's full `finalOutput` (with the metrics line as a header) in the tool result `content`, untruncated — identical to single mode. This was the original behavior gap: parallel mode returned only a metrics summary, contradicting the README's "returns the combined results".

We deliberately do **not** cap or truncate the output, even though pi's extension docs state tools should self-truncate to protect the LLM context (a large fan-out can add thousands of tokens per call). Consistency between single and parallel mode wins: the parent model gets the same information regardless of how the work was batched, and the caller (the main agent) decides how much work to fan out.

## Considered Options

- Per-task or per-call output cap (16KB / pi's 50KB convention) — rejected: adds a knob and a second behavior to maintain; the context cost is proportional to the work the caller already asked for.
- Opt-in field (`fullOutput: true`) — rejected: the summary-only default was the bug, not a feature worth preserving behind a flag.

## Consequences

- A large fan-out (e.g. 7 tasks × ~2k-token outputs ≈ 16k tokens) lands in the parent's context in one tool result. pi does not cap extension tool output; the only protection is the provider's context window and pi's auto-compaction.
- `finalOutput` includes the child's thinking blocks (prefixed `[thinking]`), so blocks are larger than what the child "said". This is accepted for consistency with single mode.
