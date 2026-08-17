# Pi Native TUI Rendering — Research Reference

> **Date:** 2025-07-10  
> **Scope:** Pi coding agent extension API for native TUI tool rendering  
> **Packages studied:** `packages/subagent`, `packages/diff`  
> **Purpose:** Reference document for implementing native TUI rendering in a new MCP package

---

## Table of Contents

1. [Core Rendering API](#1-core-rendering-api)
2. [Subagent Package — Text-Only Pattern](#2-subagent-package--text-only-pattern)
3. [Diff Package — Box + renderShell Pattern](#3-diff-package--box--rendershell-pattern)
4. [Theme Token Reference](#4-theme-token-reference)
5. [Component API Reference](#5-component-api-reference)
6. [Tool Override Findings](#6-tool-override-findings)
7. [MCP Proxy Tool Args Shape](#7-mcp-proxy-tool-args-shape)
8. [Direct Tool Naming and Registration](#8-direct-tool-naming-and-registration)
9. [Recommended Pattern for a New MCP Package](#9-recommended-pattern-for-a-new-mcp-package)
10. [Key Best Practices](#10-key-best-practices)

---

## 1. Core Rendering API

Pi exposes three render hooks for tool override renderers. All are optional callbacks on the object passed to `registerTool` (or the equivalent override registration).

### 1.1 Hook Signatures

```typescript
interface ToolRenderer {
  renderCall?: (context: ToolRenderContext) => ComponentChild;
  renderResult?: (context: ToolRenderContext) => ComponentChild;
  renderShell?: "self" | string;   // controls whether Pi wraps the output in its own Box
}
```

### 1.2 `ToolRenderContext`

The context object passed to both `renderCall` and `renderResult`:

```typescript
interface ToolRenderContext {
  args: Record<string, unknown>;   // parsed tool call arguments
  result?: unknown;                // present only in renderResult
  isPartial?: boolean;             // true while streaming (result not yet complete)
  invalidate?: () => void;         // trigger a TUI repaint (alias: ctx.invalidate())
  theme: Theme;                    // full theme token bag
  // Additional fields may exist; treat as opaque beyond these
}
```

> **Important:** Always access args via `context.args`, not `context.input` or `context.params`. The field is `args`.

### 1.3 `renderShell`

| Value | Behaviour |
|-------|-----------|
| `undefined` / omitted | Pi wraps the renderer output in its default tool Box (header, border, padding) |
| `"self"` | Pi renders the output **as-is** — no wrapper Box, no automatic header/border |
| Other string | Reserved / not yet documented |

When `renderShell: "self"` is set, **your renderer must provide its own `Box`** (or other container) to handle padding and border.

---

## 2. Subagent Package — Text-Only Pattern

### 2.1 File location

```
packages/subagent/src/render.ts
packages/subagent/src/index.ts
```

### 2.2 Design decisions

- **No `renderShell`** — lets Pi apply its default Box wrapper.
- **Text-only output** — never constructs a `Box` or any layout container.
- **`lastComponent` reuse** — a module-level variable holds the last returned component. On update calls the same `Text` instance is mutated (via `.setText()`) and returned again, avoiding GC churn.
- **Streaming via `onUpdate`** — the subagent dispatches incremental content; `renderResult` is called repeatedly with `isPartial: true`. Each call updates the shared `Text` and returns it.

### 2.3 Skeleton (simplified)

```typescript
import { Text } from "@earendil-works/pi-coding-agent/tui";

let lastComponent: Text | null = null;

function renderCall(ctx: ToolRenderContext): ComponentChild {
  const label = String(ctx.args.prompt ?? ctx.args.task ?? "");
  lastComponent = new Text(label, 0, 0);   // padding x=0, y=0
  return lastComponent;
}

function renderResult(ctx: ToolRenderContext): ComponentChild {
  const output = String(ctx.result ?? "");

  if (lastComponent) {
    lastComponent.setText(output);          // mutate in place
    return lastComponent;
  }

  lastComponent = new Text(output, 0, 0);
  return lastComponent;
}

// No renderShell — Pi uses its own default Box
export const renderer = { renderCall, renderResult };
```

### 2.4 Streaming update cycle

```
Tool call starts
  → renderCall() called once → returns Text("dispatching…")
  → Pi shows default Box wrapper around the Text

Agent streams output:
  → renderResult(ctx where isPartial=true) called repeatedly
  → lastComponent.setText(newContent) + return lastComponent
  → Pi repaints TUI with updated text

Agent finishes:
  → renderResult(ctx where isPartial=false) called once more
  → Final content rendered
```

---

## 3. Diff Package — Box + renderShell Pattern

### 3.1 File location

```
packages/diff/src/render.ts
packages/diff/src/DiffComponent.ts
packages/diff/src/index.ts
```

### 3.2 Design decisions

- **`renderShell: "self"`** — full ownership of the Box/border/padding.
- **`DiffComponent`** — a custom component class that owns the Shiki highlight state.
- **Async Shiki** — syntax highlighting is asynchronous; `ctx.invalidate()` is called once highlighting resolves to trigger a repaint.
- **`ctx.invalidate()`** — the mechanism to force a TUI repaint after an async operation completes.

### 3.3 Skeleton (simplified)

```typescript
import { Box, Text } from "@earendil-works/pi-coding-agent/tui";
import { highlight } from "shiki";

class DiffComponent {
  private box: Box;
  private text: Text;
  private highlighted = false;

  constructor(diff: string, ctx: ToolRenderContext) {
    this.text = new Text(diff, 0, 0);
    this.box = new Box([this.text], /* border options */);

    // Async highlight — invalidate when done
    highlight(diff).then((html) => {
      this.text.setText(html);
      this.highlighted = true;
      ctx.invalidate();              // ← triggers TUI repaint
    });
  }

  render(): ComponentChild {
    return this.box;
  }
}

let lastComponent: DiffComponent | null = null;

function renderResult(ctx: ToolRenderContext): ComponentChild {
  const diff = String(ctx.result ?? "");

  if (!lastComponent) {
    lastComponent = new DiffComponent(diff, ctx);
  }

  return lastComponent.render();
}

export const renderer = {
  renderResult,
  renderShell: "self" as const,    // we own the Box
};
```

### 3.4 `ctx.invalidate()` pattern

```typescript
// Call invalidate() INSIDE an async callback, not synchronously
someAsyncOperation().then((result) => {
  this.updateState(result);
  ctx.invalidate();   // signals Pi to call renderResult again and repaint
});
```

> **Warning:** Never call `ctx.invalidate()` synchronously during the render itself — this will cause a render loop.

---

## 4. Theme Token Reference

Accessed via `ctx.theme` in any render hook. All tokens are hex strings or ANSI codes.

### 4.1 Foreground (`fg`) colors

| Token | Description |
|-------|-------------|
| `ctx.theme.fg.primary` | Primary text color |
| `ctx.theme.fg.secondary` | Dimmed / secondary text |
| `ctx.theme.fg.muted` | Very dim / hint text |
| `ctx.theme.fg.accent` | Accent / highlight color |
| `ctx.theme.fg.success` | Success / green |
| `ctx.theme.fg.warning` | Warning / yellow |
| `ctx.theme.fg.error` | Error / red |
| `ctx.theme.fg.info` | Info / blue |

### 4.2 Background (`bg`) colors

| Token | Description |
|-------|-------------|
| `ctx.theme.bg.primary` | Primary background |
| `ctx.theme.bg.secondary` | Secondary / panel background |
| `ctx.theme.bg.accent` | Accent background |
| `ctx.theme.bg.success` | Success background |
| `ctx.theme.bg.warning` | Warning background |
| `ctx.theme.bg.error` | Error background |
| `ctx.theme.bg.info` | Info background |

### 4.3 Usage example

```typescript
function renderCall(ctx: ToolRenderContext): ComponentChild {
  const label = new Text(
    `[MCP] ${ctx.args.tool_name}`,
    0, 0,
    { color: ctx.theme.fg.accent }
  );
  return label;
}
```

---

## 5. Component API Reference

All components imported from `@earendil-works/pi-coding-agent/tui` (or the equivalent Pi TUI sub-path).

### 5.1 `Text`

The fundamental leaf component. Renders a plain string.

```typescript
new Text(content: string, paddingX: number, paddingY: number, options?: TextOptions)
```

| Method | Description |
|--------|-------------|
| `.setText(s: string)` | Replace displayed text in-place |
| `.getText()` | Return current text |
| `.setColor(color: string)` | Set foreground color |

**`TextOptions`:**

```typescript
interface TextOptions {
  color?: string;       // hex or ANSI color
  bold?: boolean;
  italic?: boolean;
  wrap?: boolean;       // default: true
}
```

### 5.2 `Box`

A layout container with optional border and padding.

```typescript
new Box(children: ComponentChild[], options?: BoxOptions)
```

| Method | Description |
|--------|-------------|
| `.addChild(c: ComponentChild)` | Append a child |
| `.removeChild(c: ComponentChild)` | Remove a child |
| `.setChildren(cs: ComponentChild[])` | Replace all children |
| `.setBorder(opts: BorderOptions)` | Update border style |
| `.setVisible(v: boolean)` | Show/hide |

**`BoxOptions`:**

```typescript
interface BoxOptions {
  direction?: "row" | "column";  // default: "column"
  padding?: number | [number, number];
  border?: BorderOptions;
  width?: number | "full";
  height?: number;
}
```

### 5.3 `Container`

A transparent wrapper (no styling) used to group components without adding visual noise.

```typescript
new Container(children: ComponentChild[])
```

| Method | Description |
|--------|-------------|
| `.addChild(c)` | Append |
| `.setChildren(cs)` | Replace all |

### 5.4 `Spacer`

Inserts vertical or horizontal whitespace.

```typescript
new Spacer(size: number, direction?: "vertical" | "horizontal")
```

### 5.5 `Markdown`

Renders a markdown string with inline formatting (bold, italic, code spans, headings).

```typescript
new Markdown(content: string, paddingX: number, paddingY: number)
```

| Method | Description |
|--------|-------------|
| `.setContent(s: string)` | Replace markdown content |

### 5.6 `DynamicBorder`

A Box-like component where the border style can change at runtime (e.g., to indicate state).

```typescript
new DynamicBorder<T extends BorderState>(initialState: T, options?: DynamicBorderOptions)
```

> **Gotcha:** Always provide the explicit type parameter `<T>`. Without it, TypeScript infers `unknown` and you lose enum safety on the state transitions.

| Method | Description |
|--------|-------------|
| `.setState(state: T)` | Transition border to a new state |
| `.setChildren(cs)` | Replace inner children |

---

## 6. Tool Override Findings

### 6.1 First-registration-wins

When two packages both call `registerTool` (or the override equivalent) for the **same tool name**, whichever registers **first wins**. The second registration is silently ignored.

**Implication:** Load order matters. `meta/src/index.ts` controls import order; earlier imports take precedence.

### 6.2 Load order in `meta/src/index.ts`

```
core → ask → todo → notify → session-name → footer → diff → image-paste → subagent → (new packages last)
```

A new package appended at the end will always lose any tool name collision with earlier packages.

### 6.3 No rendering inheritance for non-builtins

Pi's built-in tools (e.g., `edit_file`, `read_file`) have first-class rendering slots that can be overridden by any package. However, **non-builtin tools** (registered by extensions) do **not** inherit any rendering from other packages — each package is fully responsible for its own tool renderers.

### 6.4 `getAllTools()` returns `ToolInfo`, not `ToolDefinition`

The Pi API function `getAllTools()` returns an array of `ToolInfo` objects:

```typescript
interface ToolInfo {
  name: string;
  description: string;
  // Does NOT include the full JSON Schema / inputSchema
}
```

It does **not** return `ToolDefinition` (which would include the `inputSchema` / `parameters` field). If you need the schema, you must have it from another source (e.g., the MCP server's tool list response or a local constant).

---

## 7. MCP Proxy Tool Args Shape

When Pi proxies an MCP tool call, it passes a structured `McpProxyToolCallInput` object as `context.args`. This is a **13-field schema**:

```typescript
interface McpProxyToolCallInput {
  // The MCP server's tool name (snake_case)
  tool_name: string;

  // The MCP server identifier
  server_name: string;

  // The raw arguments object to forward to the MCP server
  arguments: Record<string, unknown>;

  // --- Metadata fields (always present but may be empty/null) ---
  call_id: string;
  session_id: string;
  user_id: string;
  agent_id: string;
  trace_id: string;

  // Timing
  timestamp: string;        // ISO 8601

  // Result fields (populated in renderResult context)
  result?: unknown;
  error?: string;
  duration_ms?: number;
  is_partial?: boolean;     // true while streaming
}
```

> **Note:** Field count and exact names may vary across Pi versions. Treat `tool_name`, `server_name`, and `arguments` as stable; audit others at integration time.

### 7.1 Accessing MCP args in a renderer

```typescript
function renderCall(ctx: ToolRenderContext): ComponentChild {
  const { tool_name, server_name, arguments: toolArgs } = ctx.args as McpProxyToolCallInput;
  const label = `[${server_name}] ${tool_name}`;
  return new Text(label, 0, 0);
}

function renderResult(ctx: ToolRenderContext): ComponentChild {
  const { tool_name, result, is_partial } = ctx.args as McpProxyToolCallInput;
  const content = is_partial ? "…loading…" : JSON.stringify(result, null, 2);
  return new Text(`${tool_name}\n${content}`, 0, 0);
}
```

---

## 8. Direct Tool Naming and Registration

### 8.1 Naming format

Pi exposes MCP tools via direct tool names in the format:

```
<serverName>_<toolName>
```

Examples:
- `atlassian_jira_create_issue`
- `github_create_pull_request`
- `filesystem_read_file`

Both parts use the server's own naming convention (typically `snake_case`).

### 8.2 Registration mechanism

To override the rendering of an MCP-proxied tool, register using the direct name:

```typescript
import { registerToolRenderer } from "@earendil-works/pi-coding-agent";

registerToolRenderer("atlassian_jira_create_issue", {
  renderCall(ctx) { /* … */ },
  renderResult(ctx) { /* … */ },
  // renderShell omitted → Pi uses default Box wrapper
});
```

> This is distinct from `registerTool` (which registers a new tool). The override API registers renderers for **existing** tools (builtins or MCP proxies).

### 8.3 Discovery approach

To find all MCP tool names available at runtime:

```typescript
import { getAllTools } from "@earendil-works/pi-coding-agent";

const tools = getAllTools();
// tools[n].name is the direct tool name (e.g., "atlassian_jira_create_issue")
```

---

## 9. Recommended Pattern for a New MCP Package

### 9.1 Pattern A — Text-only, default Box shell (RECOMMENDED)

This is the simplest and most compatible approach. Mirrors what `packages/subagent` does.

**When to use:** Any tool that displays text output without complex layout requirements.

```typescript
// packages/<name>/src/render.ts

import type { ToolRenderContext, ComponentChild } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-coding-agent/tui";

let lastComponent: Text | null = null;

export function renderCall(ctx: ToolRenderContext): ComponentChild {
  const toolName = String((ctx.args as any).tool_name ?? ctx.args.name ?? "tool");
  lastComponent = new Text(`⚙ ${toolName} …`, 0, 0);
  return lastComponent;
}

export function renderResult(ctx: ToolRenderContext): ComponentChild {
  const result = ctx.result;
  const isPartial = Boolean((ctx.args as any).is_partial ?? ctx.isPartial);
  const content = isPartial
    ? "⏳ Streaming…"
    : typeof result === "string"
      ? result
      : JSON.stringify(result, null, 2);

  if (lastComponent) {
    lastComponent.setText(content);
    return lastComponent;
  }

  lastComponent = new Text(content, 0, 0);
  return lastComponent;
}

// No renderShell — let Pi use its default Box
```

```typescript
// packages/<name>/src/index.ts

import { registerToolRenderer } from "@earendil-works/pi-coding-agent";
import { renderCall, renderResult } from "./render.js";

export function register() {
  registerToolRenderer("my_server_my_tool", { renderCall, renderResult });
}
```

### 9.2 Pattern B — Custom Box with `renderShell: "self"`

**When to use:** Rich layout, syntax highlighting, multi-panel display, or when you need full control over borders.

```typescript
export function renderResult(ctx: ToolRenderContext): ComponentChild {
  const content = String(ctx.result ?? "");
  const box = new Box(
    [new Text(content, 1, 0)],
    { border: { style: "round" }, padding: 1 }
  );
  return box;
}

export const renderer = {
  renderCall,
  renderResult,
  renderShell: "self" as const,
};
```

### 9.3 Pattern comparison

| Aspect | Pattern A (Text-only) | Pattern B (Box + renderShell) |
|--------|-----------------------|-------------------------------|
| Complexity | Low | Medium–High |
| Layout control | None (Pi wraps) | Full |
| Border/padding | Pi default | Custom |
| Async repaint | N/A | `ctx.invalidate()` |
| Best for | Simple text/JSON output | Syntax highlight, tables, rich UI |
| Matches | `packages/subagent` | `packages/diff` |

---

## 10. Key Best Practices

### 10.1 `Text(0, 0)` padding convention

Always use `0, 0` for padding on `Text` nodes — Pi's default Box wrapper already provides spacing. Adding extra padding causes double-indented output.

```typescript
// ✅ Correct
new Text(content, 0, 0)

// ❌ Avoid
new Text(content, 1, 1)   // double-padding when Pi wraps it
```

### 10.2 `lastComponent` reuse

Keep a module-level variable and mutate it in-place rather than constructing new components on every `renderResult` call. This prevents GC pressure during streaming and avoids TUI flicker.

```typescript
let lastComponent: Text | null = null;

function renderResult(ctx) {
  if (lastComponent) {
    lastComponent.setText(newContent);   // ✅ mutate
    return lastComponent;               // ✅ same ref
  }
  lastComponent = new Text(newContent, 0, 0);
  return lastComponent;
}
```

### 10.3 Always use `context.args` (not `context.input`)

The field containing parsed tool arguments is `context.args`. Using `context.input` or `context.params` will give `undefined`.

```typescript
// ✅
const toolName = ctx.args.tool_name;

// ❌
const toolName = (ctx as any).input?.tool_name;
```

### 10.4 `isPartial` handling

Check `isPartial` (or `is_partial` inside MCP proxy args) before rendering final output. Show a loading indicator while partial to avoid jarring incomplete content.

```typescript
function renderResult(ctx: ToolRenderContext) {
  if (ctx.isPartial) {
    return new Text("⏳ …", 0, 0);
  }
  return new Text(formatResult(ctx.result), 0, 0);
}
```

### 10.5 `DynamicBorder` explicit type parameter

Always provide the type parameter when using `DynamicBorder`. Without it, TypeScript infers `unknown` for the state and you lose compile-time safety.

```typescript
type BorderState = "idle" | "loading" | "error";

// ✅
const border = new DynamicBorder<BorderState>("idle");
border.setState("loading");   // type-checked

// ❌
const border = new DynamicBorder("idle");   // state inferred as string literal, methods not type-safe
```

### 10.6 `ctx.invalidate()` — async only, never synchronous

```typescript
// ✅ Correct — inside async callback
someAsyncOperation().then(() => {
  this.updateState(result);
  ctx.invalidate();
});

// ❌ Wrong — synchronous invalidate causes render loop
function renderResult(ctx) {
  ctx.invalidate();   // NEVER do this
  return new Text("…", 0, 0);
}
```

### 10.7 Register at top level of `register()`, not inside `session_start`

Per AGENTS.md convention, all `registerToolRenderer` calls must be made at the **top level** of your `register()` function, not nested inside a `session_start` event handler. Nested registration causes handler accumulation on `/reload`.

```typescript
// ✅
export function register() {
  registerToolRenderer("my_tool", renderer);
  // NOT inside session.on("session_start", …)
}
```

---

## Sources and File References

| File | Notes |
|------|-------|
| `packages/subagent/src/render.ts` | Text-only, lastComponent, no renderShell |
| `packages/subagent/src/index.ts` | registerToolRenderer call site |
| `packages/diff/src/render.ts` | renderShell: "self", DiffComponent, ctx.invalidate |
| `packages/diff/src/DiffComponent.ts` | Shiki async highlight component |
| `packages/diff/src/index.ts` | register() entry point |
| `meta/src/index.ts` | Load order for all packages |
| `AGENTS.md` | Event handler registration rule, monorepo conventions |

---

*Generated from a research session exploring Pi's native TUI rendering API for the pi-archimedes monorepo.*
