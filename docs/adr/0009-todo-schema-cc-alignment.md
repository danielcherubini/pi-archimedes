# Todo schema follows the Claude Code training prior

The `manage_todo_list` tool used a strict 4-field item shape (`id: number`, `title`, `description`, `status: not-started|in-progress|completed`). Frozen open-weight models (Qwen3.x, trained on Claude-Code-style agentic environments) consistently fight this shape: they omit or null the invented `id`, use `content`/`step` instead of `title`, and emit `pending`/`in_progress`. Research of mainstream harnesses (2026-08): Claude Code `TodoWrite` = `{content, status, activeForm?}`, Codex `update_plan` = `{step, status}`, Gemini CLI `write_todos` = `{description, status}` — none ask the model to generate an id.

We decided to align the item shape exactly with the Claude Code prior: `{content, status: pending|in_progress|completed, description?}`, no `id`, index-based display numbering. `description` stays (optional, for subagent-dispatch planning); `activeForm` is not adopted (no spinner integration). The `prepare-args` repair layer is demoted from primary surface to a backstop (it still absorbs Codex `step`, bare strings, stringified arrays, legacy field names, and status aliases). Legacy persisted state (`title`, `not-started`) is normalized in `loadFromSession`.

Considered and rejected:

- **Robustness only (strict schema stays)** — would not fix main-agent hard failures on keys the model defaults to.
- **Keep our shape, relax constraints (id/description optional)** — permanently depends on the repair layer for the model's primary text field, and keeps the invented-`id` field in the schema, which no model's training data includes.

Consequences: models that already conformed (Anthropic) see a smaller, different schema and re-adapt in-session; anything pre-migration becomes unreadable-without-normalization by design, so `loadFromSession` must keep the legacy alias map alive as long as old session files exist.
