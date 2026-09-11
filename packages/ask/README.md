# @pi-archimedes/ask

**Keep the decisions. Delegate the work.**

When an agent needs you, ask turns the need into a structured prompt right in the terminal — options, inline notes, a freeform fallback — so the answer carries your exact intent back. From subagents, too: their questions surface in the parent TUI, the agent waits, and the work carries on with your choice. No copy-pasting messages between panes to stay involved.

## Install

Standalone:

```bash
pi install npm:@pi-archimedes/ask
```

Or the full suite instead:

```bash
pi install npm:pi-archimedes
```

New to Pi? Pi itself is a one-time global install and needs Node.js ≥ 22.19.0:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

After installing Pi, choose one installation command above, then `cd` into your project and run `pi`. Inside the session, `/login` signs you in and `/model` picks a model — the [setup section](https://github.com/danielcherubini/pi-archimedes#setup) covers the first run. `/reload` picks the tool up in a running session.

## What you get

- **Tabbed multi-question flows** — arrow keys move between related questions; a final batch review submits the whole set in one step.
- **Single-question picker** — for fast multiple-choice questions, keyboard-driven: up/down to move, `Enter` to submit, `Esc` to cancel. Nothing requires a mouse.
- **Inline note per option** — `Tab` opens a note editor on the hovered option; `Enter` submits it. Notes travel back with the answer, so context and constraints ride along.
- **Multiple selection** — `multi: true` collects several answers from one question.
- **Built-in "Other (type your own)"** — whenever the options don't cover it, a freeform response field is always available.
- **Markdown context** — the agent can attach formatted descriptions, headers, and code blocks above the options, so the question presents context you can actually read.

## Tool usage

### Single quick question

```jsonc
{
  "questions": [{
    "id": "framework",
    "question": "Which framework should we use?",
    "options": [
      { "label": "React" },
      { "label": "Vue" },
      { "label": "Svelte" }
    ]
  }]
}
```

### Multi-question flow with markdown context and multiple selection

```jsonc
{
  "questions": [
    {
      "id": "priority",
      "question": "What is the implementation priority?",
      "description": "Choose the initial focus area for this milestone.",
      "recommended": 0,
      "options": [
        { "label": "Core architecture first" },
        { "label": "Unit tests first" },
        { "label": "CLI interface first" }
      ]
    },
    {
      "id": "constraints",
      "question": "Select applicable constraints:",
      "multi": true,
      "options": [
        { "label": "No breaking changes" },
        { "label": "Zero external dependencies" },
        { "label": "Strict backward compatibility" }
      ]
    }
  ]
}
```

An option the agent marks `recommended` is flagged in the UI; `description` renders as markdown above the options.

## Subagent relay

When a subagent dispatched by `@pi-archimedes/subagent` calls `ask`, the same prompt relayed over the bidirectional IPC channel appears in your live terminal, even mid-stream — the subagent blocks while you answer and resumes carrying your exact choices. It works alongside the live streaming and cost tracking, no temp files or pipes. This relay only applies to Archimedes-dispatched subagents; a question from a directly-called agent simply renders in-line.

<div align="center">
  <img src="https://raw.githubusercontent.com/danielcherubini/pi-archimedes/main/docs/images/ask-subagent.png" width="700" alt="Ask prompt routed from subagent to parent TUI">
</div>

On/off is managed by the suite: toggle via `/plugins` (`archimedes.ask.enabled`, default on).

← [Back to pi-archimedes](https://github.com/danielcherubini/pi-archimedes)
