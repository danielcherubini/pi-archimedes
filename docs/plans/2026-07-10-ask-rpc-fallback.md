# Ask RPC Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@pi-archimedes/ask` show host-native question UI in Pi RPC clients while preserving its existing rich TUI and headless subagent behavior.

**Architecture:** Add a focused RPC question flow that translates Archimedes questions into Pi's supported `select` and `input` extension UI methods. Route only `ctx.mode === "rpc"` through that fallback; TUI continues to use the existing custom picker/tabs, and JSON/print subagents continue to use the existing socket bridge.

**Tech Stack:** TypeScript, Pi extension API, `@earendil-works/pi-coding-agent`, Vitest, pnpm.

## Global Constraints

- Users who do not install `@pi-archimedes/ask` are unaffected.
- Do not change Superconductor or require a Superconductor-specific protocol.
- Preserve the current TUI `ctx.ui.custom()` experience without visual or behavioral changes.
- Preserve the current headless `PI_SUBAGENT_SOCKET` request/response path.
- RPC multi-question flows may be sequential rather than tabbed.
- RPC multi-select must support toggling choices, an explicit Done action, cancellation, and Other text input.
- Do not add package dependencies.

---

### Task 1: RPC-native question flow

**Files:**
- Create: `packages/ask/src/rpc.ts`
- Create: `packages/ask/src/rpc.test.ts`
- Modify: `packages/ask/src/index.ts`

**Interfaces:**
- Consumes: `AskQuestion`, `AskSelection`, `appendRecommendedTagToOptionLabels()`, `buildSingleSelectionResult()`, `buildMultiSelectionResult()`, and `ExtensionUIContext`.
- Produces: `askQuestionsWithRpcUi(ui, questions): Promise<{ cancelled: boolean; selections: AskSelection[] }>`.
- Preserves: the existing `ask` tool schema and `buildAskSessionContent()` result format.

- [ ] **Step 1: Write failing RPC fallback tests**

Create `packages/ask/src/rpc.test.ts` with a queue-backed fake UI and these durable cases:

```ts
import { describe, expect, it } from "vitest";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { askQuestionsWithRpcUi } from "./rpc.js";
import type { AskQuestion } from "./selection.js";

function fakeUi(selectAnswers: Array<string | undefined>, inputAnswers: Array<string | undefined> = []) {
  const selectCalls: Array<{ title: string; options: string[] }> = [];
  const inputCalls: Array<{ title: string; placeholder?: string }> = [];
  const ui = {
    async select(title: string, options: string[]) {
      selectCalls.push({ title, options });
      return selectAnswers.shift();
    },
    async input(title: string, placeholder?: string) {
      inputCalls.push({ title, placeholder });
      return inputAnswers.shift();
    },
    async custom() {
      throw new Error("RPC fallback must not call custom()");
    },
  } as unknown as ExtensionUIContext;
  return { ui, selectCalls, inputCalls };
}

const single: AskQuestion = {
  id: "approach",
  question: "Which approach?",
  description: "Choose the safest option.",
  options: [{ label: "Minimal" }, { label: "Broad" }],
  recommended: 0,
};

describe("askQuestionsWithRpcUi", () => {
  it("returns a single native selection and preserves description context", async () => {
    const { ui, selectCalls } = fakeUi(["Minimal (Recommended)"]);
    const result = await askQuestionsWithRpcUi(ui, [single]);
    expect(result).toEqual({ cancelled: false, selections: [{ selectedOptions: ["Minimal"] }] });
    expect(selectCalls[0]?.title).toContain("Which approach?");
    expect(selectCalls[0]?.title).toContain("Choose the safest option.");
  });

  it("collects Other text through input", async () => {
    const { ui } = fakeUi(["Other (type your own)"], ["A custom answer"]);
    await expect(askQuestionsWithRpcUi(ui, [single])).resolves.toEqual({
      cancelled: false,
      selections: [{ selectedOptions: [], customInput: "A custom answer" }],
    });
  });

  it("returns aligned empty selections when a sequential flow is cancelled", async () => {
    const second = { ...single, id: "second", question: "Second?" };
    const { ui } = fakeUi(["Minimal (Recommended)", undefined]);
    await expect(askQuestionsWithRpcUi(ui, [single, second])).resolves.toEqual({
      cancelled: true,
      selections: [{ selectedOptions: ["Minimal"] }, { selectedOptions: [] }],
    });
  });

  it("toggles RPC multi-select options and finishes explicitly", async () => {
    const multi = { ...single, multi: true };
    const { ui } = fakeUi(["☐ Minimal (Recommended)", "☐ Broad", "✓ Done"]);
    await expect(askQuestionsWithRpcUi(ui, [multi])).resolves.toEqual({
      cancelled: false,
      selections: [{ selectedOptions: ["Minimal", "Broad"] }],
    });
  });

  it("collects Other text during RPC multi-select", async () => {
    const multi = { ...single, multi: true };
    const { ui } = fakeUi(["☐ Other (type your own)", "✓ Done"], ["Custom"]);
    await expect(askQuestionsWithRpcUi(ui, [multi])).resolves.toEqual({
      cancelled: false,
      selections: [{ selectedOptions: [], customInput: "Custom" }],
    });
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the missing-module failure**

Run:

```bash
cd packages/ask
corepack pnpm exec vitest run src/rpc.test.ts
```

Expected: FAIL because `./rpc.js` does not exist.

- [ ] **Step 3: Implement the minimal RPC flow**

Create `packages/ask/src/rpc.ts` with:

```ts
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import {
  OTHER_OPTION,
  appendRecommendedTagToOptionLabels,
  buildMultiSelectionResult,
  buildSingleSelectionResult,
  type AskQuestion,
  type AskSelection,
} from "./selection.js";

const DONE_OPTION = "✓ Done";

function questionTitle(question: AskQuestion): string {
  const description = question.description?.trim();
  return description ? `${question.question}\n\n${description}` : question.question;
}

async function askSingle(ui: ExtensionUIContext, question: AskQuestion): Promise<AskSelection | undefined> {
  const labels = appendRecommendedTagToOptionLabels(
    question.options.map((option) => option.label),
    question.recommended,
  );
  const selected = await ui.select(questionTitle(question), [...labels, OTHER_OPTION]);
  if (!selected) return undefined;
  if (selected !== OTHER_OPTION) return buildSingleSelectionResult(selected);
  const custom = await ui.input(question.question, "Type your answer");
  if (!custom?.trim()) return undefined;
  return buildSingleSelectionResult(OTHER_OPTION, custom);
}

async function askMulti(ui: ExtensionUIContext, question: AskQuestion): Promise<AskSelection | undefined> {
  const labels = [
    ...appendRecommendedTagToOptionLabels(
      question.options.map((option) => option.label),
      question.recommended,
    ),
    OTHER_OPTION,
  ];
  const otherIndex = labels.length - 1;
  const selected = new Set<number>();
  const notes = Array(labels.length).fill("") as string[];

  while (true) {
    const choices = labels.map((label, index) => `${selected.has(index) ? "☑" : "☐"} ${label}`);
    if (selected.size > 0) choices.unshift(DONE_OPTION);
    const choice = await ui.select(questionTitle(question), choices);
    if (!choice) return undefined;
    if (choice === DONE_OPTION) {
      return buildMultiSelectionResult(labels, [...selected], notes, otherIndex);
    }
    const index = choices.indexOf(choice) - (selected.size > 0 ? 1 : 0);
    if (index < 0 || index >= labels.length) continue;
    if (index === otherIndex) {
      const custom = await ui.input(question.question, "Type your answer");
      if (custom?.trim()) {
        notes[index] = custom;
        selected.add(index);
      }
      continue;
    }
    if (selected.has(index)) selected.delete(index);
    else selected.add(index);
  }
}

export async function askQuestionsWithRpcUi(
  ui: ExtensionUIContext,
  questions: AskQuestion[],
): Promise<{ cancelled: boolean; selections: AskSelection[] }> {
  const selections: AskSelection[] = [];
  for (const question of questions) {
    const selection = question.multi ? await askMulti(ui, question) : await askSingle(ui, question);
    if (!selection) {
      while (selections.length < questions.length) selections.push({ selectedOptions: [] });
      return { cancelled: true, selections };
    }
    selections.push(selection);
  }
  return { cancelled: false, selections };
}
```

If the exact `ExtensionUIContext.select()` option type in the installed Pi peer rejects `string[]`, retain the same behavior while using the repository's accepted option type; do not widen with `any`.

- [ ] **Step 4: Route only RPC contexts through the fallback**

In `packages/ask/src/index.ts`:

1. Import `askQuestionsWithRpcUi`.
2. Add a shared helper that receives an `ExtensionContext` and `AskQuestion[]`.
3. Return `askQuestionsWithRpcUi(ctx.ui, questions)` when `ctx.mode === "rpc"`.
4. Preserve the existing single-picker and tabbed TUI branches for every other UI mode.
5. Use the shared helper in both `handleAskRequest()` (subagent questions relayed to the parent) and the main `ask` tool execution.
6. Keep the existing `!ctx.hasUI` socket branch before the RPC/TUI flow.
7. Preserve one-question `AskToolDetails` fields (`id`, `question`, `options`, `selectedOptions`) and multi-question `results` output.

The helper shape should be:

```ts
async function collectSelections(
  ctx: ExtensionContext,
  questions: AskQuestion[],
): Promise<{ cancelled: boolean; selections: AskSelection[] }> {
  if (ctx.mode === "rpc") return askQuestionsWithRpcUi(ctx.ui, questions);
  if (questions.length === 1) {
    const question = questions[0]!;
    if (question.multi) return askQuestionsWithTabs(ctx.ui, questions);
    const selection = await askSingleQuestionWithInlineNote(ctx.ui, question);
    return {
      cancelled: selection.selectedOptions.length === 0 && !selection.customInput,
      selections: [selection],
    };
  }
  return askQuestionsWithTabs(ctx.ui, questions);
}
```

- [ ] **Step 5: Run focused tests and type-check the package**

Run independently:

```bash
cd packages/ask
corepack pnpm exec vitest run src/rpc.test.ts
npx tsc --noEmit
```

Expected: 5 tests pass; TypeScript exits 0.

- [ ] **Step 6: Run the full JavaScript test suite**

Run from the repository root:

```bash
corepack pnpm test
```

Expected: all existing 180 tests plus the new RPC tests pass.

- [ ] **Step 7: Commit the implementation**

```bash
git add packages/ask/src/index.ts packages/ask/src/rpc.ts packages/ask/src/rpc.test.ts
git commit -m "fix: support ask prompts in RPC clients"
```

---

### Task 2: Document compatibility and prepare the upstream PR

**Files:**
- Modify: `packages/ask/README.md`
- Modify: `docs/plans/README.md`
- Modify: `docs/plans/2026-07-10-ask-rpc-fallback.md`

**Interfaces:**
- Consumes: the RPC behavior delivered by Task 1.
- Produces: user-facing compatibility documentation and a reviewable pull request.

- [ ] **Step 1: Document RPC behavior and limitations**

Add a `## RPC clients` section to `packages/ask/README.md`:

```md
## RPC clients

In Pi RPC mode, `ask` uses Pi's standard extension UI protocol so embedding clients can render native question controls. Single-choice questions use `select`, custom answers use `input`, multiple questions are shown sequentially, and multi-select questions use a toggle-and-Done flow.

Interactive terminal sessions keep the richer tabbed interface with inline note editing. RPC mode does not provide the custom terminal component API, so ordinary-option inline notes are not available there.
```

- [ ] **Step 2: Verify docs and final diff**

Run:

```bash
git diff --check
git diff --stat upstream/main...HEAD
git status --short
```

Expected: no whitespace errors; only ask implementation/tests/docs and plan tracking files are changed.

- [ ] **Step 3: Mark the plan complete**

Move the plan's row in `docs/plans/README.md` from In Progress to Completed, update its status to `✅ COMPLETED`, and check every completed checkbox in this plan.

- [ ] **Step 4: Commit documentation**

```bash
git add packages/ask/README.md docs/plans/README.md docs/plans/2026-07-10-ask-rpc-fallback.md
git commit -m "docs: describe ask RPC fallback"
```

- [ ] **Step 5: Push and open the upstream PR**

```bash
git push -u origin fix/ask-rpc-fallback
gh pr create \
  --repo danielcherubini/pi-archimedes \
  --base main \
  --head haveanicedavid:fix/ask-rpc-fallback \
  --title "fix: support ask prompts in RPC clients" \
  --body $'## Summary\n- add an RPC-native select/input fallback for the ask tool\n- preserve the existing TUI and headless subagent paths\n- cover single, Other, sequential cancellation, and multi-select flows\n\n## Verification\n- `cd packages/ask && corepack pnpm exec vitest run src/rpc.test.ts`\n- `cd packages/ask && npx tsc --noEmit`\n- `corepack pnpm test`'
```

Expected: PR targets `danielcherubini/pi-archimedes:main` from `haveanicedavid:fix/ask-rpc-fallback`.

---

## Post-release local migration

After upstream merges and publishes a release containing this fallback:

1. Install global `npm:@pi-archimedes/ask` and `npm:@pi-archimedes/subagent`.
2. Remove `~/.pi/agent/extensions/subagent/` (the legacy bundled-example symlinks).
3. Remove the three legacy chain-only prompt symlinks under `~/.pi/agent/prompts/`.
4. Preserve all files under `~/.pi/agent/agents/` and unrelated packages/extensions.
5. Verify a terminal ask, a native-chat ask, and one subagent-to-parent ask before considering the migration complete.
