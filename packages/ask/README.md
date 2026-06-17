# @pi-archimedes/ask

Structured question tool with tabbed multi-question flow and inline note editing.

## Install

```bash
pi install @pi-archimedes/ask
```

## Features

- Tabbed multi-question flow with submit review
- Single-question picker with instant submit
- Inline note editing per option
- Markdown context descriptions
- Automatic "Other (type your own)" handling
- Subagent support — subagents can call `ask` and the question appears in the parent's TUI (bidirectional IPC, no temp files)

![ask from a subagent](../../docs/images/ask-subagent.png)

## Dependencies

Depends on [`@pi-archimedes/core`](../core) for the shared event bus used to relay subagent questions.

## Settings

No settings yet.
