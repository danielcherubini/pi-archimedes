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

### Editor
- **HephaestusEditor**: Advanced text editing capabilities.
- **Border Spinner Animations**: Visual feedback during operations.
- **Spin Quips**: Enjoyable messages while waiting for processes.

### Thinking
- **Compact Thinking**: Minimized footprint for thought blocks.
- **Collapsible Thinking**: Expandable for deeper inspection.
- **Theme**: Unified styling for thinking blocks.

### Startup
- **Splash Logo Reveal**: Engaging animations during initialization.

## Settings (`archimedes.ui`)

| Setting | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `bashToolStyling` | boolean | `true` | Custom styled bash tool rendering |
| `mutedTheme` | boolean | `false` | Muted theme for thinking blocks |
| `autoCollapseThinking` | boolean | `false` | Automatically collapse thinking blocks |
| `compactThinking` | "Off" \| "1 line" \| "3 lines" \| "5 lines" | `"Off"` | Compact thinking block mode |
| `codeUnindent` | boolean | `true` | Strip common indentation from code blocks |
| `labelText` | string | `"Thinking..."` | Startup splash header text |
| `labelColor` | string | `"255,215,0"` | Startup splash header color (RGB triplet) |
| `animationStyle` | "diagonal" \| "top-right" \| "bottom-left" \| "bottom-right" \| "center-out" \| "wave" \| "horizontal" \| "vertical" \| "vertical-up" | `"vertical-up"` | Startup logo animation |
| `editorSpinBorder` | boolean | `true` | Animated spinner border on editor |
| `editorSpinSpeed` | "slow" \| "normal" \| "fast" | `"normal"` | Editor border spinner speed |
| `editorSpinStyle` | "typing" \| "pulse" \| "rain" \| "cascade" \| "columns" \| "wave-rows" \| "diagonal-swipe" \| "sparkle" \| "pendulum" \| "marquee" | `"pendulum"` | Editor spinner style |
| `editorSpinLabel` | string | `"Working"` | Spinner frame label |

## Install

```bash
pi install @pi-archimedes/ui
```
