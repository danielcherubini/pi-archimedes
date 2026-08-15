# [Subagent: thinking level in agents.local.json] Plan

**Goal:** Extend the `agents.local.json` per-agent override store in the subagent package from model-only to also cover the `thinking` level field, so both fields are read from and written to the local JSON store with `.md` frontmatter as fallback.

**Architecture:** The existing pattern from plan-015 is mirrored for `thinking`. The read path (`agents.ts::applyLocalOverrides`) applies the JSON `thinking` override on top of the `.md` frontmatter after discovery, so `spawn.ts` (which already passes `agent.thinking` via `--thinking`) picks it up with no changes. The write path (`agent-manager.ts::saveAgent`) writes `thinking` to JSON and strips it from the `.md` serialization, exactly like `model`. `local-config.ts` gains field-level primitives (`writeLocalField` / `deleteLocalField` / `deleteLocalAgent`) so that clearing one field no longer deletes the other — a latent bug in today's entry-level `deleteLocalModel` that becomes real once entries hold two fields.

Note on `list_agents`: the override IS applied to the `AgentConfig` objects that `list_agents` consumes, but `formatAgentList` only *renders* `model` and tools — it does not display `thinking`, and this plan deliberately does not change it (out of scope).

**Tech Stack:** TypeScript + Node.js `fs` (atomic tmp+rename writes, same pattern as `packages/core/src/settings-io.ts`), vitest for tests, `tsc --noEmit` for type-checking.

**Background (for a context-free reader):** `~/.pi/agent/agents.local.json` (path: `getAgentDir() + "/agents.local.json"`) stores per-agent local overrides keyed by agent name. Current shape: `{ "<agent>": { "model": "<provider/model-id>" } }`. New shape: `{ "<agent>": { "model"?: "<provider/model-id>", "thinking"?: "<level>" } }`. The file is machine-local (not committed to repos); `.md` frontmatter `model:` / `thinking:` lines still work as fallback for hand-written agent files. Agents are `.md` files discovered from global/user/project scopes by `packages/subagent/src/agents.ts`; the `/agents` TUI in `packages/subagent/src/agent-manager.ts` edits and saves them. `exactOptionalPropertyTypes` is enabled in the root tsconfig — strip optional fields with `delete obj.field`, never `obj.field = undefined`.

---

### Task 1: Extend local-config.ts with field-level operations and the thinking field

**Context:**
This task extends the JSON store module with the `thinking` field and refactors the delete semantics from entry-level to field-level. Today `deleteLocalModel(agentName)` deletes the *entire* agent entry — fine while entries hold one field, but once entries can hold both `model` and `thinking`, clearing the model would silently wipe the thinking override. The field-level core also avoids duplicating the read-modify-write logic a second time for `thinking`. All existing `local-config.test.ts` tests must still pass unchanged (they only ever create single-field entries, so field-level delete observes identical results).

**Files:**
- Modify: `packages/subagent/src/local-config.ts`
- Test: `packages/subagent/src/local-config.test.ts`

**What to implement:**

1. In `local-config.ts`:
   - Add `export type LocalField = "model" | "thinking";`
   - Change the type to `export type LocalConfig = Record<string, Partial<Record<LocalField, string>>>;` (same shape as today's `Record<string, { model?: string }>`, extended with `thinking?`). Existing on-disk files remain valid.
   - Add the field-level core:
     ```ts
     /** Set the local override for a field on a given agent, preserving existing entries. */
     export function writeLocalField(agentName: string, field: LocalField, value: string): void {
       const config = readLocalConfig();
       config[agentName] = { ...config[agentName], [field]: value };
       writeConfigAtomic(config);
     }

     /**
      * Delete the local override for a field on a given agent (no-op if absent).
      * Removes ONLY the given field — other fields in the same entry are
      * preserved. If no fields remain, the entry itself is removed.
      */
     export function deleteLocalField(agentName: string, field: LocalField): void {
       const config = readLocalConfig();
       const entry = config[agentName];
       if (!entry || !(field in entry)) return;
       delete entry[field];
       if (Object.keys(entry).length === 0) {
         delete config[agentName];
       }
       writeConfigAtomic(config);
     }

     /** Delete the entire local override entry for an agent (no-op if absent). Used on rename. */
     export function deleteLocalAgent(agentName: string): void {
       const config = readLocalConfig();
       if (!(agentName in config)) return;
       delete config[agentName];
       writeConfigAtomic(config);
     }
     ```
   - Replace the bodies of `writeLocalModel` / `deleteLocalModel` with thin delegations (`writeLocalField(agentName, "model", model)` / `deleteLocalField(agentName, "model")`). Keep the existing JSDoc intent. Note the deliberate semantic difference for degenerate empty entries: old entry-level `deleteLocalModel` removed `{ codex: {} }` entirely; field-level deletion is a no-op on an entry lacking the `model` key. Entries are always written with at least one field in practice, so this is acceptable; document it in the `deleteLocalField` JSDoc if desired.
   - Add parallel thinking wrappers with the same naming pattern:
     ```ts
     /** Set the local thinking-level override for a given agent, preserving existing entries. */
     export function writeLocalThinking(agentName: string, thinking: string): void {
       writeLocalField(agentName, "thinking", thinking);
     }

     /** Delete the local thinking-level override for a given agent (no-op if absent). */
     export function deleteLocalThinking(agentName: string): void {
       deleteLocalField(agentName, "thinking");
     }
     ```
   - Do NOT change: `getLocalConfigPath`, `readLocalConfigRaw`, `readLocalConfig`, `writeConfigAtomic`, `setLocalConfig`.

2. In `local-config.test.ts`, keep all existing tests as-is and add:
   - Update the import statement to: `import { readLocalConfig, writeLocalModel, deleteLocalModel, writeLocalThinking, deleteLocalThinking, deleteLocalAgent } from "./local-config.js";`
   - `describe("writeLocalThinking")`: creates file + entry `{ codex: { thinking: "high" } }`; preserves a `model` on the same entry when writing thinking after model (result `{ model: "o1", thinking: "high" }`); preserves other agent entries.
   - `describe("deleteLocalThinking")`: removes only the thinking field, keeping `model` on the same entry; removes the whole entry when thinking was the only field; no-op (and file-creating no-op check) for a nonexistent agent.
   - `describe("deleteLocalModel field-level semantics")`: after writing both model and thinking for one agent, `deleteLocalModel` leaves `{ codex: { thinking: "high" } }`.
   - `describe("deleteLocalAgent")`: removes the entire entry including all fields while preserving other agents; no-op for a nonexistent agent; does not materialize the file when the agent is absent on a clean install (mirror the existing `deleteLocalModel` no-file test).

**Steps:**
- [ ] Add the new tests in `packages/subagent/src/local-config.test.ts` first.
- [ ] Run `npx vitest run src/local-config.test.ts` in `packages/subagent/`.
  - Did the new tests fail (missing exports / wrong shape)? If yes, proceed.
- [ ] Implement the changes in `packages/subagent/src/local-config.ts`.
- [ ] Run `npx vitest run src/local-config.test.ts` — all tests (old + new) must pass.
- [ ] Run `npx tsc --noEmit` in `packages/subagent/` — must succeed.
- [ ] Commit with message: `feat(subagent): field-level agents.local.json ops + thinking field`

**Acceptance criteria:**
- [ ] `LocalConfig` entries may hold `model` and/or `thinking` independently.
- [ ] Clearing one field preserves the other field on the same agent.
- [ ] `deleteLocalAgent` removes the whole entry; absent agents are no-ops that do not create the file.
- [ ] All pre-existing `local-config.test.ts` tests pass unchanged.
- [ ] `tsc --noEmit` passes.

---

### Task 2: Apply thinking overrides during discovery in agents.ts

**Context:**
`applyLocalOverrides()` is called by both `discoverAgents()` and `discoverAgentsAll()` after `.md` files are loaded. It currently only applies the `model` override. Extending it with `thinking` means every consumer — the `/agents` TUI (detail/edit screens), `list_agents` output, and the spawn path (`index.ts` → `discoverAgents` → `spawnSubagent`, which already emits `--thinking` when `agent.thinking` is set) — sees the JSON override without any further changes. JSON takes precedence; the `.md` value is the fallback when no JSON entry (or no `thinking` field in it) exists.

**Files:**
- Modify: `packages/subagent/src/agents.ts`
- Test: `packages/subagent/src/agents.test.ts`

**What to implement:**

1. In `agents.ts`, extend `applyLocalOverrides` (update its JSDoc to mention both fields):
   ```ts
   for (const agent of agents) {
     const local = config[agent.name];
     if (local?.model !== undefined) {
       agent.model = local.model;
     }
     if (local?.thinking !== undefined) {
       agent.thinking = local.thinking;
     }
   }
   ```
   Use the `!== undefined` guard (matching the existing model check), not a truthy check.

2. In `agents.test.ts` (inside the existing `describe("applyLocalOverrides")` block), add:
   - First extend the local `makeAgent` helper with an optional third parameter: `function makeAgent(name: string, model?: string, thinking?: string): AgentConfig` — spread `thinking` only when `!== undefined`, exactly mirroring the existing `model` conditional spread. Do not alter existing call sites.
   - Sets `thinking` from a JSON entry `{ codex: { thinking: "high" } }` on an agent with no frontmatter thinking.
   - Leaves `thinking` unchanged when no JSON entry exists for the agent (construct the agent with `makeAgent("codex", undefined, "low")`).
   - Leaves `thinking` unchanged when the JSON entry exists but has no `thinking` field (e.g. `{ codex: { model: "o1" } }`), and that the model IS still applied in the same call (agent constructed via `makeAgent("codex", "M1", "low")`).
   - Applies model and thinking together when both are present in the entry (frontmatter values are overridden: `makeAgent("codex", "M1", "low")` becomes model `o1`, thinking `high`).

**Steps:**
- [ ] Add the new tests in `packages/subagent/src/agents.test.ts`.
- [ ] Run `npx vitest run src/agents.test.ts` in `packages/subagent/`.
  - Did the new tests fail? If yes, proceed.
- [ ] Extend `applyLocalOverrides` in `packages/subagent/src/agents.ts`.
- [ ] Run `npx vitest run src/agents.test.ts` — all tests must pass.
- [ ] Run `npx tsc --noEmit` in `packages/subagent/` — must succeed.
- [ ] Commit with message: `feat(subagent): apply agents.local.json thinking overrides in discovery`

**Acceptance criteria:**
- [ ] JSON `thinking` overrides `.md` thinking when both exist.
- [ ] Absent JSON entry or absent `thinking` field leaves the `.md` value untouched.
- [ ] Existing model-override tests still pass unchanged.
- [ ] `tsc --noEmit` passes.

---

### Task 3: saveAgent writes thinking to JSON, strips it from .md

**Context:**
`saveAgent()` in `agent-manager.ts` is the single save path for the `/agents` TUI (edit screen and new-agent flow both funnel through it). Today it captures `agent.model`, strips model from the `.md` serialization, writes/removes the model entry in JSON (snapshotting `jsonConfigBefore` first for rollback), and — on rename — deletes the old-name entry. This task mirrors every one of those steps for `thinking`. The rename cleanup must switch from `deleteLocalModel(originalName)` to `deleteLocalAgent(originalName)`: with field-level deletes, the old entry's `thinking` field would otherwise survive the rename as a stale orphan. The catch-block `.md` rollback serializations must include `thinking` so a failed save never loses it, and the "keep a fallback .md vs delete the new file" decisions must treat `thinking` as fallback-worthy state just like `model`. `jsonWritten = true` stays AFTER both field writes — moving it earlier would materialize an empty `agents.local.json` on a clean-install failure; the residual edge case (model write succeeds, thinking write throws, so the snapshot rollback is skipped) is harmless because a retry writes the identical model value.

**Files:**
- Modify: `packages/subagent/src/agent-manager.ts`
- Test: `packages/subagent/src/save-agent.test.ts`

**What to implement:**

1. In `agent-manager.ts`:
   - Import `writeLocalThinking`, `deleteLocalThinking`, `deleteLocalAgent` from `./local-config.js` (alongside the existing imports).
   - In `saveAgent()`, next to `const model = agent.model;` add `const thinking = agent.thinking;` and extend the surrounding comment to mention both fields.
   - In the `.md` serialization prep, after `delete mdAgent.model;` add `delete mdAgent.thinking;` (update the comment: both fields are stored in agents.local.json).
   - After the existing model write/remove block and before `jsonWritten = true;` add:
     ```ts
     if (thinking !== undefined) {
       writeLocalThinking(agent.name, thinking);
     } else {
       deleteLocalThinking(agent.name);
     }
     ```
   - In the rename cleanup block, replace `deleteLocalModel(originalName)` with `deleteLocalAgent(originalName)` (keep the try/catch and update the comment to "delete old JSON entry" — it now covers all fields).
   - In the catch block, update the two fallback decisions and two rollback serializations. IMPORTANT under `exactOptionalPropertyTypes`: the existing `serializeAgent({ ...agent, model })` compiles only because its guard `else if (model !== undefined)` narrows `model` to `string`. Widen the guard to `model !== undefined || thinking !== undefined` and a plain spread `{ ...agent, model, thinking }` will NOT compile (an `||` of independent conditions narrows neither variable — `TS2379`). Build the fallback object conditionally instead. Both sites (the `isRename && !oldPathDeleted` "keep newPath with fallback" branch and the non-rename "new file with fallback" branch) become:
     ```ts
     } else if (model !== undefined || thinking !== undefined) {
       const fallback: AgentConfig = { ...agent };
       if (model !== undefined) fallback.model = model;
       if (thinking !== undefined) fallback.thinking = thinking;
       try { fs.writeFileSync(newPath, serializeAgent(fallback), "utf-8"); } catch { /* best-effort */ }
     } else {
       // ...unchanged delete branch, comment updated to "no model/thinking"
     }
     ```
     (`AgentConfig` is already type-imported in `agent-manager.ts`.)
     - Update the adjacent comments to say "model/thinking".
   - At the end of the try block, after `delete agent.model;` add `delete agent.thinking;` (extend the comment).
   - Do NOT change: `serializeAgent` in `frontmatter-io.ts` (its `if (config.thinking)` guard already omits the line when absent), the agent-delete handler (orphan entries are intentionally not cleaned up, same as model), `formatAgentList` in `agents.ts`, the model/tool pickers, or any render code.

2. In `save-agent.test.ts`:
   - Extend the file-level `vi.mock("./local-config.js")` spread with:
     ```ts
     writeLocalThinking: vi.fn(() => {
       throw new Error("JSON thinking write failed");
     }),
     deleteLocalThinking: vi.fn(),
     deleteLocalAgent: vi.fn(),
     ```
     (default-throw for the writer mirrors `writeLocalModel`; existing tests never reach it because their agents carry no thinking).
   - Replace the top-level import `import { writeLocalModel } from "./local-config.js";` with `import { writeLocalModel, writeLocalThinking, deleteLocalThinking, deleteLocalAgent } from "./local-config.js";` so all four are available for `vi.mocked(...)` access.
   - Keep every existing test as-is. All eight must still pass.
   - Add `describe("saveAgent thinking JSON round-trip")` with:
     - `restores thinking to .md when the JSON thinking write fails`: `vi.mocked(writeLocalModel).mockImplementationOnce(() => {})` so the model write succeeds and the (default-throwing) `writeLocalThinking` fails. Agent has `model: "openai/gpt-4o"`, `thinking: "high"`, no pre-existing `.md`. After `saveAgent`: the `.md` contains both `model: openai/gpt-4o` and `thinking: high`, `editError` is set, and the live edit object retains both values.
     - `retains thinking for retry when re-discovery fails`: model write mocked to succeed, `writeLocalThinking` mocked to succeed once via `vi.mocked(writeLocalThinking).mockImplementationOnce(() => {})`, `discoverAgentsAll` mocked to throw once. After `saveAgent`: the live edit object still has `thinking: "high"`, `editError` contains "discovery failed", and the rolled-back `.md` contains `thinking: high`.
     - `clearing thinking on save removes only the thinking field from JSON` (async test): pre-seed `agents.local.json` with `{ codex: { model: "o1", thinking: "high" } }`; agent has `model: "o1"` and NO `thinking`; fetch the real module with `await vi.importActual<typeof import("./local-config.js")>("./local-config.js")` and delegate `writeLocalModel` and `deleteLocalThinking` to the real implementations via `mockImplementationOnce` (delegation is essential — the no-op mock default would leave `thinking: "high"` behind); mock `discoverAgentsAll` to return an empty successful discovery. After `saveAgent`: JSON equals `{ codex: { model: "o1" } }` (thinking removed, model preserved).
     - `writes thinking to agents.local.json and strips it from .md on a successful save` (async test): fetch the real module with `await vi.importActual<typeof import("./local-config.js")>("./local-config.js")`; delegate `writeLocalModel` / `writeLocalThinking` / `deleteLocalAgent` to the real implementations via `mockImplementationOnce`; mock `discoverAgentsAll` to return `{ global: [], user: [], project: [], globalDir: null, userDir: testDir, projectDir: null }`. Agent has both model and thinking. After `saveAgent`: `agents.local.json` equals `{ codex: { model: "openai/gpt-4o", thinking: "high" } }`, the `.md` contains neither `model:` nor `thinking:`, and `editAgent.model` / `editAgent.thinking` are both `undefined` (stripped).
     - `migrates model and thinking JSON entries on rename` (async test): pre-seed the JSON file with `{ oldcodex: { model: "old-model", thinking: "high" } }` and create `oldcodex.md`; agent is renamed to `codex` carrying `model: "old-model"`, `thinking: "high"`; delegate `writeLocalModel`, `writeLocalThinking`, and `deleteLocalAgent` to the real implementations via `mockImplementationOnce`; mock `discoverAgentsAll` to return an empty successful discovery. After `saveAgent`: JSON equals `{ codex: { model: "old-model", thinking: "high" } }` (no `oldcodex` key), `oldcodex.md` is unlinked, and `codex.md` has no model/thinking lines.

**Steps:**
- [ ] Add the new tests and the mock extensions in `packages/subagent/src/save-agent.test.ts`.
- [ ] Run `npx vitest run src/save-agent.test.ts` in `packages/subagent/`.
  - Did the new tests fail while all 8 existing tests still pass? If the existing tests broke, stop and investigate before proceeding.
- [ ] Implement the `saveAgent` changes in `packages/subagent/src/agent-manager.ts`.
- [ ] Run `npx vitest run src/save-agent.test.ts` — all tests must pass.
- [ ] Run `npx tsc --noEmit` in `packages/subagent/` — must succeed. The conditional fallback construction above is the only form that type-checks; do not use a plain object spread with `model`/`thinking` keys.
- [ ] Run the full package suite `npx vitest run` in `packages/subagent/` — all files must pass.
- [ ] Commit with message: `feat(subagent): write thinking to agents.local.json on save, strip from .md`

**Acceptance criteria:**
- [ ] Saving an agent with a thinking level writes it to `agents.local.json` and the `.md` has no `thinking:` line.
- [ ] Clearing the thinking level in the TUI removes it from `agents.local.json` (field-level, model preserved — covered by the dedicated saveAgent test).
- [ ] Renaming an agent migrates both model and thinking to the new name and leaves no stale entry under the old name.
- [ ] A failed JSON write or failed re-discovery rolls back both `.md` and JSON, keeping thinking recoverable in either.
- [ ] All 8 pre-existing `save-agent.test.ts` tests pass unchanged.
- [ ] `tsc --noEmit` and the full subagent test suite pass.

---

### Task 4: Document the local override store in the subagent README

**Context:**
`packages/subagent/README.md` documents the agent-file frontmatter fields but never mentions `agents.local.json` (it was introduced after the last README pass). Since this change doubles the number of fields stored there, the storage behavior should be one short paragraph in the "Agent files" section so users know why their `model:`/`thinking:` lines disappear from `.md` files after a TUI save.

**Files:**
- Modify: `packages/subagent/README.md`

**What to implement:**
- In the "Agent files" section, directly after the sentence "Frontmatter supports: `name`, `description`, `model`, `tools`, and `thinking`...", add one paragraph: per-agent `model` and `thinking` assignments made in the `/agents` TUI are stored in `~/.pi/agent/agents.local.json` (machine-local, not committed) and take precedence over frontmatter values; frontmatter `model:` / `thinking:` still work as fallback for hand-written agent files.
- Do NOT change screenshots, install, usage, or integration sections.

**Steps:**
- [ ] Make the README edit.
- [ ] Re-read the section to confirm it is consistent with the implemented behavior.
- [ ] Commit with message: `docs(subagent): document agents.local.json model/thinking storage`

**Acceptance criteria:**
- [ ] The README states that `model` and `thinking` are stored in `~/.pi/agent/agents.local.json` by the TUI and override frontmatter.

---

## Verification Summary

After all tasks:
- Run `npx tsc --noEmit` in `packages/subagent/` — must pass.
- Run `npx vitest run` in `packages/subagent/` — all tests must pass (existing 91 + new).
- Run `pnpm test` from the repo root — no other package is touched, but confirm nothing regressed.
- Backward compatibility: with no `agents.local.json` present, discovery and spawn behavior are identical to today; with a model-only file (pre-existing shape), behavior for model is identical and thinking falls back to frontmatter.
- Read priority: JSON `model`/`thinking` override `.md` values when both exist (both fields, symmetric).
- Spawn: `spawnSubagent` requires no change — it reads `agent.thinking` from the discovered config, which now carries the JSON override.
