# Subagent agent→model mirror fix + agent discovery Plan

**Goal:** Stop the orchestrator from crashing subagent dispatch by mirroring the `agent` name into `model`, and give it a tool to discover available agents proactively.

**Architecture:** Three independent changes in `packages/subagent`: (1) honest `agent` parameter descriptions that stop dangling the literal string `"general"`; (2) a pre-spawn model validator that fails fast with a friendly error instead of spawning a doomed child `pi` process; (3) a new `list_agents` tool so the orchestrator can enumerate agents without relying on the human-only `/agents` slash command.

**Tech Stack:** TypeScript (jiti runtime, no build step), TypeBox schemas, vitest, pi Extension API (`@earendil-works/pi-coding-agent`).

---

## Background (read first — the executing agent has no conversation memory)

The `subagent` tool's `agent` parameter description currently says `"Agent name/identifier (optional, defaults to 'general')"`. This dangles the literal string `general` in front of the orchestrator LLM, which then copies it into BOTH `agent` and `model` when dispatching. Since the `general.md` agent file has no `model:` frontmatter field, `spawn.ts` resolves the effective model as `options.agent?.model ?? options.model` → `"general"`, and spawns a child `pi --model general` process. The child's model resolver (pi core's `resolveCliModel`) cannot find a model named `general`, prints `Model "general" not found. Use --list-models to see available models.` in red, and `exit(1)`. Result: a ~5 second, zero-token wasted spawn plus ~1.6k tokens of orchestrator self-diagnosis — recurring on the first subagent call of fresh sessions. This was verified in tama session `2026-07-28T08-52-12`: the orchestrator's own thinking block states verbatim *"I also specified model: \"general\" in my call."*

Key code facts the agent must know:
- The tool's `execute()` receives `ctx: ExtensionContext`. `ctx.modelRegistry` is a `ModelRegistry` (exported by `@earendil-works/pi-coding-agent`) with methods `getAll(): Model<Api>[]` (all known models), `getAvailable()` (authed subset), `find(provider, id)`, `hasConfiguredAuth(model)`.
- pi core exports `resolveCliModel` but it needs a `ModelRuntime`; `ModelRegistry` wraps a *private* `ModelRuntime`, so it cannot be reused directly. `findExactModelReferenceMatch` is NOT exported. Therefore we write a small local matcher that mirrors `findExactModelReferenceMatch`'s rules (read from pi core source): case-insensitive canonical `provider/id`, or case-insensitive bare `id` with ambiguous matches (≥2 providers sharing the id) rejected.
- The `AgentToolResult<T>` return shape requires a `details: T` field. Success omits `isError`; error sets `isError: true`. See the sibling `packages/todo/src/tool.ts` for the idiom.
- `ToolDefinition.renderCall`/`renderResult` are OPTIONAL — the new `list_agents` tool omits them and uses default text rendering.
- The subagent package is wired by `meta/src/index.ts` `session_start`, which calls `saMod.registerSubagent(pi)` (a named export). So a new tool registered *inside* `registerSubagent` is auto-wired — NO meta change is needed.

Verification commands (from repo root `/home/daniel/Coding/Javascript/pi-archimedes`):
- Type-check: `cd packages/subagent && pnpm exec tsc --noEmit`
- Tests: `npx vitest run packages/subagent` (scoped) or `pnpm test` (all projects)

---

### Task 1: `model-validation.ts` helper + tests

**Context:**
This is the core of P2. We validate the caller-supplied `model` string against the registry's known models BEFORE spawning a child process, so a bogus model (most often a mirrored agent name like `"general"`) fails fast with a friendly, actionable error instead of a raw child CLI crash. The helper is a pure function with no pi-runtime dependencies beyond the `ModelRegistry` type — it is fully unit-testable with a lightweight mock. It is a gate only: callers forward the ORIGINAL model string to `spawn.ts` unchanged (preserving any `:high` thinking suffix for the child's own resolver).

**Files:**
- Create: `packages/subagent/src/model-validation.ts`
- Test: `packages/subagent/src/model-validation.test.ts`

**What to implement:**

`packages/subagent/src/model-validation.ts` — exact contents:

```ts
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

export interface ValidateModelContext {
  /** Agent name the caller passed (used to detect the agent→model mirror footgun). */
  agentName?: string;
  /** File path of the agent config whose `model:` field is being validated. */
  agentFilePath?: string;
}

export type ValidateModelResult = { ok: true } | { ok: false; error: string };

/**
 * Find a model by reference, mirroring pi core's `findExactModelReferenceMatch`
 * rules (that function is not exported; rules read from pi core source):
 *   - canonical "provider/id" (case-insensitive), OR
 *   - bare "id" (case-insensitive); ambiguous (>=2 providers share the id) → no match.
 */
function findMatch<T extends { provider: string; id: string }>(
  ref: string,
  models: readonly T[],
): T | undefined {
  const lower = ref.toLowerCase();
  if (!lower) return undefined;
  // canonical provider/id
  const canonical = models.find((m) => `${m.provider}/${m.id}`.toLowerCase() === lower);
  if (canonical) return canonical;
  // bare id — must be unique across providers
  const idMatches = models.filter((m) => m.id.toLowerCase() === lower);
  return idMatches.length === 1 ? idMatches[0] : undefined;
}

/**
 * Validate that a model reference string resolves to a known model.
 *
 * Pure gate: returns `{ ok: true }` when valid (no resolved model object —
 * callers forward the ORIGINAL string to spawn.ts unchanged, preserving any
 * `:high` thinking suffix for the child's own resolver).
 *
 * Matching is against `registry.getAll()` (all known models — a pure
 * name-existence check; auth is deferred to the child, matching how the
 * child's `resolveCliModel` resolves against all models). Exact-match only;
 * fuzzy/alias patterns the child might accept are rejected here (acceptable —
 * `model` override is discouraged, so legitimate fuzzy usage is ~0).
 */
export function validateModel(
  model: string | undefined,
  registry: ModelRegistry,
  context: ValidateModelContext = {},
): ValidateModelResult {
  if (!model || !model.trim()) return { ok: true };
  const all = registry.getAll();
  if (all.length === 0) return { ok: true }; // unconfigured registry — defer to child

  const ref = model.trim();
  let matched = findMatch(ref, all);
  // Thinking-suffix tolerant: if the full string failed but it has a colon,
  // retry with the prefix before the last colon (handles "claude-sonnet-4-5:high").
  if (!matched && ref.includes(":")) {
    const prefix = ref.slice(0, ref.lastIndexOf(":"));
    if (prefix) matched = findMatch(prefix, all);
  }
  if (matched) return { ok: true };

  const sample = all.slice(0, 5).map((m) => `${m.provider}/${m.id}`).join(", ");
  const more = all.length > 5 ? `, … (${all.length} total)` : "";

  if (context.agentName && ref === context.agentName.trim()) {
    return {
      ok: false,
      error: `Model "${model}" not found — it looks like an agent name, not a model. Omit the model parameter; the agent's configured model or the parent's current model will be used. Available models include: ${sample}${more}.`,
    };
  }
  if (context.agentFilePath) {
    return {
      ok: false,
      error: `Agent "${context.agentName ?? "unknown"}" is configured with an invalid model "${model}" (in ${context.agentFilePath}). Fix the model field or agents.local.json. Available: ${sample}${more}.`,
    };
  }
  return {
    ok: false,
    error: `Model "${model}" not found. Available models include: ${sample}${more}.`,
  };
}

/** Return the first error message from the given results, or undefined if all ok. */
export function firstError(...results: ValidateModelResult[]): string | undefined {
  for (const r of results) {
    if (!r.ok) return r.error;
  }
  return undefined;
}
```

`packages/subagent/src/model-validation.test.ts` — exact contents:

```ts
import { describe, it, expect } from "vitest";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { validateModel, firstError } from "./model-validation.js";

function mockRegistry(models: Array<{ provider: string; id: string }>): ModelRegistry {
  return { getAll: () => models } as unknown as ModelRegistry;
}

const REGISTRY = mockRegistry([
  { provider: "anthropic", id: "claude-sonnet-4-5" },
  { provider: "openai", id: "gpt-5" },
  { provider: "openrouter", id: "claude-sonnet-4-5" }, // ambiguous bare id across providers
]);

describe("validateModel", () => {
  it("accepts a valid canonical provider/id", () => {
    expect(validateModel("anthropic/claude-sonnet-4-5", REGISTRY)).toEqual({ ok: true });
  });

  it("accepts case-insensitive provider/id", () => {
    expect(validateModel("Anthropic/Claude-Sonnet-4-5", REGISTRY)).toEqual({ ok: true });
  });

  it("accepts a valid unique bare id", () => {
    expect(validateModel("gpt-5", REGISTRY)).toEqual({ ok: true });
  });

  it("rejects an ambiguous bare id (>=2 providers)", () => {
    const r = validateModel("claude-sonnet-4-5", REGISTRY);
    expect(r.ok).toBe(false);
  });

  it("rejects an unknown string", () => {
    const r = validateModel("general", REGISTRY);
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("not found");
  });

  it("accepts a thinking suffix by matching the prefix", () => {
    expect(validateModel("gpt-5:high", REGISTRY)).toEqual({ ok: true });
  });

  it("accepts provider/id with a thinking suffix", () => {
    expect(validateModel("anthropic/claude-sonnet-4-5:high", REGISTRY)).toEqual({ ok: true });
  });

  it("returns ok for empty/undefined model", () => {
    expect(validateModel(undefined, REGISTRY)).toEqual({ ok: true });
    expect(validateModel("", REGISTRY)).toEqual({ ok: true });
    expect(validateModel("   ", REGISTRY)).toEqual({ ok: true });
  });

  it("returns ok when the registry is empty (defer to child)", () => {
    expect(validateModel("anything", mockRegistry([]))).toEqual({ ok: true });
  });

  it("emits the agent-name hint when model equals agentName", () => {
    const r = validateModel("general", REGISTRY, { agentName: "general" });
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("looks like an agent name");
  });

  it("emits the config-pointing message when agentFilePath is set", () => {
    const r = validateModel("bogus", REGISTRY, {
      agentName: "reviewer",
      agentFilePath: "/home/u/.agents/agents/reviewer.md",
    });
    expect(r.ok).toBe(false);
    const err = (r as { error: string }).error;
    expect(err).toContain("/home/u/.agents/agents/reviewer.md");
    expect(err).toContain("Fix the model field");
  });
});

describe("firstError", () => {
  it("returns undefined when all ok", () => {
    expect(firstError({ ok: true }, { ok: true })).toBeUndefined();
  });
  it("returns the first error string", () => {
    expect(firstError({ ok: true }, { ok: false, error: "boom" }, { ok: false, error: "later" })).toBe("boom");
  });
});
```

**Steps:**
- [ ] Create `packages/subagent/src/model-validation.test.ts` with the contents above.
- [ ] Run `npx vitest run packages/subagent` (from repo root).
  - Did the NEW `model-validation.test.ts` file fail to collect with `Cannot find module './model-validation.js'`? (The other existing test files still pass — only the new file should fail, because there is no implementation yet.) If the new file passed unexpectedly, stop and investigate why.
- [ ] Create `packages/subagent/src/model-validation.ts` with the contents above.
- [ ] Run `npx vitest run packages/subagent`.
  - Did all tests pass? If not, read the failures, fix the implementation, and re-run before continuing.
- [ ] Run `cd packages/subagent && pnpm exec tsc --noEmit`.
  - Did it succeed with no errors? If not, fix and re-run before continuing.
- [ ] Commit with message: `feat(subagent): add model reference validator`

**Acceptance criteria:**
- [ ] `validateModel` returns `{ ok: true }` for valid `provider/id`, unique bare `id`, `:high`-suffixed forms, and empty/undefined model.
- [ ] It returns `{ ok: false, error }` for unknown strings and ambiguous bare ids.
- [ ] The error message contains `"looks like an agent name"` when `model === context.agentName`, and contains the file path + `"Fix the model field"` when `context.agentFilePath` is set.
- [ ] `pnpm exec tsc --noEmit` passes in `packages/subagent`.

---

### Task 2: `formatAgentList` helper + test

**Context:**
P3 (the `list_agents` tool, Task 4) needs to render the discovered agents as readable text for the orchestrator. This pure helper formats an `AgentConfig[]` into a compact, standard-detail listing (name, source, description, and model/tools overrides only when set). It lives in `agents.ts` next to `discoverAgents` (which already returns `AgentConfig[]` with precedence `global < user < project` and `agents.local.json` overrides applied). Splitting it out makes it independently testable.

**Files:**
- Modify: `packages/subagent/src/agents.ts` (add `formatAgentList` export)
- Test: `packages/subagent/src/agents.test.ts` (append a new describe block)

**What to implement:**

Add to `packages/subagent/src/agents.ts` (after the existing `findAgent` function):

```ts
/**
 * Format discovered agents as a compact, readable listing for the `list_agents`
 * tool. Standard detail: name, source, description, and model/tools overrides
 * only when set.
 */
export function formatAgentList(agents: AgentConfig[]): string {
  if (agents.length === 0) {
    return "No agents configured. Create one in ~/.pi/agent/agents/ or .agents/agents/.";
  }
  const lines = agents.map((a) => {
    let line = `• ${a.name} [${a.source}] — ${a.description}`;
    const extras: string[] = [];
    if (a.model) extras.push(`model: ${a.model}`);
    if (a.tools && a.tools.length > 0) extras.push(`${a.tools.length} tools`);
    if (extras.length > 0) line += ` (${extras.join(", ")})`;
    return line;
  });
  return `${agents.length} agent${agents.length === 1 ? "" : "s"}:\n${lines.join("\n")}`;
}
```

Append to `packages/subagent/src/agents.test.ts`. First, merge `formatAgentList` into the existing value-import line (currently `import { applyLocalOverrides } from "./agents.js";`) so it reads:
```ts
import { applyLocalOverrides, formatAgentList } from "./agents.js";
```
The `import type { AgentConfig } from "./agents.js";` line already exists — do NOT re-add it. Then add this describe block at the end of the file:

```ts
function mkAgent(overrides: Partial<AgentConfig> & Pick<AgentConfig, "name">): AgentConfig {
  return {
    name: overrides.name,
    description: overrides.description ?? "desc",
    systemPrompt: overrides.systemPrompt ?? "prompt",
    source: overrides.source ?? "user",
    filePath: overrides.filePath ?? "/x.md",
    ...(overrides.model !== undefined ? { model: overrides.model } : {}),
    ...(overrides.tools !== undefined ? { tools: overrides.tools } : {}),
  };
}

describe("formatAgentList", () => {
  it("reports no agents when empty", () => {
    expect(formatAgentList([])).toContain("No agents configured");
  });

  it("formats a single agent (singular)", () => {
    const out = formatAgentList([mkAgent({ name: "general" })]);
    expect(out).toContain("1 agent:");
    expect(out).toContain("• general [user] — desc");
  });

  it("formats multiple agents (plural)", () => {
    const out = formatAgentList([mkAgent({ name: "general" }), mkAgent({ name: "explore" })]);
    expect(out).toContain("2 agents:");
  });

  it("includes model and tools overrides only when set", () => {
    const withExtras = formatAgentList([mkAgent({ name: "reviewer", model: "anthropic/claude-sonnet-4-5", tools: ["read", "bash"] })]);
    expect(withExtras).toContain("(model: anthropic/claude-sonnet-4-5, 2 tools)");
    const withoutExtras = formatAgentList([mkAgent({ name: "general" })]);
    expect(withoutExtras).not.toMatch(/\(model:|tools\)/);
  });
});
```

**Steps:**
- [ ] Add the `formatAgentList` import + describe block to `packages/subagent/src/agents.test.ts`.
- [ ] Run `npx vitest run packages/subagent`.
  - Did the new `formatAgentList` tests FAIL (function undefined / not exported)? If they passed, stop and investigate.
- [ ] Add `formatAgentList` to `packages/subagent/src/agents.ts`.
- [ ] Run `npx vitest run packages/subagent`.
  - Did all tests pass? If not, fix and re-run.
- [ ] Run `cd packages/subagent && pnpm exec tsc --noEmit`.
- [ ] Commit with message: `feat(subagent): add formatAgentList helper`

**Acceptance criteria:**
- [ ] Empty input → message containing `"No agents configured"`.
- [ ] One agent → `"1 agent:"`; multiple → `"N agents:"`.
- [ ] Model/tools overrides appear in parentheses only when set.
- [ ] `pnpm exec tsc --noEmit` passes in `packages/subagent`.

---

### Task 3: Wire validation into `execute()` + honest descriptions

**Context:**
This is the integration task (P1 + P2 wiring). It depends on Task 1's `validateModel`/`firstError`. It rewrites the misleading `agent` parameter descriptions (which dangle the literal `"general"` and invite the mirror), appends a `list_agents` pointer to the existing unknown-agent errors, and inserts pre-spawn model validation in BOTH single and parallel modes. For parallel mode, if ANY task's model or agent is invalid, the entire batch is aborted with a single tool result listing all errors (matching the existing parallel unknown-agent early-return pattern).

This task is pure integration — the testable unit logic lives in `model-validation.ts` (Task 1) and is already covered there. There is no pi-runtime test harness in this repo (all existing tests are pure functions), so verification here is `tsc --noEmit` plus the manual smoke test in the final acceptance.

**Files:**
- Modify: `packages/subagent/src/index.ts`

**What to implement:**

All edits are in `packages/subagent/src/index.ts`.

**(a) Add imports** — at the top, extend the existing `./agents.js` import and add the `./model-validation.js` import:
```ts
import { discoverAgents, discoverAgentsAll, findAgent, formatAgentList } from "./agents.js";
import { validateModel, firstError } from "./model-validation.js";
```

**(b) Rewrite descriptions** via targeted string-literal replacements (match the quoted strings, not whole lines — the surrounding indentation varies, so a verbatim line match would fail):
- Replace the string `"Agent name/identifier (optional, defaults to 'general')"` with `"Agent name (optional). If omitted, the subagent runs config-less — parent's current model, all tools, no system-prompt override. Call list_agents to see available agents."` (this is the `agent` field's description inside `SUBAGENT_PARAMS_SCHEMA`).
- Replace the string `"Delegate tasks to subagents. Provide either 'task' (single) or 'tasks' (parallel). Never omit both. Options: agent, model, cwd."` with `"Delegate tasks to subagents. Provide either 'task' (single) or 'tasks' (parallel). Agent is optional — omit for a config-less run with the parent's model and all tools. Model override is rarely needed; the agent config or parent model is used by default."` (this is the tool's top-level `description`).
- Give `TaskItem.agent` a description (it currently has none): change `agent: Type.Optional(Type.String()),` — the one inside `const TaskItem = Type.Object({ ... })` — to:
```ts
  agent: Type.Optional(Type.String({
    description: "Agent name for this task (optional). If omitted, runs config-less.",
  })),
```

**(c) Append `list_agents` pointer to the single-mode unknown-agent error.** In the single-mode `Unknown agent:` return, append `. Call list_agents for details.` immediately after `${available}` — i.e. inside the same template literal, before its closing backtick. Do NOT change any other part of that return statement (the `content: [{ type: "text", text: ... }],` structure stays as-is; there is no trailing comma after the backtick in the current file). (Leave the parallel unknown-agent error for replacement in step (e) below.)

**(d) Insert single-mode model validation.** Immediately AFTER the existing single-mode unknown-agent check (`if (params.agent && !agentConfig) { ... return ...; }`) and BEFORE `const result: SubagentResult = await executeSubagent(...)`, insert:
```ts
        // Pre-spawn model validation (P2): fail fast with a friendly error
        // instead of spawning a child that will crash on a bogus --model.
        const modelError = firstError(
          validateModel(params.model, ctx.modelRegistry, { agentName: params.agent }),
          validateModel(agentConfig?.model, ctx.modelRegistry, {
            agentName: params.agent,
            agentFilePath: agentConfig?.filePath,
          }),
        );
        if (modelError) {
          return {
            content: [{ type: "text", text: modelError }],
            details: { mode: "single", results: [], progress: undefined },
            isError: true,
          };
        }
```

**(e) Replace the parallel-mode pre-check** to collect unknown-agent AND model errors together. Replace the existing block:
```ts
        const missingAgents = params.tasks.filter((t) => t.agent && !findAgent(agents, t.agent));
        if (missingAgents.length > 0) {
          const available = agents.map((a) => a.name).join(", ") || "none";
          const unknown = missingAgents.map((t) => `"${t.agent}"`).join(", ");
          return {
            content: [{ type: "text", text: `Unknown agent(s): ${unknown}. Available: ${available}` }],
            details: {
              mode: "parallel",
              results: [],
              progress: undefined,
            },
            isError: true,
          };
        }
```
with:
```ts
        // Combined pre-spawn checks for parallel mode: unknown agents + invalid
        // models. If ANY task is invalid, abort the whole batch with a single
        // tool result listing all errors (no tasks spawn).
        const errors: string[] = [];
        const unknownAgents = params.tasks
          .filter((t) => t.agent && !findAgent(agents, t.agent!))
          .map((t) => `"${t.agent}"`);
        if (unknownAgents.length > 0) {
          const available = agents.map((a) => a.name).join(", ") || "none";
          errors.push(`Unknown agent(s): ${unknownAgents.join(", ")}. Available: ${available}. Call list_agents for details.`);
        }
        for (const t of params.tasks) {
          const taskAgentConfig = t.agent ? findAgent(agents, t.agent) : undefined;
          const me = firstError(
            validateModel(t.model, ctx.modelRegistry, { agentName: t.agent }),
            validateModel(taskAgentConfig?.model, ctx.modelRegistry, {
              agentName: t.agent,
              agentFilePath: taskAgentConfig?.filePath,
            }),
          );
          if (me) errors.push(me);
        }
        if (errors.length > 0) {
          return {
            content: [{ type: "text", text: errors.join("\n") }],
            details: {
              mode: "parallel",
              results: [],
              progress: undefined,
            },
            isError: true,
          };
        }
```
Do NOT change the subsequent `executeParallel(...)` call — it remains identical.

**What NOT to change:**
- Do NOT make `agent` schema-required (the dual-mode single/parallel shape needs it optional; omission → config-less run is intended).
- Do NOT change `spawn.ts` — it stays a pure spawner; `execute()` forwards the original model string unchanged.
- Do NOT change agent-omission semantics (config-less mode is preserved).
- Do NOT check model auth status — that is deferred to the child.

**Steps:**
- [ ] Apply edits (a)–(e) in `packages/subagent/src/index.ts`.
- [ ] Run `cd packages/subagent && pnpm exec tsc --noEmit`.
  - Did it succeed? If not, read errors, fix, re-run before continuing.
- [ ] Run `npx vitest run packages/subagent`.
  - Did existing tests still pass? (No new tests here — logic is in Task 1.) If anything broke, fix and re-run.
- [ ] Commit with message: `fix(subagent): validate model pre-spawn + honest agent description`

**Acceptance criteria:**
- [ ] `pnpm exec tsc --noEmit` passes in `packages/subagent`.
- [ ] All existing tests still pass.
- [ ] Manual smoke (see Task 4's final acceptance): dispatching with `model: "general"` returns a friendly error and spawns no child.

---

### Task 4: `list_agents` discovery tool

**Context:**
P3. The `/agents` slash command is human-only (`pi.registerCommand`); the orchestrator LLM cannot invoke slash commands — it only has *tools* (`pi.registerTool`). Today the orchestrator learns the agent roster only reactively, from an "Unknown agent" error after it already guessed wrong. This new `list_agents` tool gives proactive, zero-roundtrip discovery. It is registered inside `registerSubagent` (so `meta`'s existing `saMod.registerSubagent(pi)` call auto-wires it — NO meta change). It uses the existing `discoverAgents(ctx.cwd)` (precedence + local overrides already applied) and Task 2's `formatAgentList`.

**Files:**
- Modify: `packages/subagent/src/index.ts`

**What to implement:**

Add a new `registerListAgentsTool` function anywhere at top level in `packages/subagent/src/index.ts` (e.g. after the Helpers section, before `registerAgentsCommand`). Function declarations are hoisted, so placement does not affect the call below. Then call it as the **last statement inside `registerSubagent`'s body** — do NOT modify the default export.

> **Why inside `registerSubagent` (critical):** `meta/src/index.ts` wires subagent via its *named* exports only — it calls `saMod.registerSubagent(pi)` and `saMod.registerAgentsCommand(pi)` in `session_start`, and never calls the package's default export. A tool registered only via the default export would silently never load. Registering inside `registerSubagent` means `meta`'s existing call wires both tools with no meta change.

The tool registration (the `execute` params are deliberately unannotated — TypeScript infers them contextually from `ToolDefinition.execute`, avoiding a fragile `Record<string, never>` annotation):
```ts
export function registerListAgentsTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "list_agents",
    label: "Agents",
    description:
      "List available subagent configurations (name, description, source, model/tools overrides). Call before dispatching if unsure which agents exist or which fits the task.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const agents = discoverAgents(ctx.cwd);
      return {
        content: [{ type: "text" as const, text: formatAgentList(agents) }],
        details: { count: agents.length },
      };
    },
  });
}
```

And add this as the last line inside `registerSubagent` (just before its closing `}`):
```ts
  registerListAgentsTool(pi);
```

Leave the default export unchanged:
```ts
export default function (pi: ExtensionAPI): void {
  registerSubagent(pi);
}
```

Notes:
- `Type.Object({})` is a valid TypeBox empty-params schema — the LLM calls `list_agents` with `{}`.
- `renderCall`/`renderResult` are intentionally omitted (optional on `ToolDefinition`); default text rendering is sufficient for a simple list result.
- `discoverAgents` and `formatAgentList` are already imported (Task 3 step (a) added `formatAgentList`; `discoverAgents` was already imported).

**What NOT to change:**
- Do NOT modify `meta/src/index.ts` — `registerSubagent` is already called by `meta` and now registers both tools.
- Do NOT add `renderCall`/`renderResult` (default rendering is fine).

**Steps:**
- [ ] Add `registerListAgentsTool` (a top-level exported function) and call it as the last statement inside `registerSubagent` in `packages/subagent/src/index.ts`. Do NOT modify the default export.
- [ ] Run `cd packages/subagent && pnpm exec tsc --noEmit`.
  - Did it succeed? If not, fix and re-run.
- [ ] Run `npx vitest run packages/subagent`.
  - Did all tests still pass? If not, fix and re-run.
- [ ] Commit with message: `feat(subagent): add list_agents discovery tool`

**Acceptance criteria:**
- [ ] `pnpm exec tsc --noEmit` passes in `packages/subagent`.
- [ ] All tests pass.
- [ ] **Final manual smoke** (requires the local symlink): ensure `~/.pi/agent/extensions/pi-archimedes` symlinks to the repo root (`ln -sfn $(pwd) ~/.pi/agent/extensions/pi-archimedes` from repo root). Start pi. Then:
  - Dispatch a subagent with `agent: "general"` AND `model: "general"` → expect a friendly error mentioning "looks like an agent name", and NO child `pi` process spawned (no `Model "general" not found` crash).
  - Dispatch a subagent with `agent: "general"` and no `model` → expect a normal config-less/general run (no error).
  - Call the `list_agents` tool → expect a readable roster like `N agents:\n• general [user] — …`.

---

## Task dependency graph

- Task 1 (`model-validation.ts`) — no deps.
- Task 2 (`formatAgentList`) — no deps.
- Task 3 (wire validation + descriptions) — depends on Task 1.
- Task 4 (`list_agents` tool) — depends on Task 2 (and uses the `formatAgentList` import added in Task 3 step (a); if executing Task 4 before Task 3, also add that import).

Recommended order: 1 → 2 → 3 → 4. Each task is independently commitable.
