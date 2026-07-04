# pi-archimedes

Visual polish and useful context for the Pi coding agent TUI — a pnpm workspace monorepo of pi extensions providing subagents, structured questions, diff rendering, notifications, and more.

## Language

**Bus**:
The global pub/sub event system (`globalThis` Symbol) that packages use to communicate. Events include `COST_UPDATE`, `ASK_REQUEST`, `TODOS_UPDATE`, `TODOS_CLEAR`.
_Avoid_: Event bus, message bus, event emitter

**Meta**:
The orchestrator package (`pi-archimedes`) that depends on all component packages, wires cross-package concerns, and composes the settings UI.
_Avoid_: Umbrella, root, orchestrator package

**Subagent**:
A child pi process dispatched by the main agent to handle a delegated task. Can be sync (blocking until completion) or async (fire-and-forget). Communicates via IPC.
_Avoid_: Child agent, worker, spawned agent

**Agent**:
A named subagent configuration (e.g. `general`, `reviewer`, `explore`) with optional model, tool, and system prompt overrides. Stored in YAML frontmatter in config files.
_Avoid_: Agent config, agent profile, persona

**Extension**:
A pi extension entry point (`register(pi: ExtensionAPI)`) — each package exports one. Loaded by pi via `pi.extensions` in `package.json`.
_Avoid_: Plugin, module, package entry

**pi-package**:
An npm package tagged with `"keywords": ["pi-package"]` that is loadable by pi's extension system. Requires `"pi": { "extensions": ["./src/index.ts"] }` in `package.json`.
_Avoid_: Pi plugin, pi extension package
