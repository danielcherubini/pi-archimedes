# UI Package

TUI enhancements for the Pi Archimedes monorepo.

## Features

### Bash Tool Styling
- **Collapsed/Expanded Views**: Toggleable tool execution details.
- **Live Timer**: Track tool execution duration.
- **Status Indicators**:
  - `▸` Running (Orange)
  - `✓` Success (Green)
  - `✗` Error (Red)

### Codemode Tool Styling
- **Styling follows the `toolStyle` master switch**:
  - **Minimal** (default): the override is registered — the collapsed row is the `codemode` header plus the nested tool calls the script made (last five, with an expand hint when there are more) — no script dump, no summary line. A script that made no calls shows a single `<glyph> <duration>` line instead.
  - **Native**: the override is not registered at all — pi's native codemode rendering stands (and no built-in-takeover startup notice).
- **Expanded View**: The syntax-highlighted script, every nested call (status glyph, args, duration, and cost for `models.*` calls, with a `Model calls: $total` line when several were priced), the script output without the executor's `Script completed/failed` header, the full-output path when truncated, and the timing + final status.
- **Live Timer**: In-flight calls show the `…` running glyph and update every second.
- **Native Behaviour Preserved**: The override re-registers pi's own `codemode` tool (executor, dynamic description, activation semantics all intact) and replaces only the presentation — so it takes over pi's replaceable built-in `codemode` extension (pi prints a one-line startup notice, as it does for any extension that replaces a built-in).
- **Graceful Fallback**: On pi versions without the `codemode` extension the override is a no-op and pi's native rendering stands in.

### Editor
- **HephaestusEditor**: Advanced text editing capabilities.
- **Border Spinner Animations**: Visual feedback during operations.
- **Spin Quips**: Enjoyable messages while waiting for processes.

### Thinking
- **Full/Compact Output Style**: Full or one-line thinking (`thinkingStyle`). The tool-side master switch is `toolStyle` (Minimal = archimedes styled, Native = no archimedes tool styling).
- **Collapsible Thinking**: Expandable for deeper inspection.
- **Theme**: Unified styling for thinking blocks.

### Startup
- **Splash Logo Reveal**: Engaging animations during initialization.

## Settings (`archimedes.ui`)

| Setting | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `bashToolStyling` | boolean | `true` | Custom styled bash tool rendering (applies when `toolStyle` is Minimal) |
| `codemodeToolStyling` | boolean | `true` | Custom styled codemode tool rendering (applies when `toolStyle` is Minimal) while keeping the native executor |
| `mutedTheme` | boolean | `false` | Muted theme for thinking blocks |
| `autoCollapseThinking` | boolean | `false` | Automatically collapse thinking blocks |
| `thinkingStyle` | "Full" \| "Compact" | `"Full"` | Thinking block display (Full = full text, Compact = one line, click to expand) |
| `toolStyle` | "Native" \| "Minimal" | `"Minimal"` | Tool rendering master switch (Minimal = archimedes styled, Native = pi native, no archimedes styling) |
| `codeUnindent` | boolean | `true` | Strip common indentation from code blocks |
| `labelText` | string | `"Thinking..."` | Text shown before thinking blocks |
| `labelColor` | string | `"255,215,0"` | RGB color for the thinking label (e.g. `255,215,0`) |
| `animationStyle` | "diagonal" \| "top-right" \| "bottom-left" \| "bottom-right" \| "center-out" \| "wave" \| "horizontal" \| "vertical" \| "vertical-up" | `"vertical-up"` | Startup logo animation |
| `editorSpinBorder` | boolean | `true` | Animated spinner border on editor |
| `editorSpinSpeed` | "slow" \| "normal" \| "fast" | `"normal"` | Editor border spinner speed |
| `editorSpinStyle` | "typing" \| "pulse" \| "rain" \| "cascade" \| "columns" \| "wave-rows" \| "diagonal-swipe" \| "sparkle" \| "pendulum" \| "marquee" | `"pendulum"` | Editor spinner style |
| `editorSpinLabel` | string | `"Working"` | Spinner frame label |

## Install

```bash
pi install @pi-archimedes/ui
```
