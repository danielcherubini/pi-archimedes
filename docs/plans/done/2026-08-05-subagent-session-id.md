# Expose subagent Pi session IDs

**Status:** COMPLETED

**Created:** 2026-08-05

## Goal

Expose the logical Pi session UUID already created for each spawned subagent as optional `SubagentResult.childSessionId`.

## Previous behavior

Each executed subagent task launches its own fresh one-shot process:

```text
pi --mode json --no-session -p <task>
```

`--no-session` disables transcript persistence, not logical session identity. Pi still creates an in-memory UUID and emits it in the initial JSON event:

```json
{"type":"session","id":"<uuid>","timestamp":"...","cwd":"..."}
```

Before this change, `streamEvents` ignored that event. Results therefore had no deterministic key for joining a child execution to telemetry grouped by its Pi session.

## Final design

- Retain `--no-session` and all existing spawn behavior.
- Capture a nonempty string `id` from Pi's JSON `session` event.
- Store it in stream state and return it as optional `SubagentResult.childSessionId`.
- Omit the field when the child exits before emitting a valid session event.
- Keep the field out of high-frequency progress updates.
- Use the Pi session UUID as the only external correlation key; do not add another invocation ID or a vendor-specific trace ID.

## Compatibility and boundaries

The field is additive and optional. Existing consumers that ignore it remain compatible.

Unchanged behavior includes process arguments, environment inheritance, Windows spawning, IPC, cancellation, startup timeout, socket cleanup, progress payloads, usage and cost accounting, and parallel result ordering.

This change does not:

- persist child transcripts or remove `--no-session`;
- add parent session IDs or distributed trace context;
- couple Archimedes to Langfuse or another telemetry vendor; or
- expose one-click trace URLs.

## Changed surfaces

- `packages/subagent/src/types.ts`
- `packages/subagent/src/stream.ts`
- `packages/subagent/src/stream.test.ts`
- `packages/subagent/README.md`
- `docs/plans/README.md`

## Verification

CI-equivalent checks:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm -r exec -- tsc --noEmit
corepack pnpm test
```

Additional focused checks:

```bash
corepack pnpm --dir packages/subagent exec tsc --noEmit
corepack pnpm --dir packages/subagent exec vitest run src/stream.test.ts
```

Results:

- all 9 workspace package typechecks passed;
- 2 focused stream tests passed;
- all 223 repository tests passed; and
- a manual one-shot run returned the exact child Pi session ID and used it to find the child's single external trace.

## Acceptance criteria

- [x] A valid JSON `session.id` is captured exactly.
- [x] Missing or non-string session IDs are ignored.
- [x] The final result contains the captured optional `childSessionId`.
- [x] Failure before the session header leaves the field undefined.
- [x] Progress shape and process, platform, cancellation, and ordering behavior remain unchanged.
- [x] Focused, package, and repository checks pass.
