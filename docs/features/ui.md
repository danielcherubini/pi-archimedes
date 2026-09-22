---
status: live
last-verified: 2026-09-22
verified-by: pnpm test
---

# UI Package (`@pi-archimedes/ui`)

`@pi-archimedes/ui` encapsulates all visual presentation extensions, tool styling, custom editor components, thinking block renderer patches, and startup animations in the Archimedes monorepo.

## Capabilities

1. **Bash Tool Styling**:
   - Overrides Pi's built-in `bash` tool with styled Archimedes conventions (`renderBashCall` and `renderBashResult`).
   - Header renders bold `bash` tool name.
   - Collapsed view renders single-line status: `<glyph> <command> (<duration>)` where glyph is orange `▸` (running), green `✓` (success), or red `✗` (error).
   - Live 1s interval timer updates elapsed duration in-flight; all intervals are tracked and cleared on completion, error, or session shutdown.
   - Expanded view displays `$ <command>`, stdout/stderr output, spill notices, and execution duration footer.

2. **Custom Editor**:
   - `HephaestusEditor` wraps Pi's editor component with an animated border spinner (`editorSpinBorder`).
   - Configurable spinner styles, speeds, and quips.

3. **Thinking Presentation**:
   - Patches assistant message rendering for collapsible thinking blocks (`autoCollapseThinking`).
   - Supports compact thinking line limits (`compactThinking`) and code unindentation (`codeUnindent`).

4. **Startup Splash Animation**:
   - Terminal logo reveal and animation sequences (`animationStyle`).
   - Safe console log interception and restoration (`unpatchConsoleLog`).

## Settings Namespace

All UI settings are stored in `archimedes.ui`. Existing configuration keys are automatically migrated from `archimedes.core` on first run via `migrateCoreToUIConfig()`.
