# @pi-archimedes/ask

**Structured interactive question tool with tabbed navigation, inline notes, and subagent IPC bridging for the [Pi coding agent](https://github.com/earendil-works/pi).**

When coding agents need architectural guidance or clarification, plain text questions create ambiguity and endless back-and-forth loops. `@pi-archimedes/ask` gives agents a structured prompt tool featuring tabbed multi-part forms, single-click pickers, inline note annotations, and markdown context cards. Uniquely, it bridges subagent questions directly into the parent terminal over bidirectional IPC without breaking execution.

<div align="center">
  <img src="https://raw.githubusercontent.com/danielcherubini/pi-archimedes/main/docs/images/ask-subagent.png" width="700" alt="Ask prompt routed from subagent to parent TUI">
</div>

## Quick Start

### 1. Install Pi (if needed)

```bash
npm install -g @earendil-works/pi-coding-agent
```

### 2. Install

Install standalone:

```bash
pi install npm:@pi-archimedes/ask
```

Or install the complete [pi-archimedes](https://github.com/danielcherubini/pi-archimedes) development cockpit:

```bash
pi install npm:pi-archimedes
```

---

## What You Get

- **Bidirectional Subagent IPC** — When a dispatched subagent calls `ask`, the interactive prompt renders directly in your live parent terminal. The subagent safely pauses, you submit your answers, and it resumes immediately with your exact choices.
- **Tabbed Multi-Question Flows** — Move across multiple interrelated questions using arrow keys and submit a batch review in one atomic step.
- **Single-Question Quick Picker** — Instant one-click selection for fast binary or multiple-choice questions.
- **Inline Note Annotations** — Press a key on any option to type custom context, constraints, or caveats that pass back alongside the answer.
- **Built-in "Other" Input** — Automatic custom response field allows users to type freeform text whenever options don't cover the situation.
- **Rich Markdown Context** — Renders formatted code blocks, headers, and descriptions above question options.

---

## Tool Usage

### Single Quick Question

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

### Multi-Question with Markdown & Multiple Selection

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

---

## Part of the Archimedes Suite

When installed via [pi-archimedes](https://github.com/danielcherubini/pi-archimedes), `@pi-archimedes/ask` automatically pairs with `@pi-archimedes/subagent` to let background subagents ask you questions directly in your terminal without breaking execution.

← Back to [pi-archimedes](https://github.com/danielcherubini/pi-archimedes)
