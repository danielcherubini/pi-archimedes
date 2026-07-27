# [Agents Local JSON] Plan

**Goal:** Introduce `~/.pi/agent/agents.local.json` as the primary store for per-agent model assignments in the subagent package, with fallback to YAML frontmatter in `.md` agent config files.

**Architecture:** A new `local-config.ts` module handles atomic read/write of `agents.local.json`. The read path (`agents.ts`) applies JSON model overrides after loading `.md` files. The write path (`agent-manager.ts::saveAgent`) writes models to JSON and strips them from `.md` serialization.

**Tech Stack:** TypeScript + Node.js `fs`, vitest for testing, following the `settings-io.ts` pattern for atomic JSON writes.

---

### Task 1: Create local-config.ts module with tests

**Context:**
This task creates the new `agents.local.json` I/O module. It reads/writes a JSON file at `~/.pi/agent/agents.local.json` (path resolved via `getAgentDir()` from `@earendil-works/pi-coding-agent`). The file stores per-agent model overrides in the format `{ "agent-name": { "model": "provider/model-id" } }`. Atomic writes use the tmp+rename pattern established by `packages/core/src/settings-io.ts`. The path is resolved via a **function** (not a module-level constant) so tests can redirect it via the `PI_CODING_AGENT_DIR` environment variable.

**Files:**
- Create: `packages/subagent/src/local-config.ts`
- Create: `packages/subagent/src/local-config.test.ts`

**What to implement:**

1. In `local-config.ts`:
   - Import `readFileSync`, `writeFileSync`, `existsSync`, `renameSync`, `unlinkSync` from `node:fs`
   - Import `join` from `node:path`
   - Import `getAgentDir` from `@earendil-works/pi-coding-agent`
   - Export type `LocalConfig = Record<string, { model?: string }>`
   - Export `getLocalConfigPath(): string` — returns `join(getAgentDir(), "agents.local.json")` (function, not constant, for testability)
   - Export `readLocalConfig(): LocalConfig` — reads file, returns `{}` if missing or corrupt
   - Export `writeLocalModel(agentName: string, model: string): void` — reads current config, sets `config[agentName] = { ...config[agentName], model }`, writes atomically
   - Export `deleteLocalModel(agentName: string): void` — reads current config, deletes entry if exists, writes atomically
   - Internal helper `writeConfigAtomic(config: LocalConfig): void` — writes to `.tmp` then `renameSync` (falls back to direct write if rename fails; cleans up tmp on failure)

2. In `local-config.test.ts`:
   - Set `process.env.PI_CODING_AGENT_DIR` to a temp dir (`join(tmpdir(), "pi-test-local-config")`) before any function calls
   - Use `beforeEach` to `mkdirSync(testDir, { recursive: true })` and `afterEach` to `rmSync(testDir, { recursive: true, force: true })`
   - Tests:
     - `readLocalConfig` returns `{}` when file does not exist
     - `readLocalConfig` returns `{}` when file is corrupt JSON
     - `readLocalConfig` parses valid JSON correctly
     - `writeLocalModel` creates file and writes model entry
     - `writeLocalModel` preserves other agent entries when updating one
     - `writeLocalModel` handles model values with special characters (e.g. `openai/gpt-4.1`)
     - `deleteLocalModel` removes the specified agent entry
     - `deleteLocalModel` is a no-op when agent does not exist
     - `deleteLocalModel` preserves other entries
     - No `.tmp` file left behind after successful write

**Steps:**
- [ ] Write failing tests for all `readLocalConfig` / `writeLocalModel` / `deleteLocalModel` behaviors
- [ ] Run `npx vitest run src/local-config.test.ts`
  - Did tests fail with "module not found" / "function not defined"? If yes, proceed.
- [ ] Implement `local-config.ts`
- [ ] Run `npx vitest run src/local-config.test.ts`
  - Did all tests pass? If not, fix and re-run.
- [ ] Run `npx tsc --noEmit` in `packages/subagent/`
  - Did it succeed? If not, fix type errors and re-run.
- [ ] Commit with message: "feat(subagent): add local-config module for agents.local.json"

**Acceptance criteria:**
- [ ] All tests pass
- [ ] `tsc --noEmit` passes
- [ ] No `.tmp` files left behind after writes
- [ ] Corrupt JSON file handled gracefully (returns `{}`)

---

### Task 2: Add applyLocalOverrides to agents.ts with tests

**Context:**
After loading agent configs from `.md` files, `discoverAgents()` and `discoverAgentsAll()` must apply model overrides from `agents.local.json`. If a JSON entry exists for an agent name with a `model` field, it overrides the `.md` frontmatter model. If no JSON entry exists, the `.md` model is used as-is (fallback). The `applyLocalOverrides` function is exported for unit testing. It must be called after the agent list is fully built (after scope merging in `discoverAgents`, and after loading each scope array in `discoverAgentsAll`).

**Files:**
- Modify: `packages/subagent/src/agents.ts`
- Create: `packages/subagent/src/agents.test.ts`

**What to implement:**

1. In `agents.ts`:
   - Add import: `import { readLocalConfig } from "./local-config.js";`
   - Add and export function:
     ```ts
     export function applyLocalOverrides(agents: AgentConfig[]): void {
       const config = readLocalConfig();
       for (const agent of agents) {
         const local = config[agent.name];
         if (local?.model) {
           agent.model = local.model;
         }
       }
     }
     ```
   - In `discoverAgents()`: change `return Array.from(agentMap.values());` to:
     ```ts
     const all = Array.from(agentMap.values());
     applyLocalOverrides(all);
     return all;
     ```
   - In `discoverAgentsAll()`: after the three `loadAgentsFromDir` calls and before the return, add:
     ```ts
     applyLocalOverrides(globalAgents);
     applyLocalOverrides(userAgents);
     applyLocalOverrides(projectAgents);
     ```

2. In `agents.test.ts`:
   - Set `process.env.PI_CODING_AGENT_DIR` to a temp dir
   - `beforeEach` / `afterEach` for temp dir setup/teardown
   - Tests:
     - `applyLocalOverrides` sets model from JSON override
     - `applyLocalOverrides` leaves model unchanged when no JSON entry exists
     - `applyLocalOverrides` leaves model unchanged when JSON entry has no `model` field
     - `applyLocalOverrides` handles empty agent list (no error)
     - `applyLocalOverrides` works with corrupt JSON file (falls back to .md models)

**Steps:**
- [ ] Write failing tests for `applyLocalOverrides`
- [ ] Run `npx vitest run src/agents.test.ts`
  - Did tests fail with "function not exported"? If yes, proceed.
- [ ] Implement `applyLocalOverrides`, export it, add call sites in `discoverAgents` and `discoverAgentsAll`
- [ ] Run `npx vitest run src/agents.test.ts`
  - Did all tests pass? If not, fix and re-run.
- [ ] Run `npx tsc --noEmit` in `packages/subagent/`
  - Did it succeed? If not, fix type errors and re-run.
- [ ] Commit with message: "feat(subagent): apply agents.local.json model overrides in discovery"

**Acceptance criteria:**
- [ ] All tests pass
- [ ] `tsc --noEmit` passes
- [ ] `discoverAgents` applies JSON overrides after scope merging
- [ ] `discoverAgentsAll` applies JSON overrides to each scope array

---

### Task 3: Modify saveAgent in agent-manager.ts for JSON write

**Context:**
When an agent is saved via the Agents Manager TUI, the model must be written to `agents.local.json` (primary store) and **stripped** from the `.md` serialization. This happens in `saveAgent()` in `agent-manager.ts`. The model is captured before stripping, written to JSON via `writeLocalModel()`, and then `delete agent.model` is called so `serializeAgent()` omits the `model:` frontmatter line (note: `agent.model = undefined` is a TypeScript error under `exactOptionalPropertyTypes: true`, so `delete` must be used). On agent rename, the old JSON entry (keyed by the original agent name from `state.editOriginal?.name`) is deleted via `deleteLocalModel()` before writing the new one. If the model is cleared (undefined), `deleteLocalModel()` is also called to remove any stale JSON entry. After saving, `saveAgent()` re-discovers all agents via `discoverAgentsAll()`, which re-applies the JSON override — so the in-memory config and TUI display still show the correct model.

**Files:**
- Modify: `packages/subagent/src/agent-manager.ts`

**What to implement:**

1. Add import at top of file:
   ```ts
   import { writeLocalModel, deleteLocalModel } from "./local-config.js";
   ```

2. Inside the `try` block in `saveAgent()`, after `fs.mkdirSync(dir, { recursive: true })` and before `const content = serializeAgent(agent)`:
   - Capture the model: `const model = agent.model;`
   - Handle rename: use `state.editOriginal?.name` to get the original agent name; if it differs from `agent.name`, call `deleteLocalModel(state.editOriginal.name)`
   - If `model` is defined, call `writeLocalModel(agent.name, model)`
   - If `model` is undefined (e.g. user cleared it), call `deleteLocalModel(agent.name)` to remove any stale JSON entry
   - Call `delete agent.model` (NOT `agent.model = undefined`, which is a TypeScript error under `exactOptionalPropertyTypes: true`) to strip from `.md` serialization

3. **What NOT to change:**
   - Do not modify `serializeAgent()` in `frontmatter-io.ts` — the `if (config.model)` guard already skips when the model property is absent (deleted)
   - Do not add delete-on-agent-delete cleanup (orphan entries are harmless; can be added later)
   - Do not change the re-discovery logic (it already re-applies JSON overrides via `discoverAgentsAll`)

**Steps:**
- [ ] Add the import and the model capture/write/strip logic in `saveAgent()`
- [ ] Run `npx tsc --noEmit` in `packages/subagent/`
  - Did it succeed? If not, fix type errors and re-run.
- [ ] Manually verify with symlinked extensions: start pi, open `/agents`, create/edit an agent with a model, and confirm the model is written to `~/.pi/agent/agents.local.json` and NOT in the `.md` file
- [ ] Commit with message: "feat(subagent): write model to agents.local.json on save, strip from .md"

**Acceptance criteria:**
- [ ] `tsc --noEmit` passes
- [ ] Saving an agent with a model writes to `agents.local.json`
- [ ] The `.md` file does NOT contain a `model:` field after save
- [ ] Loading agents after save shows the correct model (from JSON override)
- [ ] Renaming an agent deletes the old JSON entry and creates a new one

---

## Verification Summary

After all tasks:
- Run `npx tsc --noEmit` in `packages/subagent/` — must pass
- Run `npx vitest run` in `packages/subagent/` — all tests must pass
- Verify backward compatibility: if `agents.local.json` doesn't exist, all behavior is identical to current
- Verify read priority: JSON model overrides `.md` model when both exist
