# Pi-MCP Adapter: Commands & TUI Panels Subsystem Map

**Repository:** `/home/daniel/Coding/AI/pi-mcp-adapter/`  
**Analyzed Files:**
- `commands.ts` (627 lines) — command handlers
- `mcp-panel.ts` (1015 lines) — interactive server/tools panel
- `mcp-setup-panel.ts` (667 lines) — setup/onboarding panel
- `mcp-status.ts` (98 lines) — status snapshot generation
- `panel-keys.ts` (47 lines) — keybinding wrappers
- `request-headers-command.ts` (371 lines) — HTTP auth command utility

---

## 1. /MCP Command Structure

### Commands Exported from `commands.ts`

The file exports **5 async command handlers** that are called by Pi's command dispatch system. These are not registered in this file; they're imported/registered elsewhere.

#### 1.1 `showStatus(state, ctx)` — /mcp status
**Lines: 22–60**

Displays a text notification (not a TUI panel) with:
- Server connection status: `connected` (✓), `needs-auth` (⚠), `failed` (✗), `not connected` (○)
- Tool count per server
- Cache status (cached vs live)
- Failure age in seconds and failure reason
- At end: instructions to run `/mcp setup` if no servers configured

**Example output:**
```
MCP Server Status:

✓ github: connected (42 tools)
⚠ anthropic: needs auth (cached)
✗ example-fail: failed 15s ago — Connection timeout
○ disabled-server: disabled (run /mcp enable disabled-server, then /reload)
```

No args. UI-only (returns early if `!ctx.hasUI`).

#### 1.2 `showPrompts(state, ctx)` — /mcp prompts
**Lines: 62–100**

Text notification listing all discovered prompts grouped by server:
- Format: `/<commandName> <required> [optional]`
- Includes prompt description
- Reports failed prompt discovery per server
- Total count at end

No args. UI-only.

#### 1.3 `showTools(state, ctx)` — /mcp tools
**Lines: 102–122**

Text notification listing all enabled tools across all servers as a flat list.

No args. UI-only.

#### 1.4 `reconnectServer(state, ctx, name: string)` — /mcp reconnect [server]
**Lines: 124–187**

Closes, reconnects, and rebuilds metadata for a single MCP server.

**Flow:**
1. Validate server exists and is enabled
2. Close existing connection
3. Connect with signal handling
4. If `needs-auth` → notify user to run `/mcp-auth <server>`
5. Build tool metadata, update cache, notify
6. Track keep-alive for reconnect
7. Clear failure state

**Returns:** `boolean` — success

**Error handling:** Records failure reason in state.failureTracker, displays via `recordFailure()`

#### 1.5 `reconnectServers(state, ctx, targetServer?)` — /mcp reconnect-all or /mcp reconnect <name>
**Lines: 189–204**

Bulk version of reconnect — reconnects all servers or a single server.

#### 1.6 `authenticateServer(serverName, config, ctx, signal?, runtime?)` — /mcp-auth <server>
**Lines: 206–281**

Initiates OAuth flow for a server. **This is a separate command handler, not a /mcp subcommand.**

**Flow:**
1. Validate server exists, enabled, and supports OAuth
2. Resolve HTTP server URL
3. Set UI status: "Authenticating {name}..."
4. Call `authenticate()` from `mcp-auth-flow.ts` with:
   - `onAuthorizationUrl`: shows hyperlink in UI notify
   - `onAuthorizationInput`: prompts user to confirm and paste callback URL
5. Handle OAuth result: success → notify, fail → error notify
6. Return `McpAuthResult` (ok: boolean, message: string)

**Key Detail:** The command handler passes **UI callbacks** into the OAuth flow, so the actual OAuth logic is in `mcp-auth-flow.ts`, not here.

#### 1.7 `logoutServer(serverName, state, ctx)` — /mcp logout <server>
**Lines: 283–320**

Clears OAuth credentials and closes connection.

#### 1.8 `openMcpSetup(state, pi, ctx, configOverridePath?, mode?, options?)` — /mcp setup
**Lines: 339–411**

Opens the setup panel (TUI). Not a command handler, but called by `/mcp setup` command handler in another file.

**Flow:**
1. Check programmatic config (bail if set)
2. Discover config paths, imports, known servers
3. Load onboarding state (for "setup completed" hint)
4. Build callbacks object with 10 functions:
   - `previewImports` / `adoptImports` — config compatibility imports
   - `scaffoldProjectConfig` — write `.mcp.json` starter
   - `previewRepoPrompt` / `addRepoPrompt` — RepoPrompt quick-add
   - `previewKnownServer` / `addKnownServer` — known server database
   - `openPath` — file browser integration
   - `markSetupCompleted` — onboarding state persistence
5. Return `Promise<PanelFlowResult>` with `configChanged: boolean`

#### 1.9 `openMcpPanel(state, pi, ctx, configOverridePath?, onDirectToolsConfigChanged?)` — /mcp panel
**Lines: 477–527**

Opens the interactive server/tools management panel (TUI).

**Checks:**
- If no servers configured → redirect to `openMcpSetup("empty")`
- If programmatic config → show info notify instead of panel

**Flow:**
1. Load metadata cache
2. Get server provenance (which file defined each server: user / project / import)
3. Build "shared config notice" (hint about standard .mcp.json)
4. Create panel callbacks (see § 1.9.1)
5. Open `ctx.ui.custom()` overlay with `createMcpPanel()`
6. Handle panel result:
   - If changes made → write direct tools config
   - Call `onDirectToolsConfigChanged?.(changes)` callback
   - Notify user

**Returns:** `Promise<PanelFlowResult>`

#### 1.9.1 `buildMcpPanelCallbacks(state, config, ctx)`
**Lines: 441–475**

Callback object passed to the panel, implementing 6 functions:

| Callback | Purpose |
|----------|---------|
| `reconnect(serverName)` | Calls `reconnectServer()` |
| `canAuthenticate(serverName)` | Checks OAuth support |
| `authenticate(serverName)` | Calls `authenticateServer()` |
| `getConnectionStatus(serverName)` | Returns `"disabled" \| "needs-auth" \| "connected" \| "idle" \| "failed"` |
| `getFailureMessage(serverName)` | Returns error message or null |
| `refreshCacheAfterReconnect(serverName)` | Loads fresh metadata cache for live tool list update |

The panel doesn't directly call state/config — it calls these callbacks, keeping the panel stateless.

#### 1.10 `openMcpAuthPanel(state, pi, ctx, configOverridePath?)` — /mcp-auth (no server arg)
**Lines: 529–565**

Opens the panel in "auth-only" mode: shows only OAuth-capable servers, no tool editing.

---

## 2. /MCP Panel (Server & Tools Management)

**File:** `mcp-panel.ts` (1015 lines)  
**Entry Point:** `createMcpPanel()` function at line 1000

### Panel Architecture

**Class:** `McpPanel` (private class instantiated by `createMcpPanel()` factory)

**Render Model:** Raw `string[]` return from `render(width)` method.

```typescript
export function createMcpPanel(
  config: McpConfig,
  cache: MetadataCache | null,
  provenance: Map<string, ServerProvenance>,
  callbacks: McpPanelCallbacks,
  tui: { requestRender(): void },
  done: (result: McpPanelResult) => void,
  options?: { noticeLines?: string[]; authOnly?: boolean; keybindings?: PanelKeybindings },
): McpPanel & { dispose(): void }
```

### Panel State

**Constructor:** Lines 152–200

```typescript
private servers: ServerState[] = [];          // Full server list
private visibleItems: VisibleItem[] = [];     // Filtered by search
private cursorIndex = 0;                      // Currently selected row
private nameQuery = "";                       // Incremental name search
private descSearchActive = false;              // "?" to enter desc search mode
private descQuery = "";                        // Description search text
private dirty = false;                         // Unsaved changes?
private confirmingDiscard = false;             // Confirm discard dialog
private discardSelected = 1;                   // 0=Discard, 1=Keep
private importNotice: string | null = null;   // Transient "copied to user" msg
private authNotice: string | null = null;     // Transient auth progress/error
private authInFlight: string | null = null;   // Which server auth is pending?
private inactivityTimeout: ... | null = null; // Auto-close after 60s
private visibleItems: VisibleItem[] = [];     // Visible rows (filtered)
```

**ServerState** (line 87):
```typescript
interface ServerState {
  name: string;
  expanded: boolean;                 // Show its tools?
  source: "user" | "project" | "import";
  importKind?: string;               // "claude-code", "cursor", "codex"
  includeTools?: string[];           // If server has allowlist
  excludeTools?: string[];           // If server has blocklist
  exposeResources: boolean;          // Show resource→tool conversions?
  connectionStatus: ConnectionStatus; // "connected" | "idle" | ... | "disabled"
  failureMessage?: string | null;    // Error detail if failed
  tools: ToolState[];                // Flattened tool+resource list
  hasCachedData: boolean;            // Tool metadata in cache
}
```

**ToolState** (line 76):
```typescript
interface ToolState {
  name: string;
  description: string;
  isDirect: boolean;                 // Toggle: will this be "direct"?
  wasDirect: boolean;                // Original state
  estimatedTokens: number;           // Rough token count for decision-making
}
```

### Panel Rendering

**Render Method:** `render(width: number): string[]` — Lines 583–724

Returns a box-bordered TUI with:

```
╭─── MCP Servers ─────────────────────────╮
│                                          │
│ ◎   search...│                          │ ← Search box (nameQuery or descQuery)
│                                          │
├──────────────────────────────────────────┤
│                                          │ ← Empty row
│ ▸ ● github  (12/15 tools ~ 2,345 tokens)│ ← Server row
│   ○ read_file — Read resource: file://x │ ← Tool row
│   ● github_get_user — Get info about   │   (direct=●, not direct=○)
│                                          │
│ ○ anthropic  (0/8 tools) needs auth    │ ← Status indicators
├──────────────────────────────────────────┤
│ 3/15  ↑↓ navigate · space toggle · ...  │ ← Help hints
│                                          │
╰──────────────────────────────────────────╯
```

**Theme colors (ANSI codes):**
```typescript
border: "2"        // dim white
title: "36"        // cyan
selected: "36"     // cyan (highlight)
direct: "32"       // green (✓ included)
needsAuth: "33"    // yellow (⚠ warnings)
placeholder: "2;3" // dim italic
description: "2"   // dim
hint: "2"          // dim
confirm: "32"      // green
cancel: "31"       // red
```

**Rainbow Progress Indicator** (line 83):
```
● ● ● ● ○ ○ ○ ○ ○ ○  3/10
```
Uses 7 truecolor gradients cycling through spectrum.

### Panel Keybindings

**Handler:** `handleInput(data: string)` — Lines 227–397

| Key | Action | Mode |
|-----|--------|------|
| **Navigation** |
| `↑` / `↓` | Move cursor | Global |
| `space` | Toggle server/tool direct status | Normal (not desc search) |
| `return` | Expand server OR authenticate (if needs-auth) OR toggle tool | Normal |
| **Search** |
| `a-z` | Add to name query (incremental search) | Always on |
| `backspace` | Remove from name query | Normal |
| `?` | Enter description search mode | Normal |
| `escape` | Exit desc search, clear name query, or abort | Normal |
| **In description search mode** |
| `a-z` | Add to desc query | Desc search |
| `backspace` | Remove from desc query | Desc search |
| `escape` / `return` | Exit desc search | Desc search |
| `↑` / `↓` | Navigate while searching | Desc search |
| `space` | Toggle even in desc search | Desc search |
| **Actions** |
| `ctrl+a` | Authenticate selected server | Normal |
| `ctrl+r` | Reconnect selected server | Normal |
| `ctrl+y` | Copy failure message to clipboard | Normal (if failed) |
| **Confirm/Abort** |
| `ctrl+s` (configurable) | Save changes and close | Normal |
| `ctrl+c` | Abort, discard all changes | Global |
| `escape` (with unsaved) | Show discard confirmation | Normal |

### Panel Events

**Inactivity Timeout:** 60 seconds → auto-close with "cancelled" result.

**Server Authentication Flow:**
1. User presses `enter` or `ctrl+a` on a needs-auth server
2. Panel calls `callbacks.authenticate(serverName)` (async, shows "Authenticating...")
3. OAuth flow runs (see § 1.6 for the command handler)
4. Panel receives result
5. If success: auto-reconnect, rebuild tools, show "Reconnected" notice
6. If fail: show error notice

**Server Reconnection:**
1. User presses `ctrl+r`
2. Panel calls `callbacks.reconnect(serverName)` (async, shows "connecting")
3. Command reconnect handler runs (see § 1.4)
4. Panel updates connection status
5. If connected: refresh tool cache, rebuild tool list
6. Cursor stays on server row

### Panel Result

**Type:** `McpPanelResult` (used as return from `done()`)

```typescript
interface McpPanelResult {
  cancelled: boolean;
  changes: Map<string, true | string[] | false>;
}
```

**Changes map:** Per-server tool filter changes:
- `true` → all tools direct
- `false` → no tools direct
- `string[]` → only these tools direct

**Callback:** `done(result)` — Called on save, abort, or timeout.

### Panel UI States

1. **Normal state** — list of servers, some expanded
2. **Search active** — filter servers/tools by name
3. **Desc search active** — filter by tool description
4. **Auth in progress** — "Authenticating servername..." notice
5. **Confirming discard** — two buttons: "Discard" vs "Keep & Close"

---

## 3. /MCP Setup Panel (Onboarding)

**File:** `mcp-setup-panel.ts` (667 lines)  
**Entry Point:** `createMcpSetupPanel()` factory function at line 645

### Setup Architecture

**Class:** `McpSetupPanel` (private, similar structure to McpPanel)

```typescript
export function createMcpSetupPanel(
  discovery: McpDiscoverySummary,
  callbacks: SetupPanelCallbacks,
  options: SetupPanelOptions,
  tui: { requestRender(): void },
  done: () => void,
): McpSetupPanel & { dispose(): void }
```

### Setup State

**Constructor:** Lines 56–72

```typescript
private screen: Screen;               // "empty" | "setup" | "imports" | "paths"
private actionCursor = 0;             // Selected action row
private importCursor = 0;             // Selected import in imports screen
private pathCursor = 0;               // Selected path in paths screen
private selectedImports = new Set<ImportKind>(); // Checkboxes
private busy = false;                 // Async action running?
private notice: { text; tone } | null; // Success/warning/muted message
private inactivityTimeout: ... | null;
```

### Setup Screens

#### 3.1 "Empty" Screen
Shown when: No MCP servers configured yet.

**Actions:**
- "Run setup" → transitions to "setup" screen
- "Adopt detected compatibility imports" (if imports found)
- "View example .mcp.json"
- "Scaffold project .mcp.json"
- etc.

#### 3.2 "Setup" Screen
Shown when: Initial `openMcpSetup(..., "setup")` or after clicking "Run setup".

**Actions list dynamically built** (lines 112–133):
1. "Adopt detected compatibility imports" (if any found)
2. "View example .mcp.json"
3. "Scaffold project .mcp.json"
4. "Explain config precedence"
5. "Open detected config paths"
6. **Known server presets** (from `config.ts` KNOWN_SERVER_PRESETS):
   - Each preset has `id`, `name`, `summary`, `entry`
   - Examples: "Claude Code", "Cursor", "Codex"
7. "Add RepoPrompt to shared MCP config" (if executable found)
8. "Close"

**Preview shown on right:** Depends on selected action
- Scaffolding: shows `.mcp.json` content
- Config precedence: shows read order
- Import: shows diff preview
- Known server: shows entry JSON

#### 3.3 "Imports" Screen
**Triggered by:** Action "Adopt detected compatibility imports"

**UI:**
```
[ ] claude-code    ~/.config/mcp/mcp.json
[x] cursor         ~/.cursor/mcp.json
[ ] codex          ~/.agents/mcp.json
```

- Space toggles checkbox
- Enter applies selection → calls `callbacks.adoptImports(selected)`
- Shows diff preview of what will be written

#### 3.4 "Paths" Screen
**Triggered by:** Action "Open detected config paths"

- Lists all discovered config files
- Enter opens file with file browser (via `openPath()`)

### Setup Keybindings

**Handler:** `handleInput(data: string)` — Lines 197–246

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate action list |
| `return` | Run selected action |
| `space` (imports) | Toggle checkbox |
| `return` (imports/paths) | Apply/open |
| `escape` | Back to setup screen (or close) |
| `ctrl+c` | Close immediately |

### Setup Callbacks

**Type:** `SetupPanelCallbacks` (10 functions)

```typescript
interface SetupPanelCallbacks {
  previewImports(imports: ImportKind[]): ConfigWritePreview;
  previewStarterProject(): ConfigWritePreview;
  previewRepoPrompt(): ConfigWritePreview | null;
  previewKnownServer(preset: KnownServerPreset): ConfigWritePreview;
  adoptImports(imports: ImportKind[]): Promise<{ added: ImportKind[]; path: string }>;
  scaffoldProjectConfig(): Promise<{ path: string }>;
  addRepoPrompt(): Promise<{ path: string; serverName: string }>;
  addKnownServer(preset: KnownServerPreset): Promise<{ path: string; serverName: string }>;
  openPath(targetPath: string): Promise<void>;
  markSetupCompleted(): void;
}
```

**ConfigWritePreview:**
```typescript
{
  path: string;
  existed: boolean;  // Was the file already there?
  diffText: string;  // Unified diff format
}
```

### Setup Result

**Type:** No return value — just calls `done()` when closed.

---

## 4. Status Display (`mcp-status.ts`)

**File:** 98 lines  
**Purpose:** Build a snapshot of MCP server status for event publishing (not a command).

### Functions

#### `createMcpStatusSnapshot(state): McpStatusSnapshot`
**Lines: 22–52**

Builds a read-only status object without querying servers:

```typescript
interface McpStatusSnapshot {
  version: 1;
  servers: McpServerStatusSnapshot[]; // Array of statuses
  totalTools: number;
  totalResources: number;
  connectedCount: number;
  disabledCount: number;
}

interface McpServerStatusSnapshot {
  name: string;
  status: "connected" | "needs-auth" | "failed" | "cached" | "not-connected" | "disabled";
  toolCount: number;
  resourceCount?: number;
  failedAgoSeconds?: number; // Age of last failure
  disabled: boolean;
}
```

**Implementation:**
- Loops through `state.config.mcpServers`
- For each server: gets connection from `state.manager.getConnection(name)`
- Reads tool metadata from `state.toolMetadata` cache
- Checks failure age from `state.failureTracker`
- Sums totals

#### `publishMcpStatusSnapshot(state, snapshot?)`
**Lines: 54–60**

Emits the snapshot to `state.statusEvents` (an event bus).

#### `publishMcpStatusShutdown(events)`
**Lines: 62–74**

Publishes a final shutdown snapshot with empty server list.

---

## 5. Keybinding Abstraction (`panel-keys.ts`)

**File:** 47 lines  
**Purpose:** Decouple panels from hardcoded keybindings.

### Functions

#### `createPanelKeys(keybindings?: PanelKeybindings): PanelKeys`
**Lines: 33–59**

Returns an object with 5 methods:
- `selectUp(data): boolean`
- `selectDown(data): boolean`
- `selectConfirm(data): boolean`
- `save(data): boolean`
- `saveLabel(): string | null`

**Logic:**
- If `keybindings` manager provided: resolve each action via `keybindings.matches(data, "tui.select.X")`
- Otherwise: use hardcoded defaults (`up`, `down`, `return`, `ctrl+s`)
- Special handling for "save": check user bindings for `mcp.panel.save`; if not configured, fallback to `ctrl+s`

**Type:** `PanelKeybindings` is a structural subset of pi-tui's KeybindingsManager, so panels work with either a full manager or stub object.

---

## 6. HTTP Request Headers Command (`request-headers-command.ts`)

**File:** 371 lines  
**Purpose:** Utility for servers that need dynamic HTTP headers (OAuth tokens, etc.).

### Entry Point

#### `createRequestHeadersCommandFetch(config, delegate?): FetchLike`
**Lines: 250–284**

Wraps `fetch()` to inject headers from a trusted subprocess.

**Flow:**
1. User provides `HttpRequestHeadersCommand` config (command + args)
2. Wraps delegate fetch
3. For each request:
   - Clone request, extract body
   - Spawn command with JSON envelope (method, url, body)
   - Command returns JSON headers object
   - Merge headers into request
   - Forward to delegate fetch

**Config validation:** Lines 216–244
```typescript
interface HttpRequestHeadersCommand {
  command: string;        // e.g. "oauth-token-getter"
  args?: string[];        // Command args
  env?: Record<string, string>; // Extra env vars
  timeoutMs?: number;     // Default 10s, max 60s
}
```

### Process Management

**Cross-platform cleanup:**
- **POSIX:** Uses `SIGSTOP` to freeze process tree, tracks descendants via `ps`, then `SIGKILL`
- **Windows:** Uses `taskkill /pid <pid> /T /F`
- **Timeout:** 10s default, configurable
- **Output limit:** 64 KiB stdout max
- **Cleanup token:** UUID injected as env var to find long-lived children

---

## 7. TUI Component Usage

### Pi-TUI Components Used

| Component | Where | Purpose |
|-----------|-------|---------|
| `matchesKey(data, keyId)` | panel-keys.ts, mcp-panel.ts | Key matching (ANSI input parsing) |
| `truncateToWidth(text, width, suffix)` | mcp-panel.ts, mcp-setup-panel.ts | Text truncation for box borders |
| `visibleWidth(text)` | mcp-panel.ts, mcp-setup-panel.ts | Width accounting for ANSI codes |
| `ctx.ui.custom(render, options)` | commands.ts (line 370, 510) | Open TUI panel as overlay |
| `ctx.ui.notify(message, tone)` | commands.ts, mcp-panel.ts | Text notification (info/error/warning) |
| `ctx.ui.setStatus(channel, text)` | commands.ts (line 251) | Status bar update |
| `ctx.ui.input(title, prompt, options)` | commands.ts (line 267) | Text input dialog |
| `ctx.ui.confirm(title, message, options)` | commands.ts (line 262) | Yes/no dialog |
| `copyToClipboard(text)` | mcp-panel.ts (line 948) | Clipboard copy |

### Rendering Pattern: Raw String Array

Both panels use a **raw string array rendering** model:

```typescript
class McpPanel {
  render(width: number): string[] {
    const lines: string[] = [];
    lines.push("┌─── Title ───┐");
    lines.push("│ Content      │");
    lines.push("└──────────────┘");
    return lines;
  }
}
```

**No SelectList or Container components** — purely ANSI-colored strings.

**Helper utilities:**
- `fg(colorCode, text)` — wraps text in ANSI codes
- `truncateToWidth()` — handles East Asian widths (double-width chars)
- `visibleWidth()` — counts visible chars excluding ANSI

### Overlay Configuration

Both panels use `ctx.ui.custom()` with these options:

```typescript
ctx.ui.custom(
  (tui, _theme, keybindings, done) => { /* ... */ },
  { 
    overlay: true,
    overlayOptions: { 
      anchor: "center",
      width: 82  // or 92 for setup
    }
  }
)
```

**Callback signature:**
```typescript
type RenderFn = (
  tui: { requestRender(): void },
  theme: any,                    // Unused by adapter
  keybindings: PanelKeybindings,
  done: (value?: any) => void
) => { handleInput(data: string): void; render(width: number): string[]; dispose(): void }
```

---

## 8. Command Registration

**Not in these files.** Command handlers are imported/registered in another file (likely `init.ts` or `index.ts`).

**Signature:** Handlers take `(state, pi, ctx, ...args)` and return `Promise<void | PanelFlowResult>`.

**Examples from `commands.ts` exports:**
- `showStatus(state, ctx): Promise<void>`
- `openMcpPanel(state, pi, ctx, configOverridePath?): Promise<PanelFlowResult>`
- `authenticateServer(serverName, config, ctx): Promise<McpAuthResult>`

---

## 9. Summary of Architecture

### Command → Panel Flow

```
/mcp setup
  ↓
openMcpSetup()
  ├─ Load discovery config
  ├─ Create 10 callbacks (adoptImports, scaffoldProjectConfig, etc.)
  ├─ ctx.ui.custom(createMcpSetupPanel(...))
  └─ Returns PanelFlowResult { configChanged: boolean }

/mcp panel
  ↓
openMcpPanel()
  ├─ Check no servers → redirect to setup
  ├─ Load cache + provenance
  ├─ Create 6 callbacks (reconnect, authenticate, etc.)
  ├─ ctx.ui.custom(createMcpPanel(...))
  └─ On close: write direct tools config, call onDirectToolsConfigChanged?()

/mcp-auth <server>
  ↓
authenticateServer()
  ├─ Validate OAuth support
  ├─ Call mcp-auth-flow.authenticate() with UI callbacks
  └─ Return McpAuthResult { ok: boolean; message: string }

/mcp reconnect [server]
  ↓
reconnectServer() or reconnectServers()
  ├─ Close old connection
  ├─ Connect with signal handling
  ├─ Build tool metadata
  └─ Return boolean (success)
```

### Panel Architecture Pattern

```
Command Handler
  ↓
createMcpSetupPanel() / createMcpPanel()
  ├─ Private class (McpSetupPanel / McpPanel)
  ├─ Constructor: build ServerState[] or ActionState
  ├─ handleInput(data): modify state
  ├─ render(width): string[]
  ├─ dispose(): cleanup
  └─ Returns { handleInput, render, dispose }

ctx.ui.custom() subscribes to:
  - handleInput() → called on each keystroke
  - render(width) → called after state changes
  - dispose() → called when panel closes
```

---

## 10. Over-engineered vs. Essential Features

### Essential for Port

✅ **Core command handlers** (open, auth, status, reconnect)  
✅ **Panel state machine** (servers, tools, search, dirty tracking)  
✅ **Keybinding abstraction** (allows custom keys)  
✅ **Result type** (save changes on exit)  
✅ **Inactivity timeout** (auto-close after 60s)  
✅ **Search functionality** (name + description)  

### Complex But Possibly Simplifiable

⚠️ **Rainbow progress bars** (lines 67–75 of mcp-panel.ts) — purely cosmetic, could be a simple percentage  
⚠️ **Fuzzy scoring algorithm** (lines 47–63 of mcp-panel.ts) — overkill for panel filters, simple substring match sufficient  
⚠️ **Text wrapping and width calculation** (multiple places) — essential for responsive UI, hard to simplify  
⚠️ **HTTP request headers command** (entire file) — only needed if servers use dynamic auth; could be optional  
⚠️ **Process tree cleanup** (request-headers-command.ts) — complex POSIX descendant tracking; simpler approach: just kill main PID + wait  

### Candidates for Removal

❌ **mcp-status.ts** — Used for event publishing; not essential for basic panel functionality  
❌ **Resource tool generation** (mcp-panel.ts lines 204–221) — converts resources to tools; nice-to-have but adds UI complexity  
❌ **Import/preset system** (mcp-setup-panel.ts) — nice onboarding, but core could just prompt for `.mcp.json` path  
❌ **Provenance tracking** (server source: "user" | "project" | "import") — informational only; not needed for core  

### Ports Likely to Add

🔧 **Database/filesystem integration** — Pi uses file discovery; may need to adapt for different config paths  
🔧 **Plugin system** — Adapter supports "compatibility imports" from host tools; plugin system may differ  
🔧 **State persistence** — Onboarding state ("setup completed") may map to different storage  

---

## 11. File Structure & Dependencies

```
commands.ts
  ├─ imports: config.ts (discovery, schema), init.ts (state updates), metadata-cache.ts, tool-metadata.ts, mcp-auth-flow.ts
  ├─ exports: showStatus, showPrompts, showTools, reconnectServer*, authenticateServer, openMcpSetup, openMcpPanel, openMcpAuthPanel
  └─ uses: ctx.ui.custom(), ctx.ui.notify(), ctx.ui.input(), ctx.ui.confirm()

mcp-panel.ts
  ├─ imports: panel-keys.ts, types.ts, resource-tools.ts, metadata-cache.ts, ui-tool-visibility.ts
  ├─ exports: createMcpPanel
  ├─ class: McpPanel (1000+ lines)
  └─ uses: ANSI color codes, truncateToWidth(), visibleWidth(), copyToClipboard()

mcp-setup-panel.ts
  ├─ imports: panel-keys.ts, config.ts (KNOWN_SERVER_PRESETS, ConfigWritePreview), agent-dir.ts
  ├─ exports: createMcpSetupPanel
  ├─ class: McpSetupPanel (600+ lines)
  └─ uses: wrapText helper (local)

mcp-status.ts
  ├─ imports: types.ts
  ├─ exports: createMcpStatusSnapshot, publishMcpStatusSnapshot, publishMcpStatusShutdown
  └─ no UI dependencies

panel-keys.ts
  ├─ imports: @earendil-works/pi-tui
  ├─ exports: createPanelKeys
  └─ utility-only (no state)

request-headers-command.ts
  ├─ imports: node:child_process, crypto
  ├─ exports: createRequestHeadersCommandFetch
  └─ standalone utility (HTTP/auth related)
```

---

## 12. Key Implementation Details

### Failure Tracking

State maintains `failureTracker: Map<string, number>` (serverName → timestamp).

Used by:
- `getFailureAgeSeconds()` — returns age or null if backoff expired (60s)
- `getFailureMessage()` — stored separately in another map
- `recordFailure()` — called on reconnect error
- `clearFailure()` — called on successful reconnect

### Direct Tools Config

A "direct tool" is one explicitly exposed to the LLM model (vs. in cache but hidden).

**Config structure** (server definition):
```typescript
directTools?: boolean | string[];  // true=all, false=none, string[]=list
```

**Panel changes** (McpPanelResult):
```typescript
changes: Map<string, true | string[] | false>
```

**Write logic** (commands.ts line 520):
```typescript
writeDirectToolsConfig(result.changes, provenanceMap, config);
```

### Tool Visibility Filtering

Multiple layers:
1. `isUiToolVisibleToModel()` — global UI visibility (default hidden tools)
2. `isToolAllowed()` — server-level include/exclude list
3. `getToolNameCandidates()` — name collision detection (if other servers export same name)

---

## 13. Keybinding Configuration Flow

**Default keybindings** (panel-keys.ts):
- Navigate: `up` / `down`
- Select: `return`
- Save: `ctrl+s`

**User override:**
1. `keybindings` parameter passed to `createPanelKeys()`
2. Panel checks `keybindings.getUserBindings().["mcp.panel.save"]` or `["tui.select.X"]`
3. If configured: use user binding
4. If not: fall back to default

**Binding resolution:**
- Pi-tui's `KeybindingsManager` implements `PanelKeybindings` interface
- Panel calls `keybindings.matches(data, "tui.select.up")` for each keystroke
- Manager resolves to actual key sequence and compares

---

## 14. Potential Port Issues & Considerations

### 1. **UI Framework Dependency**
- Pi uses `ctx.ui.custom()` to inject render function + keybindings manager
- **Port question:** Does your host support custom overlays? If not, may need to route through host's modal system

### 2. **ANSI Color Handling**
- Heavy use of truecolor ANSI (`\x1b[38;2;R;G;Bm`) for rainbow progress
- **Port issue:** Some terminals don't support truecolor; fallback to 256-color ANSI codes

### 3. **Process Cleanup (Windows vs POSIX)**
- `request-headers-command.ts` has two completely different cleanup paths
- **Port issue:** If porting to non-Node runtime, may need complete rewrite

### 4. **Config File Discovery**
- `config.ts` does heavy lifting: detects `.mcp.json`, `~/.agents/mcp.json`, host-specific configs (Cursor, Claude Code, etc.)
- **Port issue:** Different OS paths / home directory resolution

### 5. **Key Collision Detection**
- Tool names across servers checked via `getToolNameCandidates()` and `getOtherCurrentCandidates()`
- **Port issue:** Needed if port supports multiple servers; simplify if only one server

### 6. **Fuzzy Search**
- `fuzzyScore()` (lines 47–63) used for both name and description search
- **Port issue:** Could be simplified to substring match for faster iteration

### 7. **Inactivity Timeout**
- Panels auto-close after 60 seconds with "cancelled" result
- **Port issue:** May not be desired in all contexts (e.g., automated testing); should be configurable

---

## Appendix A: Type Definitions

### Command Result Types

```typescript
interface PanelFlowResult {
  configChanged: boolean;
}

interface McpPanelResult {
  cancelled: boolean;
  changes: Map<string, true | string[] | false>;
}

interface McpAuthResult {
  ok: boolean;
  message: string;
}

interface McpStatusSnapshot {
  version: 1;
  servers: McpServerStatusSnapshot[];
  totalTools: number;
  totalResources: number;
  connectedCount: number;
  disabledCount: number;
}
```

### Callback Types

```typescript
interface McpPanelCallbacks {
  reconnect(serverName: string): Promise<boolean>;
  canAuthenticate(serverName: string): boolean;
  authenticate(serverName: string): Promise<McpAuthResult>;
  getConnectionStatus(serverName: string): ConnectionStatus;
  getFailureMessage?(serverName: string): string | null;
  refreshCacheAfterReconnect(serverName: string): ServerCacheEntry | null;
}

interface SetupPanelCallbacks {
  previewImports(imports: ImportKind[]): ConfigWritePreview;
  previewStarterProject(): ConfigWritePreview;
  previewRepoPrompt(): ConfigWritePreview | null;
  previewKnownServer(preset: KnownServerPreset): ConfigWritePreview;
  adoptImports(imports: ImportKind[]): Promise<{ added: ImportKind[]; path: string }>;
  scaffoldProjectConfig(): Promise<{ path: string }>;
  addRepoPrompt(): Promise<{ path: string; serverName: string }>;
  addKnownServer(preset: KnownServerPreset): Promise<{ path: string; serverName: string }>;
  openPath(targetPath: string): Promise<void>;
  markSetupCompleted(): void;
}
```

---

**End of Report**
