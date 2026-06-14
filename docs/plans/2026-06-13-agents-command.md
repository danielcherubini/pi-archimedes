# /agents Command Plan

**Goal:** Add a `/agents` slash command that opens a TUI overlay for full CRUD of agent frontmatter files.
**Architecture:** Five-screen TUI overlay (List → Detail → Edit, Name Input, Confirm Delete) registered as a slash command in `packages/subagent`, wired through `meta`. Uses pi's `ctx.ui.custom()` overlay API. Follows agentspec v0.5.0 field names; only edits fields pi-archimedes actually consumes (name, description, tools, model, thinking, systemPrompt body). All other frontmatter fields preserved via `extraFields`.
**Tech Stack:** TypeScript, `@earendil-works/pi-coding-agent` (ExtensionAPI, parseFrontmatter, getAgentDir), `@earendil-works/pi-tui` (Component, Theme, matchesKey, truncateToWidth)

---

## Task 1: Expand AgentConfig and add frontmatter I/O

**Context:**
The existing `AgentConfig` in `packages/subagent/src/agents.ts` only supports 6 fields (name, description, model, thinking, tools, systemPrompt). The `/agents` command needs the full agentspec v0.5.0 field set plus `extraFields` for unknown fields. We also need a serializer that round-trips frontmatter faithfully. The existing `parseFrontmatter` from `@earendil-works/pi-coding-agent` is used for parsing — we wrap it and add serialization.

**Files:**
- Modify: `packages/subagent/src/agents.ts`
- Create: `packages/subagent/src/frontmatter-io.ts`

**What to implement:**

1. In `agents.ts`, expand the `AgentConfig` interface to:
```typescript
export interface AgentConfig {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  thinking?: string;
  systemPrompt: string;
  source: "user" | "project";
  filePath: string;
  // Extra fields preserved from frontmatter but not editable in TUI
  extraFields?: Record<string, string>;
}
```
Note: We intentionally keep only the fields pi-archimedes actually consumes (name, description, tools, model, thinking, systemPrompt). All other frontmatter keys go into `extraFields`. Do NOT add agentspec fields like `color`, `effort`, `maxTurns` etc. as explicit properties — they go through `extraFields`.

2. In `agents.ts`, update `loadAgentsFromDir` to capture unknown frontmatter fields into `extraFields`. Known fields are: `name`, `description`, `tools`, `model`, `thinking`. Any other key in frontmatter goes into `extraFields`.

3. In `agents.ts`, add a new function `discoverAgentsAll(cwd: string)` that returns:
```typescript
interface AgentsDiscoveryResult {
  user: AgentConfig[];
  project: AgentConfig[];
  userDir: string;        // e.g., ~/.pi/agent/agents
  projectDir: string | null;  // e.g., .pi/agents or null if not found
}
```
This wraps the existing `discoverAgents` logic but returns separate arrays + directory paths (needed by the TUI for create/save).

4. Create `frontmatter-io.ts` with:
- `serializeAgent(config: AgentConfig): string` — produces the full `.md` file content:
  - Starts with `---\n`
  - Writes `name: {name}`, `description: {description}`
  - If `tools` exists: `tools: {comma-separated}`
  - If `model` exists: `model: {model}`
  - If `thinking` exists: `thinking: {thinking}`
  - Writes any `extraFields` keys (sorted alphabetically)
  - Ends with `\n---\n\n{systemPrompt}\n`
  - Must produce valid frontmatter that `parseFrontmatter` can re-parse
- `AGENT_NAME_REGEX = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/` — validates agentspec name format (lowercase + hyphens, 3-50 chars, alphanumeric start/end). Also allow single char names matching `/^[a-z0-9]$/` for edge case.
- `validateAgentName(name: string): string | null` — returns error message or null

5. Export from `agents.ts`: re-export `discoverAgentsAll` and keep existing `discoverAgents`, `findAgent`.

**Steps:**
- [ ] Expand `AgentConfig` interface in `agents.ts`
- [ ] Update `loadAgentsFromDir` to populate `extraFields` from unknown frontmatter keys
- [ ] Add `discoverAgentsAll(cwd)` function that returns separated user/project arrays + directory paths
- [ ] Create `frontmatter-io.ts` with `serializeAgent` and `validateAgentName`
- [ ] Run `npx tsc --noEmit` in `packages/subagent/`
  - Did it succeed? If not, fix type errors and re-run.
- [ ] Commit with message: "feat: expand AgentConfig with extraFields and add frontmatter I/O"

**Acceptance criteria:**
- [ ] `AgentConfig` has `extraFields?: Record<string, string>`
- [ ] `discoverAgentsAll(cwd)` returns `{ user, project, userDir, projectDir }`
- [ ] `serializeAgent(config)` produces valid frontmatter + body
- [ ] `validateAgentName("scout")` returns null, `validateAgentName("My Agent!")` returns error
- [ ] `npx tsc --noEmit` passes in `packages/subagent/`

---

## Task 2: Build the agent-manager TUI component

**Context:**
The core of the feature — a TUI overlay component with 5 screens: List, Detail, Edit, Name Input, Confirm Delete. This is the largest task (~600-800 lines). It follows the visual design from pi-subagents' AgentManager: header bar, search bar, 8-item viewport, preview bar, contextual footer. The component implements pi's `Component` interface (`render`, `handleInput`, `invalidate`, `dispose`).

**Files:**
- Create: `packages/subagent/src/agent-manager.ts`

**What to implement:**

Create `agent-manager.ts` with the following structure:

1. **Types:**
```typescript
interface ManagerState {
  screen: "list" | "detail" | "edit" | "name-input" | "confirm-delete";
  agents: AgentConfig[];  // combined user + project
  userAgents: AgentConfig[];
  projectAgents: AgentConfig[];
  userDir: string;
  projectDir: string | null;
  // List state
  listCursor: number;
  listScroll: number;
  filterQuery: string;
  // Detail state
  detailAgent: AgentConfig | null;
  detailScroll: number;
  // Edit state
  editAgent: AgentConfig | null;  // mutable copy being edited
  editFieldIndex: number;
  editInField: boolean;
  editDirty: boolean;
  // Name input state
  nameInputBuffer: string;
  nameInputScope: "user" | "project";
  nameInputMode: "new" | "clone";
  nameInputSource: AgentConfig | null;
  nameInputError: string | null;
  // Confirm delete state
  deleteTarget: AgentConfig | null;
}
```

2. **Screen constants:**
```typescript
const LIST_VIEWPORT = 8;
const EDIT_FIELDS = ["name", "description", "tools", "model", "thinking"];
// systemPrompt (body) is accessed via 'p' key, not in field list
```

3. **Constructor / factory:**
```typescript
export function createAgentManager(
  userAgents: AgentConfig[],
  projectAgents: AgentConfig[],
  userDir: string,
  projectDir: string | null,
): Component {
  // Initialize ManagerState with agents = [...userAgents, ...projectAgents]
  // Return Component with render, handleInput, invalidate, dispose
}
```

4. **List screen render:**
- Header: ` Agents [N] ` where N = total count
- Search bar: `◎ type to filter...` or `◎ {query}|` when typing
- Agent rows (8 visible): `{cursor}{name(16)} {model(12)} [{scope}(8)} {description(rest)}`
  - cursor: `>` for selected, ` ` otherwise
  - scope: `[user]` or `[proj]`
  - model: truncated to 12 chars, or "default" if not set
  - description: dimmed, truncated to remaining width
- Preview bar: full description of cursor agent (dimmed)
- Footer: ` [enter] view  [n] new  [c] clone  [d] delete  [/] search  [esc] close `
- Use `theme.fg("accent", ...)` for cursor/highlighted items
- Use `theme.fg("dim", ...)` for descriptions, model, scope badges
- Fuzzy filter: any typed chars filter by name + description (case-insensitive substring match is fine, no need for full fuzzy)

5. **Detail screen render:**
- Header: ` Agent: {name} [{scope}] `
- Frontmatter section: each field on its own line as `{key}: {value}`
  - name, description, tools (comma-joined), model, thinking
  - If extraFields exist, show them dimmed below with a separator
- Body section: `---` separator, then systemPrompt text wrapped to width
  - Scrollable with ↑↓ (track detailScroll offset, show ~10 lines)
- Footer: ` [e] edit  [d] delete  [esc] back `

6. **Edit screen render:**
- Header: ` Edit: {name} * ` (asterisk if dirty)
- Field list: show current field highlighted with `>` prefix
  - Fields cycle: name → description → tools → model → thinking
  - When not in field edit mode: show field name + current value (truncated)
  - When in field edit mode: show field name + editable text with cursor
    - For single-line fields (name, tools, model, thinking): single line input
    - For description: multi-line in a small viewport (3 lines)
- Hint: ` [↑↓] fields  [enter] edit  [p] prompt  [ctrl+s] save  [esc] back `
- When on systemPrompt edit (entered via `p`): show full text editor viewport (~8 lines) with wrap

7. **Name Input screen render:**
- Header: ` New Agent ` or ` Clone Agent `
- Label: `Name:`
- Input box: bordered box with single-line text input and cursor
- Scope indicator: `Scope: [user]  [tab] toggle` (or `[proj]`)
- Error line: if nameInputError set, show in `theme.fg("error", ...)`
- Footer: ` [enter] continue  [esc] cancel `

8. **Confirm Delete screen render:**
- Header: ` Delete "{name}"? `
- File path: `File: {filePath}`
- Warning: `This cannot be undone.` (in warning/error color)
- Footer: ` [y] confirm  [n / esc] cancel `

9. **Input handling — List screen:**
- `↑↓`: move cursor (clamp to filtered range, adjust scroll)
- `Enter`: open detail of cursor agent → switch to "detail" screen
- `n`: switch to "name-input" with mode="new", empty buffer, scope="user"
- `c`: switch to "name-input" with mode="clone", buffer="{name}-copy", scope=cursor agent's source, source=cursor agent
- `d`: switch to "confirm-delete" with target=cursor agent
- `/`: start filter mode — subsequent single chars append to filterQuery
- `Backspace`: remove last char from filterQuery (if non-empty), reset cursor/scroll
- `Esc`: if filterQuery non-empty, clear it; otherwise return close signal
- Single printable char (when filterQuery non-empty or after `/`): append to filterQuery, reset cursor=0, scroll=0

10. **Input handling — Detail screen:**
- `↑↓`: scroll body (detailScroll ±1, clamp)
- `e`: switch to "edit" screen — create mutable copy of agent, editDirty=false, editFieldIndex=0
- `d`: switch to "confirm-delete" with target=detailAgent
- `Esc`: switch back to "list"

11. **Input handling — Edit screen:**
- When NOT in field edit mode:
  - `↑↓`: cycle editFieldIndex (0-4 for the 5 fields)
  - `Enter`: enter field edit mode (editInField=true)
  - `p`: enter systemPrompt edit mode — show body text editor
  - `Ctrl+S`: save agent (see save logic below)
  - `Esc`: if editDirty → show discard prompt (set a temporary state asking y/n); if not dirty → back to detail
- When IN field edit mode (single-line):
  - Normal text input: append char
  - `Backspace`: remove last char
  - `Ctrl+A`: move cursor to start
  - `Ctrl+E`: move cursor to end
  - Left/Right arrows: move cursor
  - `Enter`: exit field edit mode, mark dirty
  - `Esc`: exit field edit mode (keep changes in buffer, mark dirty)
- When IN systemPrompt edit mode:
  - Multi-line text editing with wrap
  - `↑↓`: move cursor in text
  - `Ctrl+S`: save
  - `Esc`: exit prompt edit, mark dirty
- Discard prompt (after Esc with dirty):
  - `y`: discard changes, back to detail (re-read original from agents list)
  - `n`/`Esc`: stay on edit screen

12. **Save logic:**
- Validate name with `validateAgentName` — if fails, set edit error, don't save
- Check duplicate name within same scope (compare against current agents list, excluding self)
- If name changed: `fs.renameSync(oldPath, newPath)` then write
- If new agent (isNew flag): `fs.mkdirSync(dir, {recursive: true})` then `fs.writeFileSync`
- Write file with `serializeAgent(editAgent)`
- After save: refresh agents list by re-calling discoverAgentsAll, find the saved agent, switch to detail
- On write error: show error message in status, stay on edit screen

13. **Input handling — Name Input screen:**
- `Tab`: toggle nameInputScope between "user" and "project"
  - If project selected but projectDir is null → show error "No project agents directory found"
- Single printable char: append to nameInputBuffer
- `Backspace`: remove last char
- Left/Right: move cursor in buffer
- `Enter`: validate name → if valid, create agent config and switch to "edit"
  - If mode="new": blank config with defaults (name from buffer, description="", systemPrompt="", source=scope)
  - If mode="clone": deep copy of source agent, override name from buffer, source=scope
  - Set isNew=true on the new agent, add to agents list
- `Esc`: back to "list"

14. **Input handling — Confirm Delete screen:**
- `y`/`Y`: `fs.unlinkSync(deleteTarget.filePath)`, remove from agents list, back to "list"
- `n`/`N`/`Esc`: back to previous screen (detail or list)

15. **Component interface:**
```typescript
interface Component {
  render(width: number): string[];
  handleInput(data: string): "close" | void;  // return "close" to close overlay
  invalidate(): void;
  dispose(): void;
}
```

16. **Helper functions:**
- `fuzzyFilter(items, query)`: case-insensitive substring match on name + description
- `wrapText(text, width)`: simple word-wrap
- `truncateToWidth(text, max)`: use pi-tui's `truncateToWidth`
- `pad(text, width)`: left-pad with spaces to width
- `row(text, width, theme)`: apply theme to line, pad to width
- `renderHeader(text, width, theme)`: themed header bar
- `renderFooter(text, width, theme)`: themed footer bar

**Steps:**
- [ ] Create `agent-manager.ts` with types and state interface
- [ ] Implement List screen render + input handling
- [ ] Implement Detail screen render + input handling
- [ ] Implement Edit screen render + input handling (field cycling, inline editing, dirty tracking)
- [ ] Implement Name Input screen render + input handling (scope toggle, validation)
- [ ] Implement Confirm Delete screen render + input handling
- [ ] Implement save logic (validation, duplicate check, file I/O, refresh)
- [ ] Wire all screens into the Component interface (render dispatches to current screen, handleInput routes by screen)
- [ ] Run `npx tsc --noEmit` in `packages/subagent/`
  - Did it succeed? If not, fix type errors and re-run.
- [ ] Commit with message: "feat: add agent-manager TUI component with CRUD screens"

**Acceptance criteria:**
- [ ] `createAgentManager()` returns a valid `Component`
- [ ] List screen shows agents with search, viewport, preview, footer
- [ ] Detail screen shows frontmatter + scrollable body
- [ ] Edit screen cycles fields, edits inline, tracks dirty state
- [ ] Name Input validates names, toggles scope
- [ ] Confirm Delete asks y/n
- [ ] Save writes file, handles rename, detects duplicates
- [ ] Dirty guard prompts on Esc with unsaved changes
- [ ] `npx tsc --noEmit` passes in `packages/subagent/`

---

## Task 3: Register /agents command and wire into meta

**Context:**
The agent-manager component needs to be exposed as a `/agents` slash command. Following the existing pattern in `packages/subagent/src/index.ts` (where `registerSubagent(pi)` calls `pi.registerTool` internally), we add `registerAgentsCommand(pi)` that calls `pi.registerCommand("agents", ...)`. The command handler uses `ctx.ui.custom()` with `{ overlay: true }` to open the TUI.

**Files:**
- Modify: `packages/subagent/src/index.ts`
- Modify: `meta/src/index.ts`

**What to implement:**

1. In `packages/subagent/src/index.ts`, add:
```typescript
import { createAgentManager } from "./agent-manager.js";
import { discoverAgentsAll } from "./agents.js";

export function registerAgentsCommand(pi: ExtensionAPI): void {
  pi.registerCommand("agents", {
    description: "Open the Agents Manager",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const { user, project, userDir, projectDir } = discoverAgentsAll(ctx.cwd);

      const availableModels = ctx.modelRegistry.getAvailable().map((m) => ({
        id: m.id,
        provider: m.provider,
        fullId: `${m.provider}/${m.id}`,
      }));

      const availableTools = pi.getAllTools().map((t) => ({
        name: t.name,
        description: t.description ?? "",
      }));

      await ctx.ui.custom<void>(
        (tui: TUI, theme: Theme, _keybindings, done: () => void) => {
          // Pass tui, theme, done, and available models/tools to the manager
          return createAgentManager(
            user,
            project,
            userDir,
            projectDir,
            tui,
            theme,
            done,
            availableModels,
            availableTools,
          );
        },
        { overlay: true, overlayOptions: { anchor: "center", width: 84, maxHeight: "80%" } },
      );
    },
  });
}
```

2. In `meta/src/index.ts`, add the import and call:
```typescript
import { registerSubagent, registerAgentsCommand } from "@pi-archimedes/subagent";
// ...
registerAgentsCommand(pi);
```
Place the call at the top level (not inside `session_start`) to match the AGENTS.md rule about event handler registration.

**Steps:**
- [ ] Add `registerAgentsCommand` function to `packages/subagent/src/index.ts`
- [ ] Export `registerAgentsCommand` from the subagent package
- [ ] Import and call `registerAgentsCommand(pi)` in `meta/src/index.ts`
- [ ] Run `npx tsc --noEmit` in `packages/subagent/`
  - Did it succeed? If not, fix type errors and re-run.
- [ ] Run `npx tsc --noEmit` in `meta/`
  - Did it succeed? If not, fix type errors and re-run.
- [ ] Commit with message: "feat: register /agents command and wire into meta orchestrator"

**Acceptance criteria:**
- [ ] `registerAgentsCommand` is exported from `@pi-archimedes/subagent`
- [ ] `meta/src/index.ts` calls `registerAgentsCommand(pi)` at top level
- [ ] `/agents` command is registered with description "Open the Agents Manager"
- [ ] Command opens overlay with agent-manager component
- [ ] `npx tsc --noEmit` passes in both `packages/subagent/` and `meta/`

---

## Task 4: Polish — empty state, error handling, visual refinements

**Context:**
Several edge cases and UX polish items identified during review need attention: empty list state, cross-scope collision warnings, file write error handling, and visual consistency with pi-archimedes' theme system.

**Files:**
- Modify: `packages/subagent/src/agent-manager.ts`

**What to implement:**

1. **Empty state:** When no agents exist in the list, show:
   - Dimmed text: `No agents found`
   - Below: `Press n to create your first agent`
   - Still show footer with keybindings

2. **Cross-scope collision warning:** When creating/cloning an agent whose name already exists in the OTHER scope (e.g., creating user `foo` when project `foo` exists), show a warning in the Name Input screen: `Warning: a project agent "foo" exists and will take precedence`. Allow creation but warn.

3. **File write error handling:** On `fs.writeFileSync` failure:
   - Catch error, show error message in a status line below the edit fields
   - Stay on Edit screen (don't close)
   - User can retry with `Ctrl+S` or cancel with `Esc`

4. **Project dir auto-creation:** When saving a project-scope agent and `.pi/agents/` doesn't exist, auto-create it with `fs.mkdirSync(dir, { recursive: true })`.

5. **Theme usage:** Ensure all text uses `theme.fg(...)` for colors:
   - `theme.fg("accent", ...)` for cursor, selected items, headers
   - `theme.fg("dim", ...)` for descriptions, hints, secondary info
   - `theme.fg("error", ...)` or `"warning"` for errors
   - Border characters should use theme colors if available

6. **Terminal-aware sizing:** Instead of fixed 84 width, use `Math.min(84, Math.max(60, terminalWidth - 4))` or let the overlay handle sizing via percentage.

7. **Scroll indicators:** In Detail screen's body viewport, show `↑ N more` / `↓ M more` when content extends beyond viewport.

8. **Field value display in Edit:** When NOT in edit mode for a field, show:
   - `> name: scout` (current value, truncated)
   - For empty/undefined fields: `> model: (not set)` in dim

**Steps:**
- [ ] Add empty state handling in List render
- [ ] Add cross-scope collision detection in Name Input (check against agents from other scope)
- [ ] Add try/catch around file writes in save logic, show error in status
- [ ] Add `fs.mkdirSync(dir, { recursive: true })` before project saves
- [ ] Apply theme.fg() consistently across all screens
- [ ] Add scroll indicators in Detail body viewport
- [ ] Improve field value display in Edit (show "(not set)" for empty fields)
- [ ] Run `npx tsc --noEmit` in `packages/subagent/`
  - Did it succeed? If not, fix type errors and re-run.
- [ ] Commit with message: "fix: polish agent-manager UX — empty state, errors, theming"

**Acceptance criteria:**
- [ ] Empty list shows "No agents found. Press n to create..."
- [ ] Cross-scope collision shows warning but allows creation
- [ ] File write errors shown in status, stay on Edit screen
- [ ] Project dir auto-created on save
- [ ] All text uses theme.fg() for colors
- [ ] Detail body shows scroll indicators
- [ ] Edit fields show "(not set)" for empty values
- [ ] `npx tsc --noEmit` passes in `packages/subagent/`

---

## Task 5: Verification and final type-check

**Context:**
Final verification pass across all packages to ensure the feature is complete and type-correct. Follows the AGENTS.md verification order: type-check each package independently.

**Files:**
- No new files. Verification only.

**What to implement:**
No code changes. Run verification checks.

**Steps:**
- [ ] Run `npx tsc --noEmit` in `packages/subagent/`
  - Did it succeed? If not, read errors → fix → re-run (max 2 attempts, then BLOCKED)
- [ ] Run `npx tsc --noEmit` in `meta/`
  - Did it succeed? If not, read errors → fix → re-run (max 2 attempts, then BLOCKED)
- [ ] Verify all new files are listed in `packages/subagent/package.json` `"files"` field (should already include `"src"`)
- [ ] Verify `registerAgentsCommand` is exported and importable
- [ ] Commit with message: "chore: verification pass for /agents command"

**Acceptance criteria:**
- [ ] `npx tsc --noEmit` passes in `packages/subagent/`
- [ ] `npx tsc --noEmit` passes in `meta/`
- [ ] No type errors in any package
