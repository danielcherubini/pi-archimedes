# @pi-archimedes/ask

Structured question tool with tabbed multi-question flow and inline note editing.

When language models need clarification, asking unstructured questions in text leads to guessing and back-and-forth ambiguity. This tool provides structured choice prompts, tabbed navigation for multi-part questions, and inline note editing so users can deliver clear, complete guidance in a single step.

## What you get

- **Tabbed multi-question flow** — submit review for multiple questions at once
- **Single-question picker** — instant submit for quick decisions
- **Inline note editing** — add custom notes and context per option
- **Markdown context descriptions** — rich context descriptions rendered above options
- **Automatic "Other" handling** — built-in custom response option with auto-focus
- **Subagent support** — subagents can call `ask` and questions appear in the parent agent's TUI via bidirectional IPC

## Screenshots

![ask from a subagent](../../docs/images/ask-subagent.png)

## Install

```bash
pi install npm:@pi-archimedes/ask
```

Or install full meta package:

```bash
pi install npm:pi-archimedes
```

## Usage

Single question example:

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

Multi-question with notes example:

```jsonc
{
  "questions": [
    {
      "id": "priority",
      "question": "What's the implementation priority?",
      "description": "Choose the order for tackling these tasks.",
      "options": [
        { "label": "Core features first" },
        { "label": "Tests first" },
        { "label": "Design first" }
      ],
      "recommended": 0
    },
    {
      "id": "approach",
      "question": "Any additional constraints?",
      "options": [
        { "label": "No breaking changes" },
        { "label": "Performance critical" },
        { "label": "None" }
      ],
      "multi": true
    }
  ]
}
```

## Integration

Depends on [`@pi-archimedes/core`](../core) for the shared event bus used to relay subagent questions. Subagents call `ask` and questions are safely dispatched to the parent agent's TUI over bidirectional IPC with no temporary files.

← Back to [pi-archimedes](../../README.md)
