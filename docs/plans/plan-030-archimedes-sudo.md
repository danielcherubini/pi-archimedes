# Archimedes sudo — safe privileged execution Plan

**Goal:** Give agents a first-class, safety-focused `sudo` path: a dedicated `sudo_exec` tool that prompts for the password through Pi's masked interactive UI only, runs the privileged command via `sudo -S` (password on stdin — never argv, env, logs, or files), caches credentials strictly in memory scoped to the active session, and **actively blocks** agents from driving interactive `sudo` through the normal `bash` tool. Security is the primary requirement: no credential exposure, no user-confirmation bypass, and no way for a mixed command (e.g. `sudo -n true; sudo <command>`) to slip past the direct-`sudo` guard.

**Architecture:** A new workspace package `packages/sudo` (`@pi-archimedes/sudo`, namespace `archimedes.sudo`) registers one `sudo_exec` tool, one **active `tool_call` veto guard** on the built-in `bash` tool, one `/sudo forget` command, and one JSON config. Security-critical decisions on record in `docs/adr/0010-archimedes-sudo-security.md` (already existing — created in the spec session). The credential prompt reuses the ask/masked-UI precedent (`ctx.ui.custom`), **only** in the main session; headless (`ctx.mode !== "tui"`, e.g. subagent children or RPC) blocks with a clear error (child `sudo_exec` over a socket IPC bridge is explicitly deferred). Passwords live in an in-memory single-entry `CredentialCache` (a module object with an expiry timestamp) created per session, cleared on `session_shutdown` (top-level handler), on TTL expiry, on any auth failure, and on an explicit `/sudo forget` command; nothing is ever written to disk. Execution shells out to `sudo -S <command> <args>` with the password fed on stdin and auth state read back over stderr, with a timeout and `AbortSignal`. The direct-`sudo` guard is a pure, exhaustively-tested scanner (`isInteractiveSudoAttempt`) wired into pi's `tool_call` extension event, which (verified in the installed pi 0.84.x source — currently 0.84.3) can return `{ block: true }` to produce an immediate error result — the tool's `execute()` and shell `spawn` never run. `sudo -n` (cannot prompt) is always allowed.

**Tech Stack:** TypeScript, pi extension API (`TypeBox` via `typebox`, `ExtensionAPI`, `ctx.ui`, `pi.on("tool_call")`), `@pi-archimedes/core/settings-io` for config, `node:child_process` (`spawn`) for `sudo -S`, `node:abort-controller`/`AbortSignal` for timeouts, vitest, pnpm workspace. New runtime deps: `@pi-archimedes/core` (workspace). No new third-party runtime deps.

**Decisions on record:** `docs/adr/0010-archimedes-sudo-security.md` (active `tool_call` veto guard; unconditional block, no bypass; single-credential in-memory cache; password only via masked UI + stdin). `docs/adr/0011-plugin-manager.md` (single `archimedes.plugins` gate replaces per-package `enabled` — sudo is the first plugin in the manifest, no own `enabled` config). Out of scope (explicit): the `remote_sudo_exec` SSH variant (deferred — see Out of scope); getting the password through any non-masked path; persisting credentials to disk or the OS keyring; child/subagent `sudo_exec` support (headless blocks in v1); settings-panel UI (JSON config only); version bumps.

**Verification commands (used throughout):**
- `npx tsc --noEmit` in `packages/sudo` (AGENTS.md: run independently, wait for each)
- `npx vitest run` in `packages/sudo` (it gets a `vitest.config.ts`)
- Final task full gate: `npx tsc --noEmit` in all **12** dirs (core, ask, footer, diff, image-paste, notify, subagent, todo, session-name, mcp, **sudo**, meta) + `npx vitest run` in every package with a `vitest.config.ts`

---

### Task 1: New package scaffold + `sudo_exec` tool core

**Context:**
This repo has no `packages/sudo` yet. Task 1 both creates the package (per AGENTS.md "Adding a New Package" — a standalone-`pi install`-able extension is a release requirement) and implements the heart of the feature: the `sudo_exec` tool with its schema, the in-memory credential cache, the masked password prompt, and `sudo -S` execution with structured output. THE security fundamentals are set here: the password only ever travels to the `sudo` process via stdin, and it is only ever requested through the masked UI.

The package is named `packages/sudo`, exposed as `@pi-archimedes/sudo`. Justification: the extension registers exactly one tool (`sudo_exec`) whose entire contract is privileged execution; `sudo` is the shortest, unambiguous name that matches the feature and the sibling naming (`ask`, `notify`, `todo`). Namespace `archimedes.sudo` in `~/.pi/agent/settings.json` (like `archimedes.core`/`archimedes.mcp`). It needs a `peerDependencies` entry for `pi-tui` (for the masked editor component) and `pi-coding-agent` (for `ExtensionAPI`/`ctx`), and `devDependencies` for `typebox` and typescript (vitest lives at the repo root; `node:` builtins resolve transitively without `@types/node`, matching todo/ask).

**Context (prompt mechanics):**
Pi's interactive bridge is driven through `ctx.ui` (ask implements the precedent in `packages/ask/src/picker.ts` via `ui.custom((tui, theme, _keybindings, done) => ({focused, render, invalidate, handleInput}))`). `ctx.ui.input(title, placeholder, opts)` exists but has **no masking option** (`ExtensionUIDialogOptions` only has `timeout`), so a masked password field must be built as a `ui.custom(...)` component that captures keypresses, buffers chars, and renders `•` per typed character — the ask picker's pattern extended for a text field. In the main session this runs inline. In a headless session (`ctx.mode !== "tui"`, e.g. json/print mode, RPC, subagent children) there is no interactive surface — the tool must **block with a clear error** rather than prompt (child `sudo_exec` via a socket IPC bridge is explicitly deferred to a future plan). The tool must display the exact privileged command and the human-readable `reason` BEFORE acquiring credentials.

The tool name is `sudo_exec` (distinct from the raw `bash` tool's `sudo` command). Params: `command: string` (string preferred — the tool shells out exactly to `sudo -S <command>`; keep the schema string to avoid quoted-vector sanitization and let the model pin args directly); `reason: string` (required — the human-readable explanation rendered to the user before the prompt and logged in the result `details`); `timeoutMs?: number` (optional, default from config, applied via AbortSignal to the `spawn`). **No `password` param exists** — never accepted from the model; the password ONLY comes from the masked UI. **No `host` param** (YAGNI — the SSH variant is deferred).

**Files:**
- Create: `packages/sudo/package.json`
- Create: `packages/sudo/tsconfig.json` — mirror package type-check config pattern (read a sibling, e.g. `packages/notify/tsconfig.json` or `packages/todo/tsconfig.json`)
- Create: `packages/sudo/vitest.config.ts` — mirror sibling (`packages/todo/vitest.config.ts`)
- Create: `packages/sudo/src/index.ts` — `registerSudo(pi)`, session lifecycle, guard wiring, command; default export for standalone
- Create: `packages/sudo/src/tool.ts` — the `sudo_exec` tool definition, schema, `execute()`
- Create: `packages/sudo/src/argv-split.ts` — pure `splitCommandIntoArgv(command)` POSIX-ish argv splitter
- Create: `packages/sudo/src/argv-split.test.ts`
- Create: `packages/sudo/src/cache.ts` — `CredentialCache` (single in-memory entry, TTL)
- Create: `packages/sudo/src/prompt.ts` — masked password component + `promptForPassword(ctx)` (main-session-only; headless → error)
- Create: `packages/sudo/src/config.ts` — `loadSudoConfig()`/`saveSudoConfig()`
- Create: `packages/sudo/src/tool.test.ts`, `cache.test.ts`, `prompt.test.ts`, `config.test.ts`

**What to implement:**

`packages/sudo/package.json`:
```json
{
  "name": "@pi-archimedes/sudo",
  "version": "2.3.0",
  "type": "module",
  "keywords": ["pi-package"],
  "description": "Safe privileged execution for pi — sudo_exec tool with masked password prompt and bash-sudo guard",
  "files": ["src"],
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./guard": "./src/guard.ts"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": ">=0.1.0",
    "@earendil-works/pi-tui": ">=0.1.0",
    "typebox": ">=1.1.0"
  },
  "devDependencies": {
    "@earendil-works/pi-coding-agent": "^0.84.2",
    "@earendil-works/pi-tui": "^0.84.2",
    "typebox": "^1.1.38",
    "typescript": "^6.0.0"
  },
  "dependencies": {
    "@pi-archimedes/core": "workspace:*"
  },
  "pi": { "extensions": ["./src/index.ts"] }
}
```
(Version must match the shared monorepo version — read `packages/core/package.json` for the current one and use it. `pnpm install` at the repo root after creating.)

`packages/sudo/src/cache.ts` — the in-memory credential cache:
```ts
export interface CachedCredential { password: string; expiresAt: number; }
export class CredentialCache {
  private entry: CachedCredential | null = null;
  set(password: string, ttlMs: number): void;   // entry = { password, expiresAt: Date.now() + ttlMs }
  get(): CachedCredential | null;               // returns entry if now < expiresAt AND entry set; else null (does NOT auto-clear)
  clear(): void;                                // entry = null
  get isExpired(): boolean;                     // entry !== null && now >= expiresAt
}
```
- The cache is a class with an expiry check — expired entries return `null` (re-prompt), and are cleared by `clear()` (session_shutdown / forget / auth-failure). No host/user keying in v1.
- Module-level singleton `export const credentialCache = new CredentialCache();` (recreated per session via `clear()` on `session_start` — see Task 3 lifecycle; the class itself is unit-testable).

`packages/sudo/src/config.ts`:
```ts
import { loadConfig, saveConfig } from "@pi-archimedes/core/settings-io";
export interface SudoConfig {
  ttlMs: number;             // default 900000 (15 min) — password cache TTL
  defaultTimeoutMs: number;  // default 120000 — sudo_exec default timeout
}
export const DEFAULT_SUDO_CONFIG: SudoConfig = { ttlMs: 900000, defaultTimeoutMs: 120000 };
export function loadSudoConfig(): SudoConfig { return loadConfig("archimedes.sudo", DEFAULT_SUDO_CONFIG); }
export function saveSudoConfig(config: SudoConfig): void { saveConfig("archimedes.sudo", config); }
```

`packages/sudo/src/prompt.ts` — masked input (main session only):
- `prompt.ts` mode gate: gate on `ctx.mode === "tui"` (precise — `hasUI` is true in TUI AND RPC modes; pi's d.ts comment says "Use 'tui' to guard terminal-only UI such as custom components"). `promptForPassword` throws when `ctx.mode !== "tui"` (covers headless json/print AND RPC; subagent children are non-TUI).
- Build a masked input component via `ctx.ui.custom<string>((tui, theme, keybindings, done) => { ... })` — mirrors `packages/ask/src/picker.ts` (`ui.custom<InlineSelectionResult>(...)`).
- The component: holds a `buffer: string`, `handleInput` captures printable chars (append), Backspace (drop last), Enter (done(buffer)), Esc (done("") + cancel); `render(width)` returns lines showing the label (the exact command + reason), a `•`.repeat(buffer.length) masked line (NOT the raw chars), and a hint line (`Enter` confirm / `Esc` cancel / `Backspace` delete). Focused=true. Cleanup disposables on done.
- `export async function confirmCommand(ctx, command, reason): Promise<boolean>` — optional confirmation display before prompting; renders the exact command + reason and asks the user to confirm the command is intended (the issue requires "Display the exact privileged command and a human-readable reason before requesting credentials" — this is that display; a confirm dialog is the natural way to make it a hard gate before any credential prompt). If the user declines, return false → the tool errors "command not confirmed" without prompting for a password.
- The password never appears in the rendered output, the result, the log, or anywhere except the `CredentialCache` and the `sudo` stdin pipe.

`packages/sudo/src/tool.ts` — the `sudo_exec` tool:
```ts
const SudoExecParamsSchema = Type.Object({
  command: Type.String({ description: "Exact command and arguments to run with elevated privileges, e.g. \"apt install ripgrep\". Do NOT include a leading 'sudo'. Executed directly via argv — no shell: avoid pipes, redirects, &&, env assignments, or quotes-as-syntax; pass multiple args space-separated, quote only literal args." }),
  reason: Type.String({ description: "Human-readable explanation of why this privileged command is needed, shown to the user before execution." }),
  timeoutMs: Type.Optional(Type.Number({ description: "Optional timeout in milliseconds (default from config)." })),
});
```
- Register via `pi.registerTool({ name: "sudo_exec", label: "sudo", description: "Run a command with elevated privileges; prompts for the password through the masked UI and never exposes it. Use instead of interactive sudo in bash.", parameters: SudoExecParamsSchema, execute, renderCall?, renderResult? })`. `renderCall`/`renderResult` are optional — pi uses the built-in rendering for omitted slots (see pi docs "Renderer inheritance").
- `execute` MUST use pi's exact 5-arg signature (match `packages/ask/src/tool.ts:209`):
  ```ts
  async execute(
    toolCallId: string,
    params: SudoExecInput,             // Static<typeof SudoExecParamsSchema>
    signal: AbortSignal | undefined,
    _onUpdate: undefined,
    ctx: ExtensionContext,
  ): Promise<...> {
  ```
  Body references: `params.command`, `params.reason`, `params.timeoutMs` (NOT `args.*`). The timeout uses pi's supplied `signal` (`signal?.aborted`) PLUS an own `setTimeout(() => child.kill("SIGKILL"), timeoutMs)`; clearTimeout on exit and also kill on `signal` abort (see niche 17).
- **CRITICAL — result shaping convention:** `execute` must NOT declare a return-type annotation (or must return through a type that allows `isError`). pi reads `executed.isError` at runtime though `AgentToolResult` omits it; todo/mcp compile because their `execute` methods have no return annotation and the inferred union escapes fresh-literal excess-property checking. Declare the `details` type separately (e.g. `interface SudoExecDetails { command: string; reason: string; exitCode: number; stdout: string; stderr: string; error?: string }`) and return `{ content, details, isError }` objects like `packages/todo/src/tool.ts` does. Annotating `execute: Promise<AgentToolResult<SudoDetails>>` and returning `isError` fails TS2353 — do NOT do that.
- `execute(body)`: 
  1. `const config = loadSudoConfig();` (no `enabled` check — enable/disable is the plugin gate: `archimedes.plugins.sudo` in meta's `/plugins` manager skips `registerSudo` entirely when disabled, so `execute` never runs. See ADR 0011.)
  2. `const command = params.command.trim(); if (!command) → validation error.` `const reason = params.reason.trim();`
  3. If `ctx.mode !== "tui"` → headless block: return `{ content: [{type:"text",text:"sudo_exec requires an interactive session — run privileged commands from the main session"}], isError: true, details: { reason } }`. (Deferred-child decision — uses the same gate as `promptForPassword`.)
  4. `const confirmed = await confirmCommand(ctx, command, reason); if (!confirmed) → error "command not confirmed".`
  5. `let cached = credentialCache.get(); if (!cached) { const password = await promptForPassword(ctx); if (!password) → error "password entry cancelled"; credentialCache.set(password, config.ttlMs); cached = credentialCache.get()!; }`
  6. Execute: `const child = spawn("sudo", ["-S", ...command.split(/\s+/)])` — WAIT: this naive split would break quoted args. Use a proper argv splitter OR require the model to pass `command` as a single string that we intentionally do NOT shell-split but instead pass as `sudo -S <command>` via `spawn("sudo", ["-S", "-b"?...])`. Decide: **use `spawn("sudo", ["-S", ...splitCommandIntoArgv(command)])` where `splitCommandIntoArgv` is a small POSIX-ish shell-word splitter implemented in-package (NOT `shell-quote` lib — no new deps).** It must handle single/double quotes and backslash escapes. This is critical: the password goes on stdin, and `sudo -S <command>` must receive the command as proper argv, NOT as a shell string. Add `splitCommandIntoArgv(command)` as a pure exported function in `packages/sudo/src/argv-split.ts` with tests.
  7. Write the password + `\n` to `child.stdin`, end stdin. Read stdout + stderr accumulate. **Watch stderr for the match:** if stderr contains `\[sudo\] password for` → auth-prompt detected (normal — proc height); if stderr contains `/incorrect password/` or `3 incorrect password attempts` → **auth failure** → `credentialCache.clear()` + fail with a clear error.
  8. Timeout: `const t = setTimeout(() => child.kill("SIGKILL"), timeoutMs)` (from `params.timeoutMs ?? config.defaultTimeoutMs`); **`clearTimeout(t)` in the exit handler** (avoid a leaked timer on long-running commands) and also `child.kill` when `signal?.aborted` fires. `spawn` reverso: read stdout+stderr accumulators, end stdin after writing the password.
  9. Result: `finish({ content: [{ type: "text", text: stdout }], details: { command, reason, exitCode, stdout, stderr: scrub(stderr) }, isError: exitCode !== 0 })` — `scrub` strips any line containing the password (belt-and-braces; the password never appears in argv so stderr is normally clean, but scrub defensively).
- No `password` param. No `host` param. `prepareArguments` NOT used (this tool needs no repair layer).

`packages/sudo/src/index.ts` — registration + lifecycle + default export:
- `export function registerSudo(pi: ExtensionAPI): void` — wires Task 2's guard + Task 3's lifecycle; **for Task 1 it ONLY registers the tool + default export** (`pi.registerTool(...)`, nothing else). The `/sudo` command, `session_start`/`session_shutdown` lifecycle, and guard wiring land in Tasks 2–3 (see "Do NOT change").
- `export default function (pi: ExtensionAPI): void { registerSudo(pi); }` — standalone entry (pi's loader requires a default export; see the image-paste fix precedent `packages/image-paste/src/index.ts`).

**Tests (write failing FIRST):**
- `cache.test.ts`: set/get within TTL; expiry → `get()` returns null; `clear()`; `isExpired` transitions.
- `argv-split.test.ts`: `splitCommandIntoArgv` — simple words, single quotes, double quotes with spaces, backslash escapes, empty-string handling.
- `config.test.ts`: defaults; load merge with partial JSON.
- `config.test.ts`: `vi.mock("@pi-archimedes/core/settings-io", ...)` FIRST (before importing `loadSudoConfig`) — `loadSudoConfig()` reads the real `~/.pi/agent/settings.json` (core's own `config.test.ts` mocks it; mcp tests note settings-io builds its path at module load). Without the mock, tests are non-deterministic and `saveConfig` writes to the user's real settings file.
- `prompt.test.ts`: the MASK test must be a pure helper — extract `maskLine(buffer: string): string` returning `"•".repeat(buffer.length)` and unit-test that (a full `ui.custom` render test needs a real TUI mock, too heavy). Keep the component test scope to: `promptForPassword` throws when `ctx.mode !== "tui"` (headless block), cancellation semantics.
- `tool.test.ts`: `execute` with `ctx.mode !== "tui"` → isError "interactive session"; disabled config → isError; invalid command → error; `splitCommandIntoArgv` used correctly.

**Steps:**
- [ ] Create `packages/sudo/package.json` + `tsconfig.json` + `vitest.config.ts` (mirror sibling packages). Run `pnpm install` at repo root (links workspace dep to core).
- [ ] Write failing tests first (cache, argv-split, config, prompt-headless, tool-headless).
- [ ] Run `cd packages/sudo && npx vitest run` — expect FAIL (no implementation yet).
- [ ] Implement `cache.ts`, `config.ts`, `argv-split.ts`, `prompt.ts`, `tool.ts`, `index.ts` (Task 1 scope ONLY: `registerSudo` registers the `sudo_exec` tool + the default export; guard wiring is Task 2, `/sudo` + lifecycle are Task 3).
- [ ] Run `cd packages/sudo && npx vitest run` — all pass.
- [ ] Run `cd packages/sudo && npx tsc --noEmit` — green.
- [ ] Commit: `feat(sudo): sudo_exec tool — masked password prompt, in-memory cache, sudo -S exec`

**Acceptance criteria:**
- [ ] `sudo_exec` registered with schema `{command, reason (required), timeoutMs?}`; NO `password`/`host` params.
- [ ] Password only travels masked-UI → `CredentialCache` → `sudo` stdin; never argv/env/logs/files; no `password` schema param.
- [ ] Headless (`ctx.mode !== "tui"`) → clear error, no prompt (deferred-child behavior).
- [ ] Auth failure on stderr (`incorrect password`) → cache cleared + `isError: true` result.
- [ ] `splitCommandIntoArgv` correctly splits quoted/escaped commands (tested).
- [ ] `npx tsc --noEmit` green in `packages/sudo`; `npx vitest run` green; single commit.

**Do NOT change:** the guard (Task 2), session lifecycle (Task 3), meta/release/README wiring (Task 3). Enable/disable is NOT this package's concern (single plugin gate in meta, ADR 0011, plan-031). Version number must match the monorepo (read core's package.json).

---

### Task 2: bash-sudo guard — active `tool_call` veto

**Context:**
Even with `sudo_exec` available, agents will still try to call `sudo` directly from the `bash` tool. Direct `sudo` in a non-interactive agent shell hangs at the prompt or, worse, the agent passes a password as an argument (leak into argv/ps/logs) or feeds a non-`-n` `sudo` interactively. This task adds the guard.

**Research finding (verified in the INSTALLED pi source on disk — currently 0.84.3; re-verify against your installed `node_modules/@earendil-works/pi-coding-agent` if it differs, since this is a security-critical veto surface):** pi exposes `pi.on("tool_call")`, an extension event fired AFTER `tool_execution_start` but BEFORE the tool's `execute()`; returning `{ block: true, reason?: string }` (type `ToolCallEventResult`) produces an immediate error tool result — **the `bash` tool's `execute()` and the shell `spawn` never run** (`@earendil-works/pi-agent-core/dist/agent-loop.js` `prepareToolCall` → `if (beforeResult?.block) return createErrorToolResult(...)`, `kind: "immediate"`; `dist/core/extensions/runner.js` `emitToolCall` short-circuits on first `{block:true}`; installed `examples/extensions/permission-gate.ts` is exactly this pattern for sudo). The earlier draft plan considered consuming the `tool_execution_start` **bus event** — that surface is observational only (its handler return is ignored), so it cannot stop execution. **The guard MUST use `pi.on("tool_call")`.**

Where it lives: in the `sudo` package itself (`packages/sudo/src/guard.ts`), not a separate hook package. All archimedes packages are composed by `meta`; a separate package would add a dependency edge and a release step for one `isInteractiveSudoAttempt` function. In `registerSudo`, subscribe `pi.on("tool_call", handler)` with the scanner.

**Files:**
- Create: `packages/sudo/src/guard.ts` — pure scanner: `isInteractiveSudoAttempt(command: string): GuardResult`
- Create: `packages/sudo/src/guard.test.ts` — exhaustive token/lookahead cases
- Modify: `packages/sudo/src/index.ts` — wire the `tool_call` veto handler in `registerSudo`
- Modify: `packages/sudo/src/index.test.ts` (or guard.test.ts integration) — guard-wired case

**What to implement:**

Detection strategy (tokenize + lookahead): `isInteractiveSudoAttempt` MUST NOT reason about the raw string with a naive `includes("sudo")` (that misses `FOO=sudo` env-prefixed tokens and would false-positive on `sudo` in comments/heredocs thus wrongly blocking `sudo -n` in comments). Instead:
1. Strip Bash comments: remove from every `#` that begins a word boundary (a `#` preceded by whitespace / start-of-line) to end of line, UNLESS inside a single/double quote or an unquoted heredoc body.
2. Tokenize on whitespace/semicolon/newline/PIPE/`&&`/`||`, tracking whether we are inside single quotes, double quotes, a `$(...)` substitution, backticks, or a heredoc body (a small state machine).
3. Walk token-by-token with lookahead: a token IS the command word `sudo` only when it appears at a command/segment start (not as an `=` assignment value, not inside `$(...)`/backtick interpolation) — i.e. preceded by a segment boundary.
4. For each command-word `sudo`, look at the NEXT tokens until the next segment boundary. ANY token that is `-n` → this sudo can't prompt → allow; `-l`/`-v`/`-K`/`-k` likewise allow. If the first option token (before a non-flag operand) is a `-` token that is NOT one of `-n`/`-l`/`-v`/`-K`/`-k` AND a command applies → block. Combined: `sudo -n true; sudo <command>` — tokenize BOTH segments; the second `sudo <command>` has no `-n` → blocked. Merged short flags (`sudo -ABC` where the bundle is not purely allowed singles) — a `-` token not exactly one of the allowed flags nor a known no-prompt short flag, followed by a command → block. `alias sudo='sudo -n'` and `FOO=sudo echo` are handled because command-word detection requires an exact segment-boundary `sudo` token. The guard never blocks `sudo -n` (it cannot prompt) — keeping the guard from false-positiving on legitimate no-prompt invocations.
5. Return a structured `{ blocked: boolean; reason?: string; matchedSudoSegment?: string }`.

Wiring into the bash tool (in `registerSudo`, Task 2). **Export the handler as a named function for testability** (the integration test calls it directly — do NOT leave it as an anonymous inline closure):
```ts
// exact imports — all exported from @earendil-works/pi-coding-agent (verified 0.84.x):
import type { BashToolCallEvent, BashToolInput, ToolCallEvent, ToolCallEventResult } from "@earendil-works/pi-coding-agent";

export function handleBashToolCall(
  event: ToolCallEvent,
): ToolCallEventResult | undefined {
  if (event.toolName !== "bash") return undefined;
  const command = (event.input as BashToolInput).command ?? "";
  const verdict = isInteractiveSudoAttempt(command);
  if (verdict.blocked) {
    return { block: true, reason: verdict.reason ?? "Interactive sudo in the bash tool is blocked. Use sudo_exec instead — it prompts for the password through the masked UI and never exposes it. Non-interactive sudo -n / -l / -v / -K / -k still work." };
  }
  return undefined;
}
// in registerSudo:
pi.on("tool_call", (event) => handleBashToolCall(event));
```
Note: `event.input.command` is mutable — the guard does NOT mutate it; it only vetoes. The handler is registered at the top level of `registerSudo` (not inside a session handler). The four type names (`BashToolCallEvent`, `BashToolInput`, `ToolCallEvent`, `ToolCallEventResult`) are all exported from `@earendil-works/pi-coding-agent` (verified against the installed 0.84.x d.ts) — use exactly those names.

Error message the agent sees on a block (structured `content` + `isError: true`, produced by pi's `createErrorToolResult` with the `reason` as text):
```
Blocked: interactive sudo is disabled in the bash tool for your safety.
Use the sudo_exec tool instead; it prompts for the password through the
masked UI and never exposes it. Direct `sudo` (without -n) can hang
the shell and leak the password. Non-interactive `sudo -n` / `-l` / `-v` still work.
```

**Tests (`guard.test.ts` — write failing FIRST):**
1. `"sudo apt update"` → blocked.
2. `"sudo -n true"` → NOT blocked (`sudo -n` can't prompt).
3. `"sudo -n true; sudo apt update"` → blocked (second segment).
4. `"FOO=sudo bar; sudo rm -rf /"` → only second sudo blocked; `FOO=sudo` is not a sudo call.
5. `"echo 'sudo apt update'"` — sudo inside a string → the outer command is `echo`, not `sudo` → NOT blocked.
6. Heredoc `cat <<EOF\nsudo apt\nEOF` → the heredoc body's `sudo apt` runs → scanner MUST detect a real `sudo` → blocked.
7. `"FOO=sudo; sudo -n true"` → only `sudo -n` allowed → NOT blocked.
8. `"sudo ls; echo hi"` → blocked.
9. `"alias x='sudo'; echo hi"` → NOT blocked (alias string, no real sudo segment at a boundary; aliases inert in non-interactive `/bin/sh` unless `shopt -s expand_aliases`, out of scope).
10. `"sudo -l"` → NOT blocked (list allowed).
11. `"FOO=sudo echo hi"` → NOT blocked (env-assignment value, not command word).
12. Integration: import `handleBashToolCall` and call it with fake events: `toolName: "bash"` + `{ command: "sudo apt update" }` → `{ block: true }`; `{ command: "sudo -n true" }` → `undefined`; `toolName: "read"` + any → `undefined`.

**Steps:**
- [ ] Write the failing `guard.test.ts` cases (they FAIL on a naive/inert scanning baseline).
- [ ] Implement `guard.ts` (pure tokenizer+lookahead) — exported, no I/O.
- [ ] Run `cd packages/sudo && npx vitest run` — all pass.
- [ ] Wire the `tool_call` handler into `index.ts` (top-level; no mutation of `event.input`).
- [ ] Run `cd packages/sudo && npx tsc --noEmit` green.
- [ ] Commit: `feat(sudo): block interactive sudo in the bash tool via tool_call veto`

**Acceptance criteria:**
- [ ] `isInteractiveSudoAttempt` is a pure, unit-tested function (no I/O) with the tokenizer+lookahead strategy.
- [ ] Every `guard.test.ts` case passes, including mixed `sudo -n true; sudo <cmd>` (test 3) and heredoc (test 6); integration case passes.
- [ ] The guard uses `pi.on("tool_call")` returning `{ block: true }` — NOT the `tool_execution_start` bus event (observational only).
- [ ] `sudo -n`/`-l`/`-v`/`-K`/`-k` remain allowed.
- [ ] `npx tsc --noEmit` green in `packages/sudo`; single commit.

**Do NOT change:** the `sudo_exec` tool; the credential cache (Task 1); meta wiring (Task 3). Alias expansion is explicitly not modeled.

---

### Task 3: session lifecycle + `/sudo` command + config wiring + meta/release/docs + full-gate

**Context:**
Tasks 1–2 are self-contained in `packages/sudo`, but the package is not yet fully installable/discoverable and does not author all lifecycle cleanup. Per AGENTS.md "Adding a New Package", the new package must be wired into meta, the release workflow, README, and AGENTS.md; and the session lifecycle must clear the credential cache on shutdown. The `remote_sudo_exec` SSH variant stays out of scope. The ADR for this design already exists (`docs/adr/0010-archimedes-sudo-security.md`, created in the spec session).
**Files:**
- Modify: `packages/sudo/src/index.ts` — session lifecycle (top-level `session_shutdown` clears `credentialCache`; `session_start` re-creates it via `clear()`), `/sudo` command registration
- Create: `packages/sudo/src/lifecycle.test.ts` (optional; covers `session_shutdown` clearing the cache if worth the branch)
- Modify: `meta/package.json` — add `"@pi-archimedes/sudo": "workspace:*"`
- Modify: `meta/src/index.ts` — `import { registerSudo } from "@pi-archimedes/sudo";` + call `registerSudo(pi)` in the factory wrapped in the plugin gate: `if (isPluginEnabled("sudo")) registerSudo(pi);` — `isPluginEnabled` comes from `meta/src/plugins.ts` (plan-031's single `archimedes.plugins` gate, ADR 0011); if plan-031 has NOT landed yet, define a minimal local `isPluginEnabled` helper reading `archimedes.plugins.sudo` from settings-io (default true) so sudo mounts gated regardless of plan order. When plan-031's manifest exists, add `{ id: "sudo", label: "Sudo", description: "Safe privileged execution", defaultEnabled: true, load: () => import("@pi-archimedes/sudo") }` to `PLUGINS` in `meta/src/plugins.ts` (plan-031's Task 1 already references a `// future: sudo (plan-030)` entry — this supersedes it).
- Modify: `.github/workflows/release.yml` — add `pnpm --filter "@pi-archimedes/sudo" publish --access public` after `@pi-archimedes/core` and before `meta` (sudo's only dep is core)
- Modify: `AGENTS.md` — monorepo structure list (+ `packages/sudo` bullet), "all N package versions" count + type-check count + publish-order line
- Modify: `README.md` — feature section for `@pi-archimedes/sudo`, monorepo tree line, `pi install @pi-archimedes/sudo` line under install selectively, settings-table entry
- Test: `packages/sudo/src/config.test.ts` (already Task 1; extend for lifecycle if needed)

**What to implement:**
- **Lifecycle:** `pi.on("session_shutdown", ...)` registered at the TOP level of `registerSudo` (AGENTS.md — nested registration accumulates on `/reload`). It clears the cache + unsubscribes nothing (pi handles event teardown per-session). `session_start` (also top-level) calls `credentialCache.clear()` to reset the cred for a fresh session.
- **`/sudo` command:** `pi.registerCommand("sudo", { description: "Manage the sudo credential cache", handler })` with subcommands: `forget` (clears cache + `ctx.ui.notify("Sudo credential cleared.", "info")`), bare invocation → notify current state (cached / not cached). This satisfies the "cleared on ... explicit forget" requirement.
- **Config:** JSON-only under `archimedes.sudo` (already Task 1). No settings-panel UI in v1 — document JSON-only config in README with `loadSudoConfig` defaults.
- **Enable/disable:** single plugin gate in meta (`archimedes.plugins.sudo` via `/plugins`, ADR 0011 / plan-031) — when disabled, meta does NOT call `registerSudo` at all, so the tool, guard, `/sudo` command, and lifecycle never mount. This package has NO own `enabled` config (removed per ADR 0011).
- **Docs:** README feature section (bullet + caveat that the bash guard blocks interactive sudo), Settings table row, and under "install selectively" (lines ~241-247 use the `npm:` prefixed form `pi install npm:@pi-archimedes/...`) add `pi install npm:@pi-archimedes/sudo`. There is also a `pi install @pi-archimedes/<name>` doc convention in AGENTS.md — follow the README's actual `npm:` form for the install line.
- **Full-gate (final):** run `npx tsc --noEmit` in all **12** dirs (core, ask, footer, diff, image-paste, notify, subagent, todo, session-name, mcp, **sudo**, meta) + `npx vitest run` in every package with a `vitest.config.ts` (sudo + core/ask/footer/diff/mcp/subagent/todo = 8; image-paste/notify/session-name have no configs). Do NOT touch `docs/plans/done/**`.

**Steps:**
- [ ] Add lifecycle + `/sudo` command in `packages/sudo/src/index.ts`; add `lifecycle.test.ts`; `cd packages/sudo && npx vitest run && npx tsc --noEmit` green.
- [ ] Edit `meta/package.json`, `meta/src/index.ts`, `.github/workflows/release.yml`, `AGENTS.md`, `README.md` per the wiring list. **Exact current AGENTS.md markers to update** (grep these — the executors need the literal values):
  - `AGENTS.md` Monorepo Structure list: add a `packages/sudo` bullet after `packages/mcp` (the list currently has 11 items; the "depends on all ten" line in the `meta` bullet at bottom → "depends on all eleven")
  - `AGENTS.md` Release Steps: "Bump all 11 package versions" → 12; "each of the 10 package directories (9 components + session-name)" → 11 ("10 components + session-name"); publish-order line `core → ask → todo → notify → session-name → footer → diff → image-paste → subagent → mcp → meta` → insert `sudo` after `core` (sudo's only dep is core), i.e. `core → sudo → ask → ...`
  - `.github/workflows/release.yml` publish block: add `pnpm --filter "@pi-archimedes/sudo" publish --access public --no-git-checks` after the `core` line and before `ask` (verify the exact sibling lines while editing)
- [ ] `pnpm install` at the repo root (links meta → sudo).
- [ ] Full gate: every dir `npx tsc --noEmit`; every package with a vitest config `npx vitest run`. All green.
- [ ] Commit: `feat(sudo): meta wiring, session lifecycle, settings + docs (plan 030)`

**Acceptance criteria:**
- [ ] `archimedes.sudo` config loads with sane defaults; cache clears on `session_shutdown` + `/sudo forget` (top-level handler).
- [ ] meta registration, `meta/package.json` dep, release.yml publish line (after core, before meta), AGENTS.md list + counts + publish-order, README feature/tree/`pi install`/settings all present.
- [ ] Full-tsc gate over **12** dirs green; vitest green in packages with configs.
- [ ] Commit ends the plan; `docs/plans/README.md` plan-030 row stays IN PROGRESS until implemented (do not flip to COMPLETED).

**Do NOT change:** the `sudo_exec` tool schema; guard semantics; `docs/adr/0010-archimedes-sudo-security.md` (already created and correct); release workflow steps for other packages; version numbers (release-time).

---

## Out of scope (deferred; do NOT build in this plan)

- `remote_sudo_exec` SSH variant — explicitly deferred. Passwords must be isolated per remote host when implemented (future plan), not in v1.
- Child/subagent `sudo_exec` — headless (`ctx.mode !== "tui"`) blocks with a clear error; the socket IPC bridge for child password prompts is deferred.
- Getting the password through any non-masked path (argv, env, logs, files, `sudo` argument, `sudo`-newline prompt).
- Persisting credentials to disk or to the OS keyring (keyring belongs in a future plan; v1 is in-memory only).
- Per-command confirmation beyond the tool's own `reason` display + `confirmCommand` gate + the bash-guard block — no native OS "sudo askpass" hub.
- Settings-panel UI for `archimedes.sudo` (JSON config only in v1).

## Cross-task notes for the executing agent

- The monorepo has NO build step — verification is `tsc --noEmit` + vitest only (AGENTS.md).
- Cross-package imports use package subpath exports (`@pi-archimedes/core/settings-io`); within a package, relative imports stay package-internal (e.g. `./cache.js`).
- Each task MUST end with a green `npx tsc --noEmit` in `packages/sudo` (and vitest green where tests exist) — intermediate commits must not leave the repo red.
- The release publish order in `.github/workflows/release.yml` must place the new sudo line after its dependency (`core`) and before `meta` (sudo depends only on core). `pnpm --filter "@pi-archimedes/sudo" publish` needs `--access public --no-git-checks` like its siblings.
- The shelling is done with `spawn` only — never `execSync`/`exec` through a shell, and never interpolate the password into a command string; the password rides on stdin only.
- Register the `session_shutdown` handler at the TOP level of `registerSudo`, not inside `session_start` (AGENTS.md prevents handler accumulation on `/reload`).
- If a check fails twice in a row without edits between runs, stop and report BLOCKED (AGENTS.md loop-break rule).
- The ADR for this plan (`docs/adr/0010-archimedes-sudo-security.md`) already exists (created in the spec session) — read it before implementation; it documents the guard mechanism (active `tool_call` veto, not the observational `tool_execution_start` bus event) and the security posture.