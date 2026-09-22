# @pi-archimedes/core

**Foundational non-UI runtime for the Pi Archimedes suite.**

Core is the foundational runtime that keeps the rest of the suite talking. It provides the shared event bus, message handling, settings-io, pure text/color/tool-render utilities, overlay chrome, and a startup profiler.

## Install

Standalone:

```bash
pi install npm:@pi-archimedes/core
```

Or the full suite instead:

```bash
pi install npm:pi-archimedes
```

New to Pi? Pi itself is a one-time global install and needs Node.js ≥ 22.19.0:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

After installing Pi, choose one installation command above, then `cd` into your project and run `pi`. Inside the session, `/login` signs you into a supported provider and `/model` picks a model.

## What you get

- **The bus** (`@pi-archimedes/core/bus`) — a global pub/sub event system: `COST_UPDATE`, `ASK_REQUEST`, `TODOS_UPDATE`, `TODOS_CLEAR`… subagent costs flow to the footer through it, subagent todos to the task board, subagent questions to the ask UI.
- **Shared utilities** — text truncation and width measurement, colour formatting, settings I/O, and startup profiling.
- **Overlay Chrome** — shared base for UI components.

## Part of the suite

In [pi-archimedes](https://github.com/danielcherubini/pi-archimedes), core is always registered — it isn't one of the `/plugins` toggles — and it underpins what the other components share: the bus that feeds subagent costs to the footer, subagent todos to the task board, and subagent questions to the ask UI. The diff renderer is standalone and does not depend on core's chrome — it only shares the suite when it loads.

← [Back to pi-archimedes](https://github.com/danielcherubini/pi-archimedes)
