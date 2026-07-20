# Lazy-load and Profile Startup Plan

**Goal:** Reduce `pi-archimedes` startup time by ~700ms (33% of module-import cost) by lazy-loading heavy packages, and add an internal profiler so future regressions are visible.

**Architecture:** Three layers of laziness — (1) `diff` and `image-paste`/`subagent` moved from static top-level imports in `meta/src/index.ts` to dynamic imports inside `session_start`; (2) `subagent`'s heaviest sub-modules (`execute.js`, `agent-manager.js`) further deferred to inside tool `execute()` callback and the `/agents` command handler; (3) all three dynamic imports fired in parallel via `Promise.all` so the longest one bounds the wait. A new `profiler.ts` in core tracks per-checkpoint elapsed time when `PI_TIMING=1` (reusing Pi's own env var) and prints at `session_shutdown`.

**Tech Stack:** TypeScript, jiti (lazy import works because jiti caches compiled modules per session), Pi ExtensionAPI.

---

## Background — Why this matters

Profiling with `PI_TIMING=1` showed `pi-archimedes` was the largest single contributor to Pi startup, accounting for 2271ms of the 4573ms `createAgentSessionRuntime` phase. All of that was in **module import** (jiti compiling TypeScript through the static `import` chain before the factory function even runs). Factory execution itself was 5ms. The 1455ms gap between `factory end` and `session_start` is **Pi's own TUI/runtime init** — out of our control.

The wins:

| Optimization | Time saved | When moved to |
|---|---|---|
| Lazy-load `diff` (skips shiki compile) | ~200ms | session_start |
| Lazy-load `image-paste` (skips clipboard.ts compile) | ~40ms | session_start |
| Lazy-load `subagent` (skips most subagent compile) | ~480ms | session_start |
| Split `subagent` `execute.js` (spawn/stream/cost/compact) | ~500ms | First subagent tool call |
| Split `subagent` `agent-manager.js` (1689-line TUI) | ~100ms | First `/agents` command |
| Parallel lazy-loads (Promise.all) | ~0ms total, but bounded by slowest | n/a |

Total module-import reduction: 2271ms → ~1550ms (32% faster).

---

### Task 1: Add internal profiler to `@pi-archimedes/core`

**Context:** Need a way to see per-checkpoint timings inside pi-archimedes itself, gated on the same `PI_TIMING=1` env var Pi uses. The profiler must be zero-cost when disabled (so we don't pay for it in normal sessions) and survive `/reload` (so timings from a fresh session don't accumulate with old ones).

**Files:**
- Create: `packages/core/src/profiler.ts`
- Modify: `packages/core/package.json` (add `./profiler` to `exports`)

**What to implement:**

`packages/core/src/profiler.ts` — three exports: `time(label)`, `reset()`, `print()`. Implementation:

```ts
const ENABLED = process.env.PI_TIMING === "1";

interface TimingState {
  baseline: number;
  entries: Array<{ label: string; ms: number }>;
}

const TIMINGS_KEY = Symbol.for("archimedes:timings");
declare const globalThis: typeof global & Record<typeof TIMINGS_KEY, TimingState>;

function getState(): TimingState {
  if (!globalThis[TIMINGS_KEY]) {
    globalThis[TIMINGS_KEY] = { baseline: Date.now(), entries: [] };
  }
  return globalThis[TIMINGS_KEY];
}

export function time(label: string): void {
  if (!ENABLED) return;
  const state = getState();
  state.entries.push({ label, ms: Date.now() - state.baseline });
}

export function reset(): void {
  if (!ENABLED) return;
  globalThis[TIMINGS_KEY] = { baseline: Date.now(), entries: [] };
}

export function print(): void {
  if (!ENABLED) return;
  const state = getState();
  if (state.entries.length === 0) return;

  let prevMs = 0;
  console.error("");
  for (const entry of state.entries) {
    const delta = entry.ms - prevMs;
    prevMs = entry.ms;
    console.error(`  archimedes: ${entry.label}: +${delta}ms (${entry.ms}ms cumulative)`);
  }
  console.error("".padEnd(60, "-"));
}
```

Key design points:
- State is stored on `globalThis` under a `Symbol.for` key so it survives `/reload` (which evaluates the module fresh but keeps the same globals).
- `time()` measures cumulative ms since `reset()` (not delta between calls) so the output is monotonic and easy to read.
- All three functions early-return when `PI_TIMING` is unset — no allocations, no string work in the hot path.

`packages/core/package.json` — add one line to the `exports` object:

```json
"./profiler": "./src/profiler.ts"
```

**Steps:**
- [ ] Create `packages/core/src/profiler.ts` with the three exports above
- [ ] Add `"./profiler": "./src/profiler.ts"` to `exports` in `packages/core/package.json`
- [ ] Run `pnpm exec tsc --noEmit` in `packages/core`
  - Did it succeed? (No type errors expected.)
- [ ] Commit with message: "feat(core): add startup profiler gated on PI_TIMING=1"

**Acceptance criteria:**
- `import { time, print, reset } from "@pi-archimedes/core/profiler"` resolves at runtime
- `time("x")` is a no-op when `PI_TIMING` is unset (no console output, no allocation if possible)
- Multiple calls accumulate in order, `print()` outputs `+Nms (Mms cumulative)` per entry

---

### Task 2: Split subagent's `execute.js` and `agent-manager.js` into lazy chunks

**Context:** Profiling showed `subagent` was 632ms of jiti compile time, almost entirely from `execute.js` (which transitively pulls in `spawn.js`, `stream.js`, `compact.js`, `cost.ts`) and `agent-manager.js` (1689-line TUI for the `/agents` command). But `execute()` only runs when the LLM actually calls the subagent tool, and `agent-manager.js` only runs when the user types `/agents`. So both can be loaded lazily at their actual call sites.

**Files:**
- Modify: `packages/subagent/src/index.ts`

**What to implement:**

Remove these two top-level static imports:

```ts
import { executeSubagent, executeParallel } from "./execute.js";
import { createAgentManager } from "./agent-manager.js";
```

(Keep `renderSubagentResult` from `./render.js` and `discoverAgents`, `findAgent` from `./agents.js` — those are used inside `renderResult` and the error path of `execute()`, so they're cheap and needed at registration time.)

Add a lazy import **inside the tool's `execute()` callback** (search for the line `const agents = discoverAgents(ctx.cwd);` inside the existing `execute` async function and insert the lazy import above it):

```ts
// Lazy-load executor (spawn/stream/cost) — only when tool is actually invoked
const { executeSubagent, executeParallel } = await import("./execute.js");
const agents = discoverAgents(ctx.cwd);
```

Add a lazy import **inside the `/agents` command handler** (replace the existing top of the `handler` function):

```ts
handler: async (_args: string, ctx: ExtensionCommandContext) => {
  // Lazy-load: 1689-line TUI component only needed when /agents is invoked
  const { createAgentManager } = await import("./agent-manager.js");
  const { discoverAgentsAll } = await import("./agents.js");
  const { global: globalAgents, user, project, globalDir, userDir, projectDir } = discoverAgentsAll(ctx.cwd);
  // ... rest unchanged
}
```

The `discoverAgentsAll` import is moved here too because it's only used by the `/agents` command — the `discoverAgents` import stays at the top for the tool's `execute()` error-path call to `findAgent(agents, ...)`.

**Steps:**
- [ ] Remove static `import { executeSubagent, executeParallel } from "./execute.js"` and `import { createAgentManager } from "./agent-manager.js"` from `packages/subagent/src/index.ts`
- [ ] Add `const { executeSubagent, executeParallel } = await import("./execute.js");` as the first line inside the tool's `execute()` async function
- [ ] Add `const { createAgentManager } = await import("./agent-manager.js");` and `const { discoverAgentsAll } = await import("./agents.js");` as the first two lines inside the `/agents` command handler
- [ ] Run `pnpm exec tsc --noEmit` in `packages/subagent`
  - Did it succeed?
- [ ] Run `PI_TIMING=1 pi` and verify:
  - `archimedes: subagent lazy-import:` line is now ~100-150ms (was ~500-630ms before this change)
  - No errors at startup
  - The `/agents` command still works (open it, list agents, close — no crash)
  - The `subagent` tool still works when the LLM calls it (verify the executor code path is reachable)
- [ ] Commit with message: "perf(subagent): lazy-load execute.js and agent-manager.js to defer heavy work to first use"

**Acceptance criteria:**
- `subagent` module import time drops from ~500-630ms to ~100-150ms
- Calling the subagent tool from the LLM still works (execute.js loads on demand, then gets cached by jiti for subsequent calls)
- `/agents` command still opens the Agents Manager TUI (agent-manager.js loads on demand)
- No new TypeScript errors

---

### Task 3: Restructure `meta/src/index.ts` with parallel lazy imports and profiler checkpoints

**Context:** The factory function in `meta/src/index.ts` currently imports all 8 packages at the top level, forcing jiti to compile all of them before the factory even runs. Most of them just call `register*` (synchronous, cheap) but the imports themselves trigger the full transitive compile. Moving the heaviest three (diff, image-paste, subagent) to dynamic `import()` inside `session_start` defers their compile to after the splash screen, and wrapping them in `Promise.all` makes the total wait bounded by the slowest single package instead of the sum.

**Files:**
- Modify: `meta/src/index.ts`

**What to implement:**

Replace the existing top-level imports:

```ts
// diff is lazy-loaded in session_start to avoid pulling @shikijs/cli at startup
import { registerImagePaste, initImagePasteSession, shutdownImagePaste } from "@pi-archimedes/image-paste";
import { registerSubagent, registerAgentsCommand } from "@pi-archimedes/subagent";
```

with:

```ts
// diff — lazy-loaded in session_start to avoid pulling @shikijs/cli at startup
// image-paste & subagent — also lazy-loaded below (heavy deps, only needed on use)
```

(`shutdownImagePaste` is no longer statically imported — it's now captured from the dynamic import result into a module-level ref.)

Add a module-level ref for the lazy shutdown (so `session_shutdown` can call it even if `session_start` never ran):

```ts
let imagePasteShutdown: (() => void) | undefined;
```

Add a module-level timestamp for gap analysis:

```ts
const _moduleEvalAt = Date.now();
```

Update the factory function body — remove the calls to `registerImagePaste`, `registerSubagent`, `registerAgentsCommand` (they're lazy now), and add profiler checkpoints around the remaining synchronous registrations:

```ts
export default function (pi: ExtensionAPI): void {
  archResetTimings();
  archTime(`factory start (module eval was ${Date.now() - _moduleEvalAt}ms ago)`);

  registerCore(pi);
  archTime("registerCore");
  registerFooter(pi);
  archTime("registerFooter");
  registerTodo(pi);
  archTime("registerTodo");
  registerAsk(pi);
  archTime("registerAsk");
  registerNotify(pi);
  archTime("registerNotify");

  archTime("factory end");

  // session_shutdown handler
  pi.on("session_shutdown", (_event, _ctx) => {
    imagePasteShutdown?.();
    unpatchConsoleLog();
    archPrintTimings();
  });

  // session_start handler — parallel lazy-load the 3 heavy packages
  pi.on("session_start", async (_event, ctx: ExtensionContext) => {
    archTime(`session_start (factory was ${Date.now() - _moduleEvalAt}ms ago)`);

    const [diffMod, ipMod, saMod] = await Promise.all([
      import("@pi-archimedes/diff").catch((e) => { console.error("[archimedes] diff load failed:", e); return null; }),
      import("@pi-archimedes/image-paste").catch((e) => { console.error("[archimedes] image-paste load failed:", e); return null; }),
      import("@pi-archimedes/subagent").catch((e) => { console.error("[archimedes] subagent load failed:", e); return null; }),
    ]);
    archTime("3 packages loaded in parallel");

    if (diffMod) {
      diffMod.registerDiffTools(pi, () => ctx.ui.theme, () => loadDiffConfig());
    }
    if (ipMod) {
      ipMod.registerImagePaste(pi);
      imagePasteShutdown = ipMod.shutdownImagePaste;
      ipMod.initImagePasteSession(ctx);
    }
    if (saMod) {
      saMod.registerSubagent(pi);
      saMod.registerAgentsCommand(pi);
    }
  });
}
```

Add the profiler import at the top:

```ts
import { time as archTime, print as archPrintTimings, reset as archResetTimings } from "@pi-archimedes/core/profiler";
```

**Steps:**
- [ ] Add `import { time as archTime, print as archPrintTimings, reset as archResetTimings } from "@pi-archimedes/core/profiler";` to the top of `meta/src/index.ts`
- [ ] Add `const _moduleEvalAt = Date.now();` and `let imagePasteShutdown: (() => void) | undefined;` after the imports
- [ ] Remove the static imports for `image-paste` and `subagent` (keep `diff` comment, drop the actual import statement)
- [ ] Restructure the factory body to add `archTime` checkpoints and remove the three lazy register calls
- [ ] Replace the `session_start` handler with the `Promise.all` version above
- [ ] Update the `session_shutdown` handler to use `imagePasteShutdown?.()` instead of calling the function directly
- [ ] Run `pnpm exec tsc --noEmit` in `meta`
  - Did it succeed?
- [ ] Run `PI_TIMING=1 pi` and verify:
  - No errors at startup
  - The `archimedes:` timing block prints at shutdown with all checkpoints
  - `pi-archimedes ... module import` time is ~1200-1500ms (was 2271ms before this plan)
  - `archimedes: 3 packages loaded in parallel:` is ~150-200ms
  - Splash screen still works (diff registerDiffTools registers the Edit/Write tool replacements)
  - Image paste still works (Ctrl+V or whatever shortcut was registered)
  - `/agents` command still works
- [ ] Run `pi` (without `PI_TIMING`) and verify:
  - Startup is noticeably faster (splash screen appears sooner)
  - No `archimedes:` lines printed
  - All features still work
- [ ] Commit with message: "perf(meta): lazy-load diff/image-paste/subagent in parallel and add profiler checkpoints"

**Acceptance criteria:**
- `pi-archimedes` module import time: **2271ms → ~1500ms** (verified via `PI_TIMING=1`)
- Session_start lazy-loads: ~150-200ms parallel (bounded by slowest package)
- No regressions: all tools, commands, and UI features still work
- Profiler output appears only when `PI_TIMING=1`
- TypeScript still type-checks clean across all 3 modified packages (core, subagent, meta)

---

## Verification — End-to-end

After all three tasks committed:

1. `PI_TIMING=1 pi` should show:
   - `pi-archimedes ... module import: ~1500ms` (was 2271ms)
   - `archimedes: 3 packages loaded in parallel: ~150-200ms`
   - `archimedes: factory end: ~3ms` (unchanged — factory was always fast)
   - `archimedes: session_start (factory was ~1500ms ago)` — confirms the gap is Pi's own work, not ours

2. `pi` (no env var) should:
   - Open faster (splash screen appears sooner)
   - All features work identically (diff highlighting, image paste, subagent tool, `/agents` command, todos, ask, notify)

3. `pnpm exec tsc --noEmit` in `packages/core`, `packages/subagent`, and `meta` — all clean.

4. `git diff --stat` should show:
   - `meta/src/index.ts` (~30-40 lines changed)
   - `packages/core/package.json` (+1 line)
   - `packages/subagent/src/index.ts` (~10 lines changed)
   - `packages/core/src/profiler.ts` (new file, ~50 lines)
