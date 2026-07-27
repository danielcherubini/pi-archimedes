# Fix Windows Subagent Spawn and Terminal Line Clamping Plan

**Goal:** Fix two bugs — subagent spawn failures on Windows (`EFTYPE`/`EINVAL`) and startup crashes in narrow terminals.
**Architecture:** Two independent bug fixes in two packages. No shared changes.
**Tech Stack:** Node.js `child_process.spawn`, TypeScript.

---

### Task 1: Fix Windows subagent spawn (`spawn EFTYPE` / `EINVAL`)

**Context:**
The `@pi-archimedes/subagent` package fails to spawn subagents on Windows because `resolvePiBinary()` resolves to a `.js` file (`dist/cli.js`), which `child_process.spawn()` cannot execute directly on Windows (`.js` is not a recognized executable). The fix uses `process.execPath` (the running Node binary) to spawn the resolved JS entry as `node <path>`, avoiding shell invocation entirely. This means no `shell: true`, no shell escaping risks, and `child.kill()` works directly on the node process. Also adds `windowsHide: true` to prevent a console window flash. The fallback case (`piBinary === "pi"`) is left unchanged — on Windows it remains best-effort and may still fail if resolution falls back, since invoking a PATH-resolved shim requires shell support.

**Files:**
- Modify: `packages/subagent/src/spawn.ts`

**What to implement:**

**No changes to `resolvePiBinary()`** — it already works correctly on all platforms, returning the resolved JS entry path (e.g., `dist/cli.js`) or the fallback `"pi"`.

2. In `spawnSubagent()` (the `spawn()` call inside the function starting at line ~173), modify the spawn call to use `process.execPath` on Windows when a resolved JS path is available. Replace the existing spawn call:

```typescript
const child = spawn(piBinary, args, {
  cwd: options.cwd || process.cwd(),
  env: {
    ...process.env,
    PI_SUBAGENT_SOCKET: socketPath,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
```

With:

```typescript
// On Windows, spawn `node <resolved-js-path>` instead of the raw binary.
// The resolved path is a .js file which cannot be spawned directly on Windows.
// Using process.execPath avoids shell: true (no escaping risks, kill() works).
const isWindowsResolved = process.platform === "win32" && piBinary !== "pi";

const child = spawn(
  isWindowsResolved ? process.execPath : piBinary,
  [
    ...(isWindowsResolved ? [piBinary] : []),
    ...args,
  ],
  {
    cwd: options.cwd || process.cwd(),
    env: {
      ...process.env,
      PI_SUBAGENT_SOCKET: socketPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);
```

Key details:
- `isWindowsResolved` is true only on Windows AND when resolution succeeded (returned a file path, not the `"pi"` fallback)
- When true: spawns `node /path/to/dist/cli.js --mode json ...` (process.execPath + JS path as first arg)
- When false (non-Windows OR fallback): spawns exactly as before (`piBinary` directly)
- `windowsHide: true` prevents a console window flash on Windows (no-op on other platforms)
- No `shell: true` — `child.kill()` works directly on the node process

Do NOT change any other code in the file. The named-pipe logic in `startAskSocketServer()` is already Windows-aware and should not be touched. The abort handler (`child.kill("SIGTERM")`) works correctly since `child.pid` is the node process itself.

**Steps:**
- [ ] Edit `packages/subagent/src/spawn.ts` — modify the `spawn()` call in `spawnSubagent()` to use `process.execPath` on Windows when a resolved JS path is available
- [ ] Run `pnpm exec tsc --noEmit` in `packages/subagent/`
  - Did it succeed? If not, fix type errors and re-run. (If `npx tsc --noEmit` is preferred per AGENTS.md, use that instead — but fall back to `pnpm exec tsc --noEmit` if npx reports "This is not the tsc command you are looking for".)
- [ ] Commit with message: "fix(subagent): use process.execPath on Windows to fix spawn EFTYPE/EINVAL"

**Acceptance criteria:**
- [ ] On Windows with resolved JS path: spawns `node <js-path> <args>` via `process.execPath`
- [ ] On non-Windows: spawn invocation behavior is unchanged (`piBinary` spawned directly; `windowsHide` is a documented no-op)
- [ ] On Windows with fallback `"pi"`: spawn call is unchanged (best-effort)
- [ ] No `shell: true` — `child.kill()` works directly on the node process
- [ ] `windowsHide: true` is set (no-op on non-Windows)
- [ ] `tsc --noEmit` passes in `packages/subagent/`
- [ ] No changes to `resolvePiBinary()` or `startAskSocketServer()`

---

### Task 2: Fix startup crash in narrow terminals (intermediate line clamping)

**Context:**
The startup screen in `packages/core/src/startup/sections.ts` crashes with `Rendered line N exceeds terminal width` when the terminal is narrow (~100 cols or less) and many skills/extensions are installed. The `formatColumns()` function wraps items across multiple lines, but only the **final** line of each section gets `clampLine()` applied — intermediate wrapped lines bypass the clamp and can exceed `maxW`, causing the downstream terminal renderer to crash.

**Files:**
- Modify: `packages/core/src/startup/sections.ts`

**What to implement:**

In `formatColumns()` (starts at line ~177), find the `if` block inside the `for (const item of sec.items)` loop that handles line overflow. It currently looks like:

```typescript
if (currentLine && currentW + 2 + itemW > availableW) {
  lines.push(firstLine ? `${paddedHeader} ${currentStyled}` : " ".repeat(headerW + 1) + currentStyled);
  currentLine = item;
  currentStyled = styleItem(item);
  firstLine = false;
}
```

Replace the `lines.push(...)` line to apply `clampLine(rawLine, maxW)`, mirroring the pattern already used for the final line after the loop:

```typescript
if (currentLine && currentW + 2 + itemW > availableW) {
  const rawLine = firstLine ? `${paddedHeader} ${currentStyled}` : " ".repeat(headerW + 1) + currentStyled;
  lines.push(clampLine(rawLine, maxW));
  currentLine = item;
  currentStyled = styleItem(item);
  firstLine = false;
}
```

The `clampLine` function is already imported from `"../text.js"` at the top of the file. Do NOT add new imports. Do NOT change the final-line clamping (it already works correctly). Do NOT change any other code.

**Steps:**
- [ ] Edit `packages/core/src/startup/sections.ts` — apply `clampLine(rawLine, maxW)` to intermediate wrapped lines
- [ ] Run `pnpm exec tsc --noEmit` in `packages/core/`
  - Did it succeed? If not, fix type errors and re-run. (If `npx tsc --noEmit` is preferred per AGENTS.md, use that instead — but fall back to `pnpm exec tsc --noEmit` if npx reports "This is not the tsc command you are looking for".)
- [ ] Commit with message: "fix(core): clamp intermediate wrapped lines in formatColumns to prevent narrow terminal crash"

**Acceptance criteria:**
- [ ] Intermediate wrapped lines in `formatColumns()` are clamped with `clampLine(rawLine, maxW)`
- [ ] The clamping pattern matches the existing final-line pattern (build `rawLine` variable, then `clampLine`)
- [ ] `npx tsc --noEmit` passes in `packages/core/`
- [ ] No changes to non-affected code paths
- [ ] Manual verification: start pi in a terminal narrowed to ~40-100 columns with skills/extensions installed; confirm no crash and lines truncate cleanly
