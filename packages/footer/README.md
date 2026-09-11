# @pi-archimedes/footer

**Session details without scrolling.**

A long session drags context out of reach fast. The footer keeps the essentials pinned to the bottom of the terminal — where you are, which model you're running, how deep you are into the context window, and what you've spent — laying them out without clipping on any viewport width. When subagents run, their tokens and costs land in the same view, so the number you're watching is the whole run.

## Install

Standalone:

```bash
pi install npm:@pi-archimedes/footer
```

Or the full suite instead:

```bash
pi install npm:pi-archimedes
```

New to Pi? Pi itself is a one-time global install and needs Node.js ≥ 22.19.0:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

After installing Pi, choose one installation command above, then `cd` into your project and run `pi`. Inside the session, `/login` signs you in and `/model` picks a model — the [setup section](https://github.com/danielcherubini/pi-archimedes#setup) walks through the whole first run. A running session picks the footer up with `/reload`.

## What you get

- **Session line** — working directory, active git branch with clean/dirty indicator, worktree badge, active model, and thinking level.
- **Token ledger** — input (↑) and output (↓) tokens, cache read/write, and the live accumulated dollar cost of the session.
- **Context bar** — colour-coded (green → yellow → red). It shows **consumption**: how much of the context window is used, not how much headroom is left.
- **Adaptive layout** — one compact line on wide viewports; it wraps to the lines it needs as the terminal narrows instead of truncating essential data.
- **Subagent aggregation** — in the suite, subagent token and cost events flow over core's bus into the same accumulator, so worker spend and main-session spend read as one total.

Two honest caveats: the ledger reflects usage and pricing **as reported to the session** — it's a live read of what Pi has accounted, not a guaranteed provider invoice, and not a tally of every background model call. And the context bar tracks consumption, not remaining headroom.

## Settings

`~/.pi/agent/settings.json`, under `archimedes.footer` (strict JSON):

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `splitThreshold` | number | `150` | Minimum terminal columns for the single-line layout. Below it, the footer uses the structured multi-line layout; above it, it stays single-line and wraps only if content overflows. |

In the suite the setting also appears in `/archimedes` (when the panel has a control for it); `/reload` applies it. On/off is managed by the suite: toggle via `/plugins` (`archimedes.footer.enabled`, default on).

← [Back to pi-archimedes](https://github.com/danielcherubini/pi-archimedes)
