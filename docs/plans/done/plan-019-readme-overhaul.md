# README Overhaul Plan

**Goal:** Make every README in the repo compelling, consistent, and written for humans who want to understand what each package does and why they'd want to install it.

**Architecture:** Two missing READMEs (core, footer) are created from scratch. The root README's "Why" section is rewritten to lead with user value instead of origin story. All package READMEs are standardized to a shared template. The broken image reference in notify is fixed. All install commands use the `npm:` prefix consistently.

**Tech Stack:** Markdown only — no code changes, no tests, no build step.

---

## Shared Package README Template

Every package README follows this structure (sections omitted when not applicable):

```
# @pi-archimedes/<name>

One-sentence tagline that explains what it does in plain English.

A short paragraph (2-4 sentences) that answers "why would I want this?" — the problem it solves and the feeling it gives. NOT technical internals.

## What you get

Bullet list of features, each starting with a bold lead that sells the benefit, followed by a short explanation. Group related items. No more than 6-8 bullets.

## Screenshots

(Only if screenshots exist) One or two images with descriptive captions.

## Install

```bash
pi install npm:@pi-archimedes/<name>
```

Or install the full [pi-archimedes](../../README.md) meta package:

```bash
pi install npm:pi-archimedes
```

## Usage

How to use the package — commands, tools, shortcuts, or behavioral description. Concrete examples with code blocks where applicable.

## Settings

(Only if the package has settings) Table with Setting | Type | Default | Description. Note the settings namespace.

## Integration

(Only if the package integrates with other archimedes packages) What happens when installed via the meta package vs standalone.

← Back to [pi-archimedes](../../README.md)
```

---

### Task 1: Create `packages/core/README.md`

**Context:**
Core is the foundation package — it provides the visual chrome (splash screen, editor, thinking blocks), the event bus that all other packages communicate through, and shared utilities (text, color, config, settings-io, profiler). Without a README, users who install it standalone have no idea what they got. The root README links to this file and the link is currently dead.

**Files:**
- Create: `packages/core/README.md`

**What to implement:**
Write a README for `@pi-archimedes/core` following the shared template. Cover:

- **Tagline:** "The visual foundation and shared infrastructure for pi-archimedes."
- **Why paragraph:** Core is what you see first — the animated splash screen, the framed editor, the styled thinking blocks. It's also the invisible glue: an event bus that lets packages talk to each other, shared text and color utilities, and a settings system. Install it standalone for polished chrome, or let the meta package include it automatically.
- **What you get section:**
  - **Animated splash screen** — configurable reveal animations (9 styles) that set the tone when Pi starts
  - **Framed editor** — custom editor component with double-press quit guard
  - **Styled thinking blocks** — configurable label text, color, and muted theme option; optional code block unindenting
  - **Event bus** — shared pub/sub channel that lets packages communicate (subagent costs → footer, subagent questions → ask, etc.)
  - **Shared utilities** — text truncation/width calculation, color helpers, config loading, settings I/O, and startup profiling
- **No screenshots section** (no dedicated screenshot for core alone — splash-screen.png is in the root README)
- **Install section** with `npm:` prefix
- **Usage section:** Explain that core works automatically on session start — sets the header, editor, and thinking renderer. No commands or tools to call. For configuration: with the meta package, use the `/archimedes` settings panel. Standalone installs edit `archimedes.core` directly in `~/.pi/agent/settings.json`.
- **Settings section** with the 5 core settings (mutedTheme, codeUnindent, labelText, labelColor, animationStyle) under `archimedes.core` namespace
- **Integration section:** Core is auto-included by the meta package. Other archimedes packages depend on it for the bus, chrome, and utilities. Standalone install gives you chrome + bus without the other features.
- **Back link** to root README

**Steps:**
- [ ] Write `packages/core/README.md` following the template above
- [ ] Verify the root README link `packages/core/README.md` now resolves
- [ ] Commit with message: "docs: add @pi-archimedes/core README"

**Acceptance criteria:**
- [ ] File exists at `packages/core/README.md`
- [ ] Follows the shared template structure
- [ ] Writes for humans — sells the value, doesn't just list exports
- [ ] Install commands use `npm:` prefix
- [ ] Links back to root README
- [ ] Root README's link to `packages/core/README.md` is no longer dead

---

### Task 2: Create `packages/footer/README.md`

**Context:**
Footer is one of the most visible and useful packages — it shows directory, git branch with clean/dirty indicator, model, thinking level, worktree, token stats (input/output/cache/cost), and a color-coded context window progress bar. It auto-splits into two lines on narrow terminals. It merges subagent costs into the main display via the bus. No README exists and the root README link is dead.

**Files:**
- Create: `packages/footer/README.md`

**What to implement:**
Write a README for `@pi-archimedes/footer` following the shared template. Cover:

- **Tagline:** "A status bar that shows what matters — at a glance, without getting in the way."
- **Why paragraph:** Your terminal is already full of information. The footer gives you exactly what you need to know about your session — where you are, what model you're using, how many tokens you've burned, and how close you are to the context limit — all in one clean line at the bottom. When subagents run, their costs merge seamlessly into the same view.
- **What you get section:**
  - **Session context at a glance** — directory, git branch (with clean/dirty indicator), active model, thinking level, and worktree
  - **Token stats** — input ↑, output ↓, cache read/write, and real-dollar cost, all in one compact display
  - **Context window bar** — color-coded progress bar (green → yellow → red) showing how much of your context window is used
  - **Smart layout** — single line on wide terminals, auto-splits to two lines when space is tight
  - **Unified subagent costs** — when subagents run, their token usage and cost merge into the main footer automatically
- **No screenshots section** (no dedicated footer screenshot exists — could be noted as a future improvement)
- **Install section** with `npm:` prefix
- **Usage section:** Footer renders automatically at the bottom of the Pi TUI. No commands to run. Mention the split threshold behavior.
- **Settings section** with `splitThreshold` (number, default 150) under `archimedes.footer` namespace
- **Integration section:** When installed via meta package, footer consumes cost events from subagents through the core bus, giving a unified token/cost view. Standalone install shows only the main agent's stats.
- **Back link** to root README

**Steps:**
- [ ] Write `packages/footer/README.md` following the template above
- [ ] Verify the root README link `packages/footer/README.md` now resolves
- [ ] Commit with message: "docs: add @pi-archimedes/footer README"

**Acceptance criteria:**
- [ ] File exists at `packages/footer/README.md`
- [ ] Follows the shared template structure
- [ ] Writes for humans — sells the value, doesn't just list features
- [ ] Install commands use `npm:` prefix
- [ ] Links back to root README
- [ ] Root README's link to `packages/footer/README.md` is no longer dead

---

### Task 3: Fix broken image reference in `packages/notify/README.md`

**Context:**
The notify README references `![notify kitty](../../docs/images/notify-kitty.png)` but this file doesn't exist in `docs/images/`. This creates a broken image on npm and GitHub. The fix is to remove the screenshot section entirely since there's no valid image to show.

**Files:**
- Modify: `packages/notify/README.md`

**What to implement:**
- Remove the "## Screenshots" section (lines containing the heading, the "Kitty notification" subheading, and the image reference with caption)
- Do NOT change any other content in this file in this task

**Steps:**
- [ ] Read `packages/notify/README.md`
- [ ] Remove the "## Screenshots" section and its contents
- [ ] Verify no other references to `notify-kitty.png` exist
- [ ] Commit with message: "docs: remove broken notify-kitty.png reference"

**Acceptance criteria:**
- [ ] No reference to `notify-kitty.png` exists in the repo (outside node_modules)
- [ ] Rest of notify README is unchanged
- [ ] File still renders as valid markdown

---

### Task 4: Rewrite root README "Why" section and standardize install commands

**Context:**
The root README's "Why pi-archimedes?" section reads like a personal diary entry explaining the author's development journey. A new user scanning the README wants to know "what's in it for me?" before they care about how it was built. Also, the root README uses `npm:` prefix consistently but package READMEs don't — standardize everything to use `npm:`.

**Files:**
- Modify: `README.md`
- Modify: `packages/ask/README.md`
- Modify: `packages/diff/README.md`
- Modify: `packages/notify/README.md`
- Modify: `packages/subagent/README.md`
- Modify: `packages/todo/README.md`

**What to implement:**

**Root README — Rewrite "Why pi-archimedes?" section:**
Replace the current section with something that leads with user value. Keep it warm and personal but focused on what the reader gets. Use this replacement text:

> Pi's extension ecosystem is powerful, but extensions don't talk to each other. Install one and it has no idea another exists.
>
> pi-archimedes is a set of extensions that actually cooperate. Subagent costs flow into the footer. Subagent todos appear alongside yours. When a subagent needs to ask you a question, the prompt surfaces in your TUI and the answer routes back. The diff renderer matches your theme. The splash screen sets the tone.
>
> Everything shares a single point of view: minimal, but designed. Install once, stop thinking about it.
>
> Want only one piece? Each package works standalone. Want only the footer? `pi install npm:@pi-archimedes/footer`. Only the diff renderer? `pi install npm:@pi-archimedes/diff`. Mix and match.

Keep the "Open an issue" / "Start a discussion" links. Keep everything after the "Why" section unchanged.

**Install command standardization across all 6 package READMEs:**
Change every install command to use the `npm:` prefix:
- `pi install @pi-archimedes/<name>` → `pi install npm:@pi-archimedes/<name>`
- `pi install pi-archimedes` → `pi install npm:pi-archimedes`

Files to check: ask, diff, notify, subagent, todo (image-paste already uses `npm:` correctly).

**Do NOT** change any other content in these files in this task.

**Steps:**
- [ ] Rewrite the "Why pi-archimedes?" section in `README.md` (replace the current text with user-value-focused copy)
- [ ] Fix install commands in `packages/ask/README.md` (add `npm:` prefix)
- [ ] Fix install commands in `packages/diff/README.md` (add `npm:` prefix)
- [ ] Fix install commands in `packages/notify/README.md` (add `npm:` prefix)
- [ ] Fix install commands in `packages/subagent/README.md` (add `npm:` prefix)
- [ ] Fix install commands in `packages/todo/README.md` (add `npm:` prefix)
- [ ] Verify `packages/image-paste/README.md` already uses `npm:` (no changes needed)
- [ ] Grep all READMEs for `pi install` to confirm consistency
- [ ] Commit with message: "docs: rewrite root README intro and standardize install commands"

**Acceptance criteria:**
- [ ] Root README "Why" section leads with user value, not origin story
- [ ] Every `pi install` command in every README uses the `npm:` prefix
- [ ] No other content was changed in package READMEs
- [ ] `grep "pi install" README.md packages/*/README.md` shows consistent `npm:` prefix

---

### Task 5: Standardize all existing package READMEs to shared template

**Context:**
The 6 existing package READMEs (ask, diff, image-paste, notify, subagent, todo) have inconsistent structure — different section names, different ordering, different levels of detail. Standardize them all to the shared template defined at the top of this plan. This makes the repo feel cohesive and professional.

**Files:**
- Modify: `packages/ask/README.md`
- Modify: `packages/diff/README.md`
- Modify: `packages/image-paste/README.md`
- Modify: `packages/notify/README.md`
- Modify: `packages/subagent/README.md`
- Modify: `packages/todo/README.md`

**What to implement:**
Rewrite each package README to follow the shared template. Preserve all existing information (features, screenshots, settings, usage examples, integration notes) but restructure into the standard sections. Add the "← Back to pi-archimedes" link at the bottom of each.

**Per-package notes:**

**ask:** Currently the shortest README. Add "Usage" section with the tool call examples below (derived from `AskParamsSchema` in `packages/ask/src/index.ts`). Add "Integration" section explaining the IPC channel with subagents. Fold the existing "Dependencies" section content into the Integration section (don't drop it). Add back link.

**Usage examples for ask (include these exact JSON blocks):**

Single question:
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

Multi-question with notes:
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

**diff:** Already close to the template. Rename "## Features" → "## What you get" with benefit-first bullets. Add back link. Ensure install commands use `npm:` prefix (done in Task 4).

**image-paste:** Already well-structured. Rename "## Features" → "## What you get". Add back link. Already has `npm:` prefix.

**notify:** Already well-structured with "How it works" and "Terminal compatibility" tables. Rename "## Features" → "## What you get". Move "How it works" content into Usage section. Keep terminal compatibility table as its own `## Terminal compatibility` section after Usage. Add back link. (Screenshot section already removed in Task 3.)

**subagent:** Already comprehensive. Rename "## Features" → "## What you get". Keep all screenshots and usage examples. Add back link.

**todo:** Already well-structured. Rename "## Features" → "## What you get". Keep all screenshots, usage examples, and status table. Add back link.

**What NOT to change:** Do not add or remove features, settings, or functionality descriptions. This is a structural rewrite only — preserve all information.

**Steps:**
- [ ] Rewrite `packages/ask/README.md` to match template (add Usage, Integration, back link)
- [ ] Rewrite `packages/diff/README.md` to match template (rename sections, add back link)
- [ ] Rewrite `packages/image-paste/README.md` to match template (rename sections, add back link)
- [ ] Rewrite `packages/notify/README.md` to match template (rename sections, restructure, add back link)
- [ ] Rewrite `packages/subagent/README.md` to match template (rename sections, add back link)
- [ ] Rewrite `packages/todo/README.md` to match template (rename sections, add back link)
- [ ] Verify all 8 package READMEs (including newly created core and footer) follow the same structure
- [ ] Verify all back links point to `../../README.md`
- [ ] Commit with message: "docs: standardize all package READMEs to shared template"

**Acceptance criteria:**
- [ ] All 8 package READMEs have the same section structure (What you get, Install, Usage, Settings if applicable, Integration if applicable, back link)
- [ ] All install commands use `npm:` prefix
- [ ] All READMEs link back to root README
- [ ] No information was lost in the restructuring
- [ ] Each README reads well for a human scanning to decide whether to install

---

### Task 6: Final verification and root README cross-link audit

**Context:**
After all individual changes, do a final pass to ensure everything links correctly, no references are broken, and the READMEs read well as a set.

**Files:**
- Read: `README.md`
- Read: `packages/*/README.md` (all 8)

**What to implement:**
- Verify all internal links resolve (package README links from root README, back links from package READMEs)
- Verify no broken image references exist
- Verify install command consistency across all files
- Verify settings tables in root README match the per-package READMEs
- Verify the "Or install selectively" section in root README lists all 8 packages

**Steps:**
- [ ] Read all 9 READMEs (root + 8 packages)
- [ ] Check every internal link resolves to an existing file
- [ ] Run `grep -r "pi install" README.md packages/*/README.md` and verify all use `npm:` prefix
- [ ] Run `grep -r "\.png" README.md packages/*/README.md` and verify all referenced images exist in `docs/images/`
- [ ] Verify root README's "Or install selectively" lists all 8 packages (core, footer, diff, image-paste, subagent, todo, ask, notify)
- [ ] Fix "seven components" → "eight components" in root README Features intro (line 36)
- [ ] Verify root README's settings sections match per-package READMEs
- [ ] Commit any final fixes with message: "docs: final README cross-link and consistency audit"
- [ ] Commit plan file: `git add docs/plans/plan-019-readme-overhaul.md`
- [ ] Update `docs/plans/README.md`: add plan row to Done table (status IN PROGRESS), increment Total Plans count

**Acceptance criteria:**
- [ ] Zero broken internal links across all READMEs
- [ ] Zero broken image references
- [ ] All install commands use `npm:` prefix consistently
- [ ] All 8 packages listed in root README's selective install section
- [ ] Settings tables are consistent between root and package READMEs
- [ ] "seven components" → "eight components" fix applied in root README
- [ ] Plan file committed and `docs/plans/README.md` updated

**Out of scope:** `meta/README.md` (the npm page for `pi-archimedes` meta package). The root README serves as the npm package README. If a dedicated meta README is needed in the future, it can be a symlink or copy of the root README.
