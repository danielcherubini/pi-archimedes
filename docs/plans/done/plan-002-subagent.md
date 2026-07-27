# Subagent Package Plan

**Goal:** Add `@pi-archimedes/subagent` — spawn child pi processes, stream live progress to a compact TUI, track costs via the bus.

**Architecture:** New npm workspace package in `packages/subagent/`. Registers a `subagent` tool with the pi extension API. Spawns child `pi --mode json` processes, parses JSON event lines from stdout, builds live progress, renders compact TUI with spinner + current tool + stats. Emits cost updates to `@pi-archimedes/core/bus` for footer accumulation. Supports sync (blocking) and async (fire-and-forget with file-based result watching) modes.

**Tech Stack:** TypeScript (ESM, no build step), npm workspaces, pi extension API, node child_process spawn.

**Source guidance:** Adapt patterns from pi-subagents (https://github.com/nicobailon/pi-subagents) for spawn logic and JSON streaming, but write clean from scratch — no attribution, no complexity inheritance.

---

### Task 1: Create Package Skeleton and Types

**Context:**
Set up the package structure, dependencies, and minimal type definitions. This is the foundation everything else builds on. Without this, the other tasks have nothing to import from.

**Files:**
- Create: `packages/subagent/package.json`
- Create: `packages/subagent/tsconfig.json`
- Create: `packages/subagent/src/types.ts`

**What to implement:**

1. **`packages/subagent/package.json`**:
```json
{
  "name": "@pi-archimedes/subagent",
  "version": "0.2.0",
  "type": "module",
  "keywords": ["pi-package"],
  "description": "Subagent dispatch with live TUI streaming and cost tracking",
  "files": ["src"],
  "main": "./src/index.ts",
  "dependencies": {
    "@pi-archimedes/core": "workspace:*"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": ">=0.1.0",
    "@earendil-works/pi-tui": ">=0.1.0"
  },
  "devDependencies": {
    "typescript": "^6.0.0"
  },
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

2. **`packages/subagent/tsconfig.json`** — extends root tsconfig:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

3. **`packages/subagent/src/types.ts`** — minimal type definitions:
```typescript
export interface SubagentUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  turns: number;
}

export interface SubagentProgress {
  agent: string;
  status: "running" | "completed" | "failed";
  task: string;
  currentTool?: string;
  currentToolArgs?: string;
  currentToolStartedAt?: number;
  toolCount: number;
  tokens: number;
  cost: number;
  durationMs: number;
  error?: string;
}

export interface SubagentResult {
  agent: string;
  task: string;
  exitCode: number;
  usage: SubagentUsage;
  finalOutput?: string;
  error?: string;
  progress?: SubagentProgress;
  progressSummary?: { toolCount: number; tokens: number; durationMs: number };
}

export interface SubagentToolResult {
  content: Array<{ type: "text"; text: string }>;
  details?: SubagentDetails;
  isError?: boolean;
}

export interface SubagentDetails {
  mode: "single" | "parallel";
  results: SubagentResult[];
  progress?: SubagentProgress[];
}

export interface SubagentParamsSchema {
  agent?: string;
  task: string;
  tasks?: Array<{ agent?: string; task: string; count?: number }>;
  model?: string;
  async?: boolean;
  context?: "fresh" | "fork";
  cwd?: string;
}
```

**Steps:**
- [ ] Create `packages/subagent/package.json` with workspace config
- [ ] Create `packages/subagent/tsconfig.json`
- [ ] Create `packages/subagent/src/types.ts` with all type definitions
- [ ] Run `pnpm install` at root to register the new workspace
- [ ] Run `cd packages/subagent && npx tsc --noEmit`
- [ ] Commit with message: "feat: add @pi-archimedes/subagent package skeleton"

**Acceptance criteria:**
- [ ] `pnpm install` succeeds with subagent in workspace
- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] All types export cleanly

---

### Task 2: Spawn and Stream

**Context:**
Core execution engine — resolves the pi CLI, spawns a child process in JSON mode, and parses the streaming JSON events from stdout. This is the heart of the package.

**Files:**
- Create: `packages/subagent/src/spawn.ts`
- Create: `packages/subagent/src/stream.ts`

**What to implement:**

1. **`packages/subagent/src/spawn.ts`** — resolve pi CLI and spawn child:
   - `resolvePiCommand(): { command: string; args: string[] }` — finds `pi` on PATH, handles Windows CLI script resolution
   - `spawnSubagent(options: { task: string; model?: string; cwd?: string; context?: "fresh" | "fork"; signal?: AbortSignal }): ChildProcess` — spawns `pi --mode json -p "<task>"` with appropriate env
   - Adapt from pi-subagents `pi-spawn.ts` but simplified — no intercom, no nested routing, no session dir complexity
   - Support abort signal for cancellation

2. **`packages/subagent/src/stream.ts`** — parse JSON event stream:
   - `streamEvents(child: ChildProcess, callbacks: { onProgress: (progress: SubagentProgress) => void; onDone: (result: SubagentResult) => void }): Promise<SubagentResult>` — reads stdout line-by-line, parses JSON events
   - Handles events: `tool_execution_start`, `tool_execution_end`, `message_end`, `turn_end`, `agent_end`
   - Builds SubagentProgress from events: tracks current tool, tool count, tokens, cost, duration
   - On process exit: assembles final SubagentResult
   - Handle stderr for errors, process exit codes
   - Graceful kill on abort signal (SIGTERM → wait 3s → SIGKILL)

**Steps:**
- [ ] Create `spawn.ts` with resolvePiCommand() and spawnSubagent()
- [ ] Create `stream.ts` with streamEvents() — parse JSON lines, build progress/result
- [ ] Run `cd packages/subagent && npx tsc --noEmit`
- [ ] Fix any type errors
- [ ] Commit with message: "feat: add subagent spawn and JSON streaming"

**Acceptance criteria:**
- [ ] `npx tsc --noEmit` passes
- [ ] spawn.ts exports resolvePiCommand() and spawnSubagent()
- [ ] stream.ts exports streamEvents() that returns Promise<SubagentResult>
- [ ] Progress tracks: currentTool, toolCount, tokens, cost, durationMs

---

### Task 3: Cost Tracking and Execute

**Context:**
Wires the stream output to cost emission on the bus, and provides the main execute function that orchestrates spawn → stream → result.

**Files:**
- Create: `packages/subagent/src/cost.ts`
- Create: `packages/subagent/src/execute.ts`

**What to implement:**

1. **`packages/subagent/src/cost.ts`** — emit cost updates to bus:
```typescript
import { getBus, Events } from "@pi-archimedes/core/bus";

export function emitCostUpdate(agent: string, usage: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; cost?: number }): void {
  getBus().emit(Events.COST_UPDATE, {
    source: `subagent:${agent}`,
    ...usage,
  });
}
```

2. **`packages/subagent/src/execute.ts`** — main sync execution:
```typescript
export interface ExecuteOptions {
  agent?: string;
  task: string;
  model?: string;
  cwd?: string;
  context?: "fresh" | "fork";
  signal?: AbortSignal;
  onUpdate?: (progress: SubagentProgress) => void;
}

export async function executeSubagent(options: ExecuteOptions): Promise<SubagentResult> {
  // 1. Spawn child process
  // 2. Stream events, build progress
  // 3. On each message_end: emit cost to bus
  // 4. Fire onUpdate callbacks with progress snapshots
  // 5. On exit: return final result
}

export async function executeParallel(options: { tasks: Array<{ agent?: string; task: string }>; onUpdate?: (progress: SubagentProgress[]) => void }): Promise<SubagentResult[]> {
  // Execute tasks concurrently, aggregate results
}
```

**Steps:**
- [ ] Create `cost.ts` with emitCostUpdate()
- [ ] Create `execute.ts` with executeSubagent() and executeParallel()
- [ ] Wire stream events → progress building → cost emission → onUpdate callbacks
- [ ] Run `cd packages/subagent && npx tsc --noEmit`
- [ ] Commit with message: "feat: add subagent execution with cost tracking"

**Acceptance criteria:**
- [ ] `npx tsc --noEmit` passes
- [ ] emitCostUpdate() emits to bus with `subagent:<agent>` source
- [ ] executeSubagent() returns SubagentResult with usage, output, progress
- [ ] executeParallel() runs tasks concurrently, returns array of results

---

### Task 4: Compact TUI Rendering

**Context:**
The key UX — compact live-updating display during execution, expanded detail on Ctrl+O. This is what makes subagents feel responsive and informative.

**Files:**
- Create: `packages/subagent/src/render.ts`

**What to implement:**

1. **`packages/subagent/src/render.ts`** — TUI rendering:

**Compact view (not expanded):**
```
⠙ agent-name  ·  ⟳ 3 · 2 tools · 14k tok · 12s · $0.0042
  ⎿  bash: grep -rn "TODO" src/ | 8s
```
When done:
```
✓ agent-name  ·  ⟳ 3 · 2 tools · 14k tok · 12s · $0.0042
  ⎿  Found 7 TODOs across 4 files
```

**Key functions:**
```typescript
export function renderSubagentResult(
  result: { content: Array<{ type: string; text?: string }>; details?: SubagentDetails; isError?: boolean },
  options: { expanded: boolean },
  theme: any,
  context: { expanded: boolean; isError: boolean; lastComponent: any; state: Record<string, unknown>; invalidate: () => void },
): Component;
```

**Animation:** The spinner animates via `context.state` storing a frame counter and `setInterval` calling `context.invalidate()` to trigger re-renders. The interval is stored in `context.state._subagentTimer` and cleared on completion or when expanded changes.

**Rendering rules:**
- Spinner frames: `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` (seeded by toolCount + tokens + duration for animation)
- Static glyph when not animating: `✓` (success), `✗` (error), `■` (interrupted)
- Stats line: `· ⟳ turns · tools · tokens · duration · cost` (omit zero values)
- Activity line: `⎿  <current_tool>: <args_preview> | <duration>` — ALWAYS show current tool, never just "active"
- When done: `⎿  <first line of output>` — show actual output, not "Done"
- **Never** show artifact/output paths in compact view
- Expanded view: agent, task, tool calls, full markdown output, usage breakdown

**Formatting helpers:**
```typescript
function formatTokens(n: number): string;     // 14k, 1.2M
function formatDuration(ms: number): string;   // 12s, 2m30s
function formatCost(cost: number): string;     // $0.0042
function truncLine(text: string, width: number): string;  // ANSI-aware truncation
```

**Steps:**
- [ ] Create `render.ts` with renderSubagentResult()
- [ ] Implement compact view: spinner + agent + stats + current tool line
- [ ] Implement done view: glyph + stats + first output line
- [ ] Implement expanded view: full details with markdown
- [ ] Implement parallel compact view: per-agent status lines
- [ ] Run `cd packages/subagent && npx tsc --noEmit`
- [ ] Commit with message: "feat: add compact TUI rendering for subagent results"

**Acceptance criteria:**
- [ ] `npx tsc --noEmit` passes
- [ ] Compact view shows: spinner, agent, stats, current tool (never just "active")
- [ ] Done view shows first line of output, not "Done"
- [ ] No artifact paths in compact view
- [ ] Expanded view shows full details with markdown output

---

### Task 5: Extension Entry Point

**Context:**
Wires everything together — registers the subagent tool, handles session lifecycle, connects streaming to TUI updates.

**Files:**
- Create: `packages/subagent/src/index.ts`

**What to implement:**

1. **`packages/subagent/src/index.ts`** — extension entry point:
```typescript
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Text, type Component } from "@earendil-works/pi-tui";
import { executeSubagent, executeParallel } from "./execute.js";
import { renderSubagentResult } from "./render.js";
import type { SubagentDetails, SubagentProgress, SubagentParamsSchema } from "./types.js";

export function registerSubagent(pi: ExtensionAPI): void {
  const tool: ToolDefinition<any, SubagentDetails> = {
    name: "subagent",
    description: "Delegate tasks to subagents. Single: { agent, task }. Parallel: { tasks: [{ agent, task }] }. Options: model, cwd, context (fresh|fork).",
    parameters: SubagentParamsSchema,
    execute(id, params, signal, onUpdate, ctx) {
      if (params.tasks) return executeParallel({ tasks: params.tasks, onUpdate });
      return executeSubagent({ ...params, signal, onUpdate });
    },
    renderCall(args, theme) { /* compact call label */ },
    renderResult(result, options, theme, context) {
      return renderSubagentResult(result, { expanded: context?.expanded ?? options?.expanded ?? false }, theme, context);
    },
  };

  pi.registerTool(tool);
}

export default function (pi: ExtensionAPI): void {
  registerSubagent(pi);
}
```

**Steps:**
- [ ] Create `index.ts` with tool registration and session lifecycle
- [ ] Wire execute → stream → render pipeline
- [ ] Wire async result watcher
- [ ] Add registerSubagent() export + default export
- [ ] Run `cd packages/subagent && npx tsc --noEmit`
- [ ] Run `pnpm install` at root
- [ ] Commit with message: "feat: wire subagent extension entry point"

**Acceptance criteria:**
- [ ] `npx tsc --noEmit` passes
- [ ] Tool registered as "subagent" with renderCall and renderResult
- [ ] Session start/stop manages result watcher lifecycle
- [ ] Exports registerSubagent() and default export

---

### Task 6: Wire Into Meta-Package

**Context:**
Integrate the subagent package into the pi-archimedes meta-package orchestrator so it loads when pi-archimedes is installed.

**Files:**
- Modify: `meta/package.json`
- Modify: `meta/src/index.ts`

**What to implement:**

1. **`meta/package.json`** — add dependency:
```json
"dependencies": {
  "@pi-archimedes/subagent": "workspace:*"
}
```

2. **`meta/src/index.ts`** — import and register:
```typescript
import { registerSubagent } from "@pi-archimedes/subagent";
// ... in orchestrator:
registerSubagent(pi);
```

**Steps:**
- [ ] Add @pi-archimedes/subagent to meta/package.json dependencies
- [ ] Import and call registerSubagent(pi) in meta/src/index.ts
- [ ] Run `pnpm install` at root
- [ ] Run `cd meta && npx tsc --noEmit`
- [ ] Run `cd packages/subagent && npx tsc --noEmit`
- [ ] Commit with message: "feat: wire @pi-archimedes/subagent into meta orchestrator"

**Acceptance criteria:**
- [ ] `npx tsc --noEmit` passes in both meta and subagent
- [ ] Meta package depends on @pi-archimedes/subagent
- [ ] registerSubagent(pi) called from meta orchestrator

---

### Notes

- **No tests:** This project uses TypeScript loaded via jiti by pi — verification is `tsc --noEmit` and manual testing.
- **No build step:** All packages use `"type": "module"` and `.ts` entry points.
- **Import convention:** Relative within package, package subpath exports cross-package.
- **Version:** All packages at `0.2.0` (matching current monorepo version).
- **No attribution:** Code is original, inspired by patterns from existing subagent implementations but written from scratch.
- **Deferred to follow-up:** Async execution (fire-and-forget with file watching) — cut from v1 to keep scope focused on sync streaming.
