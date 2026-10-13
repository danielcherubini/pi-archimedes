---
status: live
last-verified: 2026-10-13
verified-by: pnpm test + a real pi 1.2.0 TUI session (quietStartup false/"header"/true × tuiMode fullscreen/regular); the editor edge rows were then re-verified against real pi 1.2.0 `Theme` objects
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
   - **Edge rows are the panel's own colour, not a border.** The editor draws two half-block rows — `▁` above and `▔` below the frame — whose job is to extend the panel's tint flush to the frame, so they are painted in the panel's own colour and vanish into it by construction (`panelEdge` is the winning panel token asked for as a foreground: `theme.colors[userMessageBg]` through pi-tui's foreground emitter, since pi takes a token only in its own slot). Painting them in a border token instead draws a visible rule hugging the text area — the regression that made the panel look bordered. When the theme gives the panel no colour at all (a terminal-default `""` token, or a theme that cannot answer its own token as a foreground) there is no edge colour, and the two rows render as blank spaces rather than block glyphs in the terminal's own foreground; they go blank, they do not disappear, because the frame's height is a layout contract. The `┌──┐` frame itself is a real border and keeps `borderMuted`.

4. **Thinking Presentation**:
   - Patches assistant message rendering for collapsible thinking blocks (`autoCollapseThinking`).
   - `thinkingStyle` (Full = full thinking text, Compact = one-line thinking, click to expand) plus code unindentation (`codeUnindent`).
   - `toolStyle` is the **master switch for all Archimedes tool styling**: `Minimal` (default) registers the styled bash/codemode overrides (per-tool `bashToolStyling`/`codemodeToolStyling` toggles fine-tune under it); `Native` registers no overrides at all — pi's native tool rendering stands and no takeover notice is printed. The former `Full` value (auto-expand every tool via a `ToolExecutionComponent` prototype patch) was dropped; `migrateRemovedToolPatch()` restores the true prototype methods if an older version left the patch behind in the same process (upgrade + `/reload`). Legacy `Full`/`Compact` settings normalize to `Minimal` so an upgrade never silently strips styling.

5. **Startup Splash Animation**:
   - Terminal logo reveal and animation sequences (`animationStyle`), optionally in pi's brand colors (`colorfulLogo`), plus a `[Version]` row stating the running pi version. pi owns its own update check (`pi update`, `/changelog`, `PI_SKIP_VERSION_CHECK`), so the splash makes no network request of its own.
   - **`quietStartup` is honoured, not scraped**: pi's own setting (`false` / `"header"` / `true`) is read through `readQuietStartup()` from the effective settings, mirroring pi's two predicates — the header is hidden only by `true` (the splash hands `setHeader(undefined)` back to pi, so its silence stands), and the startup *details* are shown only by `false`. Under `"header"` the splash draws the logo and version with no sections.
   - **The model scope comes from `ctx.scopedModels`** — the same set `/scoped-models` lists, formatted as pi's own `Model scope:` line does (`id`, plus `:thinkingLevel`) — and appears as a `[Models]` section when details are allowed. It used to be scraped: a `console.log` patch watched for pi printing that line (and swallowed it), and pi's resource components were intercepted out of its container and re-rendered here. Both patches are gone, so pi renders its own listing and the console is nobody's data source.
   - **Screen mode** (ADR 0027): the animation drives the renderer handed to the header factory and runs on either screen — the capability gate that used to suppress it on fullscreen screen went away with the scrollback-native listing it was guarding. What still differs per screen is height: regular screen sizes the header to the terminal it scrolls through, a frame-bounded screen gets `CONTENT_ONLY_HEIGHT` (its own content) so the editor keeps the rest of the viewport.
   - **A finished splash caches its lines** so the text layout does not re-run on every repaint, and it honours `Component.invalidate()` — the hook pi calls on the whole tree whenever the theme changes — by dropping that cache. The cache key is the width and height it was drawn at, which a theme switch does not change.

## Settings Namespace

All UI settings are stored in `archimedes.ui`. Existing configuration keys are automatically migrated from `archimedes.core` on first run via `migrateCoreToUIConfig()`. `migrateCompactThinkingToStyle()` converts the legacy `compactThinking` key to `thinkingStyle`, and `migrateRemovedToolPatch()` removes the dropped `toolStyle: "Full"` auto-expand wrapper from `ToolExecutionComponent`'s prototype (upgrade + `/reload` in the same process).
