# Session Name Auto-Naming Plan

**Goal:** Automatically generate a concise session title after the first exchange using an LLM call.
**Architecture:** New `packages/session-name` extension that listens for `agent_end`, builds conversation context, calls the model via `ctx.modelRegistry.complete()`, and sets the session name via `pi.setSessionName()`. Silent operation — all failures are no-ops.
**Tech Stack:** TypeScript, pi extension API, `@pi-archimedes/core` settings helpers.
**Out of scope:** `/archimedes` settings UI integration (settings editable via `settings.json` only).

---

### Task 1: Create package skeleton

**Context:**
Create the new `packages/session-name` package with `package.json` and a minimal `src/index.ts` stub. This follows the exact same pattern as `packages/notify` (small single-purpose extension depending on core).

**Files:**
- Create: `packages/session-name/package.json`
- Create: `packages/session-name/tsconfig.json`
- Create: `packages/session-name/src/index.ts`

**What to implement:**

`packages/session-name/package.json`:
```json
{
  "name": "@pi-archimedes/session-name",
  "version": "2.0.1",
  "type": "module",
  "keywords": ["pi-package"],
  "description": "Auto-generate session names after the first exchange",
  "files": ["src"],
  "main": "./src/index.ts",
  "exports": {".": "./src/index.ts"},
  "dependencies": {
    "@pi-archimedes/core": "workspace:*"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": ">=0.1.0",
    "@earendil-works/pi-ai": ">=0.1.0"
  },
  "devDependencies": {
    "typescript": "^6.0.0"
  },
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

`packages/session-name/src/index.ts` — minimal stub that registers the extension:
```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // Auto-naming extension — implemented in Task 2-3
}
```

**Steps:**
- [ ] Create `packages/session-name/` directory
- [ ] Write `packages/session-name/package.json` with the content above
- [ ] Write `packages/session-name/tsconfig.json` (standard: extends root, outDir dist, rootDir src, include src)
- [ ] Write `packages/session-name/src/index.ts` with the stub above
- [ ] Run `npx tsc --noEmit` in `packages/session-name/`
  - Did it succeed? If not, fix and re-run.
- [ ] Run `pnpm install` in the root to register the workspace package
- [ ] Commit with message: "feat: add session-name package skeleton"

**Acceptance criteria:**
- [ ] `packages/session-name/package.json` exists with correct structure
- [ ] `packages/session-name/src/index.ts` exports default function accepting `ExtensionAPI`
- [ ] `npx tsc --noEmit` passes in `packages/session-name/`

---

### Task 2: Implement settings, model resolution, and extension registration

**Context:**
Add settings reading (using core's config helpers), model resolution (using the subagent's `findMatch` pattern), and register the `agent_end` and `session_start` event handlers. This is the infrastructure layer — no title generation yet.

**Files:**
- Modify: `packages/session-name/src/index.ts`

**What to implement:**

In `packages/session-name/src/index.ts`:

1. **Settings reading** — use `@pi-archimedes/core` config module. Read from `archimedes.sessionName` namespace in settings. Settings shape:
   ```typescript
   interface SessionNameSettings {
     enabled?: boolean;  // default true
     model?: string;     // default undefined (fallback to current model)
   }
   ```
   Read settings using `loadConfig` from `@pi-archimedes/core/settings-io` (same as notify package):
   ```typescript
   import { loadConfig } from "@pi-archimedes/core/settings-io";
   const settings = loadConfig("archimedes.sessionName", DEFAULT_SESSION_NAME_CONFIG);
   ```

2. **Model resolution** — implement `findMatch()` as a generic following the subagent's pattern from `packages/subagent/src/model-validation.ts`. Use the generic signature to preserve the `Model` type:
   ```typescript
   function findMatch<T extends { provider: string; id: string }>(
     ref: string,
     models: readonly T[]
   ): T | undefined {
     // Case-insensitive provider/id match, then bare id match (unique across providers)
     // Handle thinking-suffix tolerance (strip after last colon)
   }
   ```
   Do NOT copy the subagent file — implement it fresh following the same algorithm.

3. **Event handlers:**
   - `session_start`: reset `hasNamed = false` flag unconditionally (track in closure). Do not enumerate reasons — just reset on every `session_start`.
   - `agent_end`: check guards:
     - `enabled` from settings (default `true`)
     - `!hasNamed` (haven't named yet)
     - `!pi.getSessionName()` (session not already named via `--name` or `/name`)
     - `ctx.sessionManager.getSessionFile()` is not undefined (skip ephemeral sessions — `isPersisted()` is not on ReadonlySessionManager)
     - If all pass: proceed to title generation (Task 3), then set `hasNamed = true`

**Steps:**
- [ ] Read `packages/core/src/settings-io.ts` for `loadConfig` API
- [ ] Read `packages/notify/src/index.ts` to see how another package reads settings
- [ ] Implement settings reading in `packages/session-name/src/index.ts` using `loadConfig`
- [ ] Implement generic `findMatch<T>()` model resolution function
- [ ] Register `session_start` handler with `hasNamed` reset logic
- [ ] Register `agent_end` handler with guard checks
- [ ] Run `npx tsc --noEmit` in `packages/session-name/`
  - Did it succeed? If not, fix and re-run.
- [ ] Commit with message: "feat: implement session-name settings and model resolution"

**Acceptance criteria:**
- [ ] `loadConfig` reads from `archimedes.sessionName` namespace with correct defaults
- [ ] Generic `findMatch<T>()` preserves `Model` type from `getAll()`
- [ ] `session_start` resets `hasNamed` flag
- [ ] `agent_end` checks all guards before proceeding
- [ ] `npx tsc --noEmit` passes

---

### Task 3: Implement title generation and session naming

**Context:**
The core feature — build conversation text, make the LLM call, extract the title, and set the session name. Follows the pattern from pi's `summarize.ts` example for the model call.

**Files:**
- Modify: `packages/session-name/src/index.ts`

**What to implement:**

Inside the `agent_end` handler (after guards pass):

1. **Build conversation text** — extract user and assistant messages from `ctx.sessionManager.getBranch()`, same pattern as `summarize.ts` example:
   ```
   User: <first user message>
   Assistant: <first assistant response, truncated to ~500 chars>
   ```
   Only include the first exchange (one user message + one assistant message). Skip tool results, thinking, etc.

2. **Build title prompt:**
   ```
   Generate a concise title (3-8 words) for this conversation.
   The title should capture what the user is working on.
   Return only the title, nothing else.

   <conversation>
   {conversationText}
   </conversation>
   ```

3. **Resolve model:**
   - Try settings `model` string → `findMatch(settings.model, ctx.modelRegistry.getAll())`
   - Fall back to `ctx.model` if settings model not found or not configured
   - If no model available at all → silent skip

4. **Check auth:** `ctx.modelRegistry.hasConfiguredAuth(model)` → skip if false

5. **Make API call** using `ctx.modelRegistry.complete()`:
   ```typescript
   import { uuidv7 } from "@earendil-works/pi-ai";

   const response = await ctx.modelRegistry.complete(
     model,
     { messages: [{ role: "user", content: [{ type: "text", text: titlePrompt }], timestamp: Date.now() }] },
     { reasoningEffort: "minimal", cacheRetention: "none", sessionId: uuidv7() }
   );
   ```

6. **Extract and clean title:**
   - Join text content blocks
   - Trim whitespace
   - Strip surrounding quotes (single or double)
   - Cap at 80 characters
   - If empty after cleaning → silent skip

7. **Race guard:** Re-check `!pi.getSessionName()` immediately before calling `pi.setSessionName(title)` (user may have run `/name` during the LLM call)

8. **Set session name:** `pi.setSessionName(title)`

8. **Set flag:** `hasNamed = true` (regardless of success/failure — don't retry)

9. **Error handling:** Wrap the entire title generation in a try/catch. Any error → silent skip. Never notify the user.

**Steps:**
- [ ] Read pi's `examples/extensions/summarize.ts` for the model call pattern
- [ ] Implement conversation text extraction in `agent_end` handler
- [ ] Implement title prompt construction
- [ ] Implement model resolution with fallback chain
- [ ] Implement `ctx.modelRegistry.complete()` call with proper params
- [ ] Implement title extraction and cleaning
- [ ] Call `pi.setSessionName(title)` on success
- [ ] Wrap in try/catch with silent error handling
- [ ] Set `hasNamed = true` after attempt (success or failure)
- [ ] Run `npx tsc --noEmit` in `packages/session-name/`
  - Did it succeed? If not, fix and re-run.
- [ ] Commit with message: "feat: implement auto title generation"

**Acceptance criteria:**
- [ ] Conversation text includes first user + assistant exchange
- [ ] Model resolution: settings model → `ctx.model` fallback → skip
- [ ] API call uses `ctx.modelRegistry.complete()` with `uuidv7()` session
- [ ] Title is trimmed, quotes stripped, capped at 80 chars
- [ ] `pi.setSessionName(title)` called on success
- [ ] All errors caught silently
- [ ] `hasNamed` set after first attempt regardless of outcome
- [ ] `npx tsc --noEmit` passes

---

### Task 4: Wire into meta package and update documentation

**Context:**
Register the new package in the meta orchestrator so it loads when archimedes is installed, and update all documentation and CI references per AGENTS.md "Adding a New Package" checklist.

**Files:**
- Modify: `meta/package.json` — add dependency
- Modify: `meta/src/index.ts` — import and register
- Create: `packages/session-name/README.md` — package README
- Modify: `AGENTS.md` — update monorepo structure, counts, publish order
- Modify: `README.md` — add feature section, monorepo tree, install line, settings table
- Modify: `.github/workflows/release.yml` — add publish step
- Modify: `docs/plans/README.md` — add plan entry

**What to implement:**

1. **`meta/package.json`** — add to `dependencies`:
   ```json
   "@pi-archimedes/session-name": "workspace:*"
   ```

2. **`meta/src/index.ts`** — import the new package's entry alongside other packages. Read the file to see the exact pattern used.

3. **`packages/session-name/README.md`** — create a short package README following the notify package's format (feature description, install, settings table, back-link to root README).

4. **`AGENTS.md`** — update:
   - Monorepo Structure list: add `packages/session-name` with description
   - "Bump all N package versions" → increment count (9 → 10)
   - "N package directories" type-check count → increment
   - Publish order line: add session-name after core, before meta

5. **`README.md`** — update:
   - Feature section: add auto session naming description
   - Monorepo layout tree: add `session-name` under packages
   - "Install selectively" section: add `pi install npm:@pi-archimedes/session-name`
   - Settings table: add `archimedes.sessionName` entry

6. **`.github/workflows/release.yml`** — add publish step for `@pi-archimedes/session-name` after core and before meta in the dependency order.

7. **`docs/plans/README.md`** — add plan-021 entry to the Backlog table (or mark COMPLETED after merge).

**Steps:**
- [ ] Read `meta/package.json` and add session-name dependency
- [ ] Read `meta/src/index.ts` and add import/registration
- [ ] Create `packages/session-name/README.md` following notify's README format
- [ ] Update `AGENTS.md` monorepo structure, counts, and publish order
- [ ] Update `README.md` feature section, tree, install line, settings table
- [ ] Update `.github/workflows/release.yml` with publish step
- [ ] Update `docs/plans/README.md` with plan-021 entry
- [ ] Commit the plan file: `git add docs/plans/plan-021-session-name.md`
- [ ] Run `pnpm install` in root
- [ ] Run `npx tsc --noEmit` in `meta/`
  - Did it succeed? If not, fix and re-run.
- [ ] Commit with message: "chore: wire session-name into meta and update docs"

**Acceptance criteria:**
- [ ] `meta/package.json` includes `@pi-archimedes/session-name` dependency
- [ ] `meta/src/index.ts` imports and registers the new package
- [ ] `AGENTS.md` reflects new package in structure, counts, and publish order
- [ ] `packages/session-name/README.md` exists with feature description and settings
- [ ] `pi install npm:@pi-archimedes/session-name` listed in root README
- [ ] `docs/plans/README.md` includes plan-021 entry
- [ ] `.github/workflows/release.yml` includes session-name publish step
- [ ] `npx tsc --noEmit` passes in `meta/`

---

### Task 5: Verify and type-check all packages

**Context:**
Final verification pass — type-check all packages to ensure nothing is broken, following the AGENTS.md verification order.

**Files:**
- No file changes expected

**Steps:**
- [ ] Run `npx tsc --noEmit` in each package directory (core, session-name, ask, footer, diff, image-paste, notify, subagent, todo, meta) — 10 packages total
  - Did all pass? If not, fix and re-run.
- [ ] Run `pnpm install` in root one final time
- [ ] Verify the complete extension loads correctly by checking `meta/src/index.ts` imports resolve
- [ ] Commit any fixes with message: "fix: type-check fixes for session-name integration"

**Acceptance criteria:**
- [ ] `npx tsc --noEmit` passes in all 10 package directories
- [ ] No unresolved imports in `meta/src/index.ts`
