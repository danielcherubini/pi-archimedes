# Notify Package Plan

**Goal:** Add `@pi-archimedes/notify` — a delayed notification package with circuit breaker timeout, triggered on `agent_end` and `ASK_REQUEST`, cancelled on user interaction.

**Architecture:** New standalone package depending on `@pi-archimedes/core` (for bus events). OSC escape sequences for terminal notifications (Ghostty, WezTerm, iTerm2, Kitty, Windows Terminal) with tmux passthrough. Settings integrated into `/archimedes` command via meta's composed settings.

**Tech Stack:** TypeScript, Pi ExtensionAPI, OSC 777/99/9, PowerShell toast (Windows), node:child_process (Windows only).

---

### Task 1: Create packages/notify with OSC logic and circuit breaker

**Context:** The core of the feature — a single-file package that schedules notifications after a configurable delay, cancelling if the user interacts. This is independent of meta and can be type-checked on its own.

**Files:**
- Create: `packages/notify/package.json`
- Create: `packages/notify/src/index.ts`

**What to implement:**

`packages/notify/package.json`:
- `"name": "@pi-archimedes/notify"`
- `"version": "1.3.4"` (matching current monorepo version)
- `"type": "module"`
- `"keywords": ["pi-package"]`
- `"files": ["src"]`
- `"main": "./src/index.ts"`
- `"dependencies": { "@pi-archimedes/core": "workspace:*" }`
- `"peerDependencies": { "@earendil-works/pi-coding-agent": ">=0.1.0" }`
- `"devDependencies": { "typescript": "^6.0.0" }`
- `"pi": { "extensions": ["./src/index.ts"] }`

`packages/notify/src/index.ts` — export `registerNotify(pi: ExtensionAPI)` and `getNotifySettingsItems(config: NotifyConfig): SettingItem[]`:

**Config types:**
```ts
interface NotifyConfig {
  enabled: boolean;
  notifyOnAgentEnd: boolean;
  notifyOnQuestion: boolean;
  delayMs: number;
}

const DEFAULT_NOTIFY_CONFIG: NotifyConfig = {
  enabled: true,
  notifyOnAgentEnd: true,
  notifyOnQuestion: true,
  delayMs: 60_000,
};

const NAMESPACE = "archimedes.notify";
```

Use `loadConfig(NAMESPACE, DEFAULT_NOTIFY_CONFIG)` and `saveConfig(NAMESPACE, config)` from `@pi-archimedes/core/settings-io` for persistence.

**Notification dispatch functions** (adapted from pi-notify, MIT licensed):
- `wrapForTmux(sequence: string): string` — wrap in `\x1bPtmux;...\x1b\` when `process.env.TMUX` is set, escaping inner `\x1b` to `\x1b\x1b`
- `notifyOSC777(title, body)` — `\x1b]777;notify;{title};{body}\x07`
- `notifyOSC9(message)` — `\x1b]9;{message}\x07`
- `notifyOSC99(title, body)` — two sequences: `\x1b]99;i=1:d=0;{title}\x1b\` then `\x1b]99;i=1:p=body;{body}\x1b\`
- `notifyWindows(title, body)` — spawn `powershell.exe -NoProfile -Command <windowsToastScript(title, body)>` using `execFile` from `node:child_process`
- `windowsToastScript(title, body): string` — PowerShell script using `Windows.UI.Notifications.ToastNotificationManager` with `ToastText01` template
- `notify(title, body): void` — detect terminal via env vars (`WT_SESSION` → Windows, `KITTY_WINDOW_ID` → OSC99, `TERM_PROGRAM=iTerm.app` or `ITERM_SESSION_ID` → OSC9, fallback → OSC777)

**Circuit breaker state:**
```ts
let notifyTimer: ReturnType<typeof setTimeout> | null = null;
let pendingTrigger: "agent_end" | "ask_request" | null = null;
```

**`scheduleNotify(trigger: "agent_end" | "ask_request")`:**
1. Call `cancelPending()` first (reset any existing timer)
2. Load config fresh from `loadConfig(NAMESPACE, DEFAULT_NOTIFY_CONFIG)`
3. If `!config.enabled` → return
4. If `trigger === "agent_end" && !config.notifyOnAgentEnd` → return
5. If `trigger === "ask_request" && !config.notifyOnQuestion` → return
6. Set `pendingTrigger = trigger`
7. Set `notifyTimer = setTimeout(() => { fireNotification(pendingTrigger); notifyTimer = null; pendingTrigger = null; }, config.delayMs)`
8. Call `notifyTimer.unref()` if available (so it doesn't block process exit)

**`cancelPending():`**
1. If `notifyTimer` → `clearTimeout(notifyTimer)`, set to `null`
2. Set `pendingTrigger = null`

**`fireNotification(trigger):`**
1. Pick message: `agent_end` → `("Pi", "Task complete — waiting for input")`, `ask_request` → `("Pi", "A question needs your answer")`
2. Call `notify(title, body)`

**`registerNotify(pi: ExtensionAPI):`**
- `pi.on("agent_end", () => scheduleNotify("agent_end"))`
- `pi.on("input", () => cancelPending())`
- `pi.on("agent_start", () => cancelPending())`
- `pi.on("session_shutdown", () => { cancelPending(); unsubAskRequest(); })`
- `const unsubAskRequest = getBus().on(Events.ASK_REQUEST, () => scheduleNotify("ask_request"))`
- All handlers registered at top level (NOT inside session_start)

**`getNotifySettingsItems(config: NotifyConfig): SettingItem[]`:**
Return 4 SettingItems:
1. `{ id: "enabled", label: "Notifications", description: "Enable desktop notifications", currentValue: config.enabled ? "On" : "Off", values: ["On", "Off"] }`
2. `{ id: "notifyOnAgentEnd", label: "Notify on task complete", description: "Notify when agent finishes a task", currentValue: config.notifyOnAgentEnd ? "On" : "Off", values: ["On", "Off"] }`
3. `{ id: "notifyOnQuestion", label: "Notify on question", description: "Notify when a question needs your answer", currentValue: config.notifyOnQuestion ? "On" : "Off", values: ["On", "Off"] }`
4. `{ id: "delayMs", label: "Delay before notify", description: "Seconds to wait before sending notification", currentValue: String(config.delayMs / 1000) + "s" }` — this one gets a number submenu attached in meta's settings.ts

Also export: `loadNotifyConfig()`, `saveNotifyConfig()`, `DEFAULT_NOTIFY_CONFIG`, `type NotifyConfig`

**Steps:**
- [ ] Create `packages/notify/package.json`
- [ ] Create `packages/notify/src/index.ts` with all functions above
- [ ] Run `npx tsc --noEmit` in `packages/notify/`
  - Did it succeed? If not, fix type errors and re-run
- [ ] Commit with message: "feat: add @pi-archimedes/notify package with circuit breaker notifications"

**Acceptance criteria:**
- [ ] `npx tsc --noEmit` passes in `packages/notify/`
- [ ] All OSC sequences match pi-notify's format (777, 9, 99, Windows toast)
- [ ] tmux passthrough wraps all OSC sequences correctly
- [ ] Circuit breaker cancels on input/agent_start
- [ ] Config is read fresh on each trigger (settings changes take effect immediately)

---

### Task 2: Wire notify into meta — config, settings menu, registration

**Context:** Integrate the notify package into the archimedes monorepo — register it in meta's entry point, add its settings to the `/archimedes` menu, and add its config to the composed config loader.

**Files:**
- Modify: `meta/package.json` — add dependency
- Modify: `meta/src/index.ts` — import and register
- Modify: `meta/src/config.ts` — re-export notify config
- Modify: `meta/src/settings.ts` — add notify items + submenu + save handler

**What to implement:**

`meta/package.json`:
- Add `"@pi-archimedes/notify": "workspace:*"` to dependencies

`meta/src/index.ts`:
```ts
import { registerNotify } from "@pi-archimedes/notify";
// ... in default export, after registerAsk(pi):
registerNotify(pi);
```

`meta/src/config.ts`:
- Import `loadNotifyConfig, saveNotifyConfig, DEFAULT_NOTIFY_CONFIG, type NotifyConfig` from `@pi-archimedes/notify`
- Re-export them
- Add `notify: NotifyConfig` to `loadAllConfig()` return type
- Add `notify: loadNotifyConfig()` to the returned object

`meta/src/settings.ts`:
- Import `getNotifySettingsItems` from `@pi-archimedes/notify`
- Import `saveNotifyConfig` from `./config.js`
- Add `notifyConfig: NotifyConfig = { ...allConfig.notify }` to the config copies
- Call `getNotifySettingsItems(notifyConfig)` and add to items list
- Add a number submenu for `delayMs` using `createNumberSubmenu({ label: "Enter delay in seconds (ESC to cancel):", cancelHint: "ESC: cancel", confirmHint: "min 1", min: 1 })`
- In the `addSubmenus` call, add `addSubmenus(notifyItems)`
- In the settings callback, handle cases:
  - `case "enabled": notifyConfig.enabled = newValue === "On"; break;`
  - `case "notifyOnAgentEnd": notifyConfig.notifyOnAgentEnd = newValue === "On"; break;`
  - `case "notifyOnQuestion": notifyConfig.notifyOnQuestion = newValue === "On"; break;`
  - `case "delayMs": { const v = parseInt(newValue, 10); if (Number.isFinite(v) && v >= 1) notifyConfig.delayMs = v * 1000; break; }`
- In the `save` case, add `saveNotifyConfig(notifyConfig)`

**Steps:**
- [ ] Add notify dependency to `meta/package.json`
- [ ] Import and call `registerNotify(pi)` in `meta/src/index.ts`
- [ ] Re-export notify config in `meta/src/config.ts` and add to `loadAllConfig()`
- [ ] Add notify settings items, submenu, and save handler in `meta/src/settings.ts`
- [ ] Run `npx tsc --noEmit` in `meta/`
  - Did it succeed? If not, fix type errors and re-run
- [ ] Commit with message: "feat: wire notify package into meta settings and registration"

**Acceptance criteria:**
- [ ] `npx tsc --noEmit` passes in `meta/`
- [ ] `registerNotify` is called in meta's default export
- [ ] Notify settings appear in `/archimedes` menu (4 items)
- [ ] Saving settings persists notify config to `~/.pi/agent/settings.json` under `archimedes.notify`

---

### Task 3: Update monorepo docs and release workflow

**Context:** Keep AGENTS.md, README.md, and the release workflow in sync with the new package (per the "Adding a New Package" section of AGENTS.md).

**Files:**
- Modify: `AGENTS.md` — add to monorepo structure, bump counts, add to publish order
- Modify: `README.md` — add feature section, monorepo tree, install line, settings table entry
- Modify: `.github/workflows/release.yml` — add publish step for notify (after core, before meta)

**What to implement:**

`AGENTS.md`:
- Add `packages/notify` to Monorepo Structure list (after `packages/todo`, before `meta`)
- Bump "all 8 package versions" → "all 9 package versions"
- Bump "7 package directories (6 components + todo)" → "8 package directories (7 components + notify)"
- Add `@pi-archimedes/notify` to publish order line: `core → ask → todo → notify → footer → diff → image-paste → subagent → meta`
- Add notify to the "Adding a New Package" checklist example count

`README.md`:
- Add a feature bullet for notifications (e.g. "Delayed desktop notifications with circuit breaker — notify only when you've actually stepped away")
- Add `packages/notify` to the monorepo layout tree
- Add `pi install @pi-archimedes/notify` under "install selectively"
- Add a settings table entry if the README has one

`.github/workflows/release.yml`:
- Add `pnpm --filter "@pi-archimedes/notify" publish --access public --no-git-checks` after core's publish and before meta's publish

**Steps:**
- [ ] Update `AGENTS.md` with notify package references
- [ ] Update `README.md` with notify feature, tree, install line
- [ ] Update `.github/workflows/release.yml` with notify publish step
- [ ] Commit with message: "chore: update docs and release workflow for notify package"

**Acceptance criteria:**
- [ ] AGENTS.md lists notify in monorepo structure and publish order
- [ ] README.md mentions notify feature and install command
- [ ] Release workflow publishes notify after core and before meta

---

### Task 4: Run pnpm install and type-check all packages

**Context:** Final verification — install the new workspace dependency and type-check every package to ensure nothing is broken.

**Files:**
- (No file changes — verification only)

**Steps:**
- [ ] Run `pnpm install` at monorepo root
  - Did it succeed? If not, fix workspace resolution errors
- [ ] Run `npx tsc --noEmit` in each package directory:
  - `packages/core`
  - `packages/ask`
  - `packages/footer`
  - `packages/diff`
  - `packages/image-paste`
  - `packages/subagent`
  - `packages/todo`
  - `packages/notify`
  - `meta`
  - Did each succeed? If any fails, fix and re-run that package
- [ ] Commit with message: "chore: pnpm install and verify type-check for all packages"

**Acceptance criteria:**
- [ ] `pnpm install` succeeds without errors
- [ ] `npx tsc --noEmit` passes in all 9 directories (8 packages + meta)

---

### Task 5: Push branch and create PR

**Context:** Push the completed work for review.

**Steps:**
- [ ] Run `git push -u origin feature/notify-package`
- [ ] Create PR to `main` with title "feat: add @pi-archimedes/notify package"
- [ ] PR description should include: feature summary, settings screenshot (if possible), compatibility matrix

**Acceptance criteria:**
- [ ] Branch pushed to origin
- [ ] PR created and linked
