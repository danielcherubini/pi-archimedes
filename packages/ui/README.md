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

| Setting | Type | Description |
| :--- | :--- | :--- |
| `bashToolStyling` | boolean | Enable/disable custom bash styling |
| `editorSpinAnimation` | boolean | Enable/disable border spinner animations |
| `compactThinking` | boolean | Enable/disable compact view for thoughts |
| `labelText` | string | Text used for labels |
| `animationStyle` | string | Animation type for UI elements |

## Install

```bash
pi install @pi-archimedes/ui
```
