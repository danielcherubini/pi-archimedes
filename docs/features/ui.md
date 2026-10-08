---
status: live
last-verified: 2026-10-08
verified-by: pnpm test
---

# UI Package (`@pi-archimedes/ui`)

`@pi-archimedes/ui` encapsulates all visual presentation extensions, tool styling, custom editor components, thinking block renderer patches, and startup animations in the Archimedes monorepo.

## Capabilities

1. **Bash Tool Styling**:
   - Overrides Pi's built-in `bash` tool with styled Archimedes conventions (`renderBashCall` and `renderBashResult`).
   - Header renders bold `bash` tool name with command preview in orange accent color.
   - Collapsed view renders status line: `<glyph> <duration> (timeout: <timeout>s)` where glyph is orange `▸` (running), green `✓` (success), or red `✗` (error).
   - Live 1s interval timer updates elapsed duration in-flight; all intervals are tracked and cleared on completion, error, or session shutdown.
   - Expanded view displays `$ <command>`, stdout/stderr output, spill notices, and execution duration footer.

2. **Codemode Tool Styling** (shipped with PR #66, 2026-10-01):
   - Overrides Pi's built-in `codemode` tool (a replaceable built-in extension — registering a same-named tool takes over; pi omits the built-in one and prints its standard startup notice) with Archimedes-styled `renderCodemodeCall`/`renderCodemodeResult`, keeping the native QuickJS executor, dynamic `prepareLoadout` description, and `defaultActive: false`.
   - The native definition is loaded from the **running CLI's own install** (walk up from `process.argv[1]` to the package root → `dist/extensions/codemode/tool.js`; fallback: the local node_modules copy via `import.meta.resolve` — the agent package's exports map has no `require` condition). Jiti shares the native module instance for `.js`, so the `parameters` reference is preserved from `pi.getAllTools()` at `session_start` — the CLI's MCP/tool-search extensions recognise the tool by schema identity (`isCodemodeTool`).
   - Collapsed view: the `codemode` header + the nested tool calls the script made (last 5, with an expand hint); a script with no calls shows a single `<glyph> <duration>` line; a failed script appends a `✗ Script failed` marker so a failure is never hidden behind success glyphs. Expanded view: syntax-highlighted script, every nested call (status, args, duration, `models.*` cost + `Model calls: $total`), output without the executor's `Script completed/failed` header (image blocks show an `[Image: …]` indicator — the renderer is text-only), full-output path, timing, and final status.
   - No-op on pi versions without the codemode extension (native rendering stands in).

3. **Custom Editor**:
   - `HephaestusEditor` wraps Pi's editor component with an animated border spinner (`editorSpinBorder`).
   - Configurable spinner styles, speeds, and quips.

4. **Thinking Presentation**:
   - Patches assistant message rendering for collapsible thinking blocks (`autoCollapseThinking`).
   - `thinkingStyle` (Full = full thinking text, Compact = one-line thinking, click to expand) plus code unindentation (`codeUnindent`).
   - `toolStyle` is the **master switch for all Archimedes tool styling**: `Minimal` (default) registers the styled bash/codemode overrides (per-tool `bashToolStyling`/`codemodeToolStyling` toggles fine-tune under it); `Native` registers no overrides at all — pi's native tool rendering stands and no takeover notice is printed. The former `Full` value (auto-expand every tool via a `ToolExecutionComponent` prototype patch) was dropped; `migrateRemovedToolPatch()` restores the true prototype methods if an older version left the patch behind in the same process (upgrade + `/reload`). Legacy `Full`/`Compact` settings normalize to `Minimal` so an upgrade never silently strips styling.

5. **Startup Splash Animation**:
   - Terminal logo reveal and animation sequences (`animationStyle`), optionally in pi's brand colors (`colorfulLogo`).
   - Safe console log interception and restoration (`unpatchConsoleLog`).

## Settings Namespace

All UI settings are stored in `archimedes.ui`. Existing configuration keys are automatically migrated from `archimedes.core` on first run via `migrateCoreToUIConfig()`. `migrateCompactThinkingToStyle()` converts the legacy `compactThinking` key to `thinkingStyle`, and `migrateRemovedToolPatch()` removes the dropped `toolStyle: "Full"` auto-expand wrapper from `ToolExecutionComponent`'s prototype (upgrade + `/reload` in the same process).
