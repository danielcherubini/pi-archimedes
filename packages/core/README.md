# @pi-archimedes/core

**Foundational non-UI runtime for the Pi Archimedes suite.**

Core is the foundational runtime that keeps the rest of the suite talking. It provides the shared channel vocabulary the packages talk to each other on, message handling, settings-io, pure text/color/tool-render utilities, overlay chrome, and a startup profiler.

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

- **The channel vocabulary** (`@pi-archimedes/core/events`) — the names and payload shapes the packages speak to each other with: `ASK_REQUEST`, `ASK_RESPONSE`, `ASK_CANCEL`, `TODOS_UPDATE`, `TODOS_CLEAR`, `COST_UPDATE`. Subagent todos flow to the task board through them and subagent questions to the ask UI. The module carries **no transport** — the transport is pi's own process-wide `pi.events`, and a package emits or listens on the handle it was given. `emitOn()` wraps emitting, because that handle is invalidated when its session is torn down and a dropped channel beats a crash. Cost no longer flows this way: a subagent reports its usage on its own tool result, which is what `/session` and the footer already total (`packages/subagent/src/usage.ts`).
- **Shared utilities** — text truncation and width measurement, colour formatting, settings I/O, and startup profiling.
- **Overlay Chrome** — shared base for UI components.

## Part of the suite

In [pi-archimedes](https://github.com/archimedes-codes/pi-archimedes), core is always registered — it isn't one of the `/plugins` toggles — and it underpins what the other components share: the channel vocabulary that carries subagent todos to the task board and subagent questions to the ask UI, and the bridge that reaches the Archimedes Client. The diff renderer is standalone and does not depend on core's chrome — it only shares the suite when it loads.

← [Back to pi-archimedes](https://github.com/archimedes-codes/pi-archimedes)
