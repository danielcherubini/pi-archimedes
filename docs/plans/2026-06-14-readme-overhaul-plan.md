# pi-archimedes README + Hephaestus Deprecation — Implementation Plan

**Goal:** Replace the lean `pi-archimedes/README.md` with a marketing-style README modeled after `pi-ui-hephaestus`. Add a top-of-file deprecation block to `pi-ui-hephaestus/README.md`. Update `pi.image` URL in `meta/package.json` to point to the archimedes repo.

**Architecture:** Two-repo change. pi-archimedes gets a new README (6 sections: Hero, Why, Features, Quick Start, Settings, Architecture), splash asset copied from hephaestus, and a `pi.image` URL update. pi-ui-hephaestus gets a deprecation block at the very top of its README. The two repos have no shared code; changes are independent and can ship as two separate PRs or one cross-repo PR.

**Tech Stack:** Markdown, Git, pnpm workspaces.

**Spec reference:** `docs/plans/2026-06-14-readme-overhaul.md`

---

## Task 1: Copy splash asset from hephaestus to pi-archimedes

**Context:**
The new pi-archimedes README will reference a splash image at `docs/splash-screen.png`. The cleanest short-term solution is to reuse the hephaestus splash image (we'll swap for a fresh one later). This task moves the file from the deprecated repo to the active one so the URL in the README resolves.

**Files:**
- Copy: `../pi-ui-hephaestus/docs/splash-screen.png` → `docs/splash-screen.png`

**What to implement:**
- Use `cp` (or equivalent) to copy the file at the exact path
- No edits to the file itself — it's binary
- Verify the file exists and has the same byte size as the source

**Steps:**
- [ ] From `/home/daniel/Coding/Javascript/pi-archimedes`, run:
  ```bash
  cp ../pi-ui-hephaestus/docs/splash-screen.png docs/splash-screen.png
  ```
- [ ] Run `ls -la docs/splash-screen.png` and confirm the file exists
- [ ] Run `file docs/splash-screen.png` and confirm it's a valid PNG
- [ ] Commit with message: `docs: copy splash-screen.png from hephaestus (placeholder)`

**Acceptance criteria:**
- [ ] `docs/splash-screen.png` exists in pi-archimedes
- [ ] File is a valid PNG (verified via `file` command)
- [ ] Commit pushed to a feature branch

---

## Task 2: Update `pi.image` URL in `meta/package.json`

**Context:**
The `meta` package (published to npm as `pi-archimedes`) has a `pi.image` field that Pi's extensions website reads to display a package splash. Currently it points to `pi-ui-hephaestus`. After the asset move in Task 1, the URL should point to the archimedes repo so the displayed image comes from the active project.

**Files:**
- Modify: `meta/package.json`

**What to implement:**
- Find the `pi.image` line in `meta/package.json`:
  ```json
  "image": "https://raw.githubusercontent.com/danielcherubini/pi-ui-hephaestus/main/docs/splash-screen.png"
  ```
- Change it to:
  ```json
  "image": "https://raw.githubusercontent.com/danielcherubini/pi-archimedes/main/docs/splash-screen.png"
  ```
- Do NOT modify any other field in `meta/package.json` (version, name, dependencies, etc. are handled by the release flow)

**Steps:**
- [ ] Open `meta/package.json`
- [ ] Locate the `pi.image` URL
- [ ] Replace the URL with the archimedes one
- [ ] Run `python3 -m json.tool < meta/package.json > /dev/null` to confirm the JSON is still valid
- [ ] Commit with message: `chore(meta): point pi.image to archimedes repo`

**Acceptance criteria:**
- [ ] `meta/package.json` `pi.image` URL is `https://raw.githubusercontent.com/danielcherubini/pi-archimedes/main/docs/splash-screen.png`
- [ ] JSON is still valid
- [ ] Commit pushed

---

## Task 3: Rewrite `pi-archimedes/README.md` per the approved spec

**Context:**
The current README is a 50-line lean reference. We're replacing it with a marketing-style document modeled after the hephaestus README. The full content spec is in `docs/plans/2026-06-14-readme-overhaul.md` Section A. This task is a complete rewrite of `README.md`.

**Files:**
- Modify (full rewrite): `README.md`

**What to implement:**
The new README must have exactly 6 top-level sections (H2 level), in order, matching the spec. The "How packages compose" callout is a blockquote *inside* the Features section, not a separate section.

1. **Hero**
   - `<div align="center">` wrapper (matches hephaestus README style)
   - Splash image (HTML, not Markdown — Markdown `![]()` doesn't support width): `<img src="docs/splash-screen.png" width="600" alt="pi-archimedes splash (art originally from pi-ui-hephaestus)">`
   - H1: `# pi-archimedes`
   - Tagline (italics): `*Visual polish and useful context for the Pi coding agent TUI — composable but complete*`
   - Badges row: `[![npm version](https://img.shields.io/npm/v/pi-archimedes?style=flat-square)](https://www.npmjs.com/package/pi-archimedes)`, `[![TypeScript](https://img.shields.io/badge/TypeScript-%3E%3D5.0-blue?style=flat-square)](https://www.typescriptlang.org)`, `[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)`
   - Closing `</div>`

2. **Why pi-archimedes?** (H2)
   - Opening sentence: "pi-archimedes is a modular monorepo of Pi UI extensions. Each package does one thing well and can be installed independently."
   - Bullet list of why-split benefits:
     - Install only what you need
     - Isolate regressions to one package
     - Faster upgrades with smaller diffs
   - "Install `pi-archimedes` (the meta package) to bundle all five for a tightly integrated experience — e.g. subagent cost is pushed to the footer via the shared bus. Or install individual `@pi-archimedes/*` packages."

3. **Features** (H2, contains 6 H3 cards + 1 blockquote callout)
   - Each card: H3 with emoji + package name, then a short list of capabilities
   - 🎬 **Core** (`@pi-archimedes/core`): animated splash screen, framed editor with double-press quit guard, muted thinking blocks
   - 📊 **Footer** (`@pi-archimedes/footer`): compact status bar with directory, git branch (clean/dirty indicator), model, thinking level, worktree, token stats (↑input ↓output + cost), and color-coded context window bar
   - 🔍 **Diff** (`@pi-archimedes/diff`): Shiki-powered split and unified views, word-level emphasis on changed characters, auto-derived theme colors, graceful fallback to plain text
   - 🖼️ **Image-paste** (`@pi-archimedes/image-paste`): paste images from clipboard (Ctrl+V on Linux, Alt+V on Windows) with inline preview
   - 🤖 **Subagent** (`@pi-archimedes/subagent`): dispatch sub-agents with live TUI streaming, parallel execution mode, per-subagent tool counts and token usage, and a unified cost summary
   - 📝 **Agents** (`/agents` command, new in 0.9.0): full CRUD TUI for `.pi/agents/*.md` files — searchable list, model picker, tool picker, dirty-tracking, cross-scope collision warnings. *Note: available when installed via `pi-archimedes` (the meta package), not as a standalone `@pi-archimedes/subagent` install.*
   - **How packages compose** callout (blockquote at the end of the Features section, before Quick Start):
     "When installed via the meta package, the six components share state and cooperate. For example, `@pi-archimedes/subagent` emits cost events through `@pi-archimedes/core/bus`; the footer subscribes via `CostAccumulator` and merges subagent tokens and cost into the main status bar. The agent manager reuses Core's chrome and color palette. Install pieces individually and these integrations are unavailable."

4. **Quick Start** (H2)
   - Code block: `pi install pi-archimedes` (this installs all five)
   - "That's it. Restart Pi and the components load automatically."
   - H3: `### Or install selectively`
   - Bullet list of individual packages:
     - `pi install @pi-archimedes/core`
     - `pi install @pi-archimedes/footer`
     - `pi install @pi-archimedes/diff`
     - `pi install @pi-archimedes/image-paste`
     - `pi install @pi-archimedes/subagent`
   - "Run `/archimedes` to open the interactive settings panel and configure components."

5. **Settings** (H2)
   - Opening sentence: "Run `/archimedes` to open the interactive settings panel. Navigate with arrow keys, press Enter to toggle or edit, Save to persist, ESC to cancel."
   - H3: `### Per-package configuration`
   - Brief explanation: "Each package reads from its own namespace in `~/.pi/agent/settings.json`. For example, `@pi-archimedes/footer` reads from `archimedes.footer`."
   - H3: `### @pi-archimedes/core`
   - Table with columns: Setting, Type, Default, Description
     - `mutedTheme` | bool | `false` | Use subdued colors for thinking blocks
     - `codeUnindent` | bool | `true` | Remove common indentation from code blocks inside thinking sections
     - `labelText` | string | `Thinking...` | Custom prefix shown before thinking blocks
     - `labelColor` | string | `255,215,0` | RGB color for the thinking label
     - `animationStyle` | string | `vertical-up` | Splash animation style (9 options)
   - H3: `### @pi-archimedes/footer`
     - `splitThreshold` | number | `150` | Minimum terminal columns for full footer (below this, simplified layout)
   - H3: `### @pi-archimedes/diff`
     - `diffTheme` | string | `github-dark` | Shiki syntax-highlighting theme
     - `diffSplitMinWidth` | number | `150` | Minimum terminal columns to show split diff view (≥ 100)
     - `diffSplitMinCodeWidth` | number | `60` | Minimum code columns per side in split view (≥ 30)
   - H3: `### @pi-archimedes/image-paste`
     - "Uses Pi's core `terminal.showImages` setting to control inline previews. No package-specific settings."
   - H3: `### @pi-archimedes/subagent`
     - "TBD — no settings yet. Tool/cost events flow through `@pi-archimedes/core/bus` for the footer to consume."

6. **Architecture** (H2)
   - H3: `### Monorepo layout`
   - Code block with the actual tree:
     ```
     pi-archimedes/
     ├── packages/
     │   ├── core/         # @pi-archimedes/core — editor, message, startup, thinking
     │   ├── footer/       # @pi-archimedes/footer — status bar
     │   ├── diff/         # @pi-archimedes/diff — Shiki-powered diff rendering
     │   ├── image-paste/  # @pi-archimedes/image-paste — clipboard images
     │   └── subagent/     # @pi-archimedes/subagent — sub-agent dispatch
     └── meta/             # pi-archimedes — meta-package bundling all five
     ```
   - One sentence: "Each package is a focused TypeScript ESM module with its own `src/index.ts` entry point."
   - Cross-reference: "See [AGENTS.md](../../AGENTS.md) for import conventions, config namespaces, and contribution workflow."
   - H3: `### Requirements`
   - Bullet list: Pi TUI with extension support, Node.js >= 24

**Steps:**
- [ ] Open `README.md`
- [ ] Replace the entire file content with the new structure above
- [ ] Save and preview locally (if possible) to verify Markdown renders
- [ ] Run `git diff README.md` and confirm the diff is large but only the file changed
- [ ] Commit with message: `docs: rewrite README in marketing style (modeled on hephaestus)`

**Acceptance criteria:**
- [ ] `README.md` has all 6 H2 sections in order (Hero, Why, Features, Quick Start, Settings, Architecture)
- [ ] Splash image uses HTML `<img>` tag with `width="600"`, not Markdown `![]()` syntax
- [ ] All 5 packages are documented in the Features section (5 cards)
- [ ] The `/agents` command is documented as a 6th Features card with a real description
- [ ] "How packages compose" callout is present as a blockquote at the end of Features
- [ ] Subagent feature card has a real description (not TBD)
- [ ] Settings section includes per-package deep tables with all 5 packages covered (TBD noted for subagent)
- [ ] Architecture section has the monorepo tree with all 5 packages shown
- [ ] Cross-reference to AGENTS.md is present
- [ ] Commit pushed

---

## Task 4: Add deprecation block to `pi-ui-hephaestus/README.md`

**Context:**
The hephaestus package is being deprecated in favor of pi-archimedes. Users landing on the hephaestus repo or npm page need to know. We add a top-of-README deprecation block with migration instructions and a clear EOL date. The existing content stays below — it's still accurate for users who haven't migrated yet.

**Files:**
- Modify: `../pi-ui-hephaestus/README.md`

**What to implement:**
- At the very top of the file (line 1, before the existing `<div align="center">` block), insert:
  ```markdown
  > ⚠️ **DEPRECATED** — This package is no longer maintained.
  >
  > Please use [`pi-archimedes`](https://github.com/danielcherubini/pi-archimedes) instead, which supersedes this project as a modular monorepo.
  >
  > **Migration:**
  > - Install: `pi install pi-ui-hephaestus` → `pi install pi-archimedes`
  > - Config namespace: `hephaestus.*` → `archimedes.core/diff/footer/image-paste.*`
  > - Same features, plus new packages (`@pi-archimedes/subagent`) and the `/agents` command
  >
  > This repo will be archived on **2026-09-01**.

  ```
- Leave a blank line after the blockquote so it doesn't run into the existing `<div>`
- Do NOT modify any other content in the hephaestus README

**Steps:**
- [ ] Open `/home/daniel/Coding/Javascript/pi-ui-hephaestus/README.md`
- [ ] Insert the blockquote at the top
- [ ] Verify the file still renders correctly (the `<div align="center">` block follows)
- [ ] Commit with message: `docs: deprecate in favor of pi-archimedes`

**Acceptance criteria:**
- [ ] Blockquote appears at the very top of the hephaestus README
- [ ] The link to pi-archimedes is correct
- [ ] The migration instructions match the actual rename (`hephaestus.*` → `archimedes.core/diff/footer/image-paste.*`)
- [ ] The archive date is `2026-09-01`
- [ ] Existing content below is unchanged
- [ ] Commit pushed to the hephaestus repo

---

## Task 5: Open PR(s) for the changes

**Context:**
The four changes touch two repos. Decide on PR strategy and create the PR(s) per the chosen approach.

**Files:**
- No new file edits

**What to implement:**
- **Decision required:** one PR per repo, or one cross-repo PR? Recommendation: two separate PRs because they live in different repos.
  - PR 1: pi-archimedes — splash asset + `pi.image` URL + new README
  - PR 2: pi-ui-hephaestus — deprecation block
- For each PR:
  - Branch off `main` (or the relevant default branch)
  - Title: `docs: README overhaul + splash asset + pi.image update` (archimedes) / `docs: deprecate in favor of pi-archimedes` (hephaestus)
  - Body: short summary + link to `docs/plans/2026-06-14-readme-overhaul.md`
  - Request review from `@danielcherubini`
  - **No version bump** — this is a docs-only change. The current 0.9.0 stays.

**Steps:**
- [ ] For pi-archimedes:
  - [ ] Create branch `feature/readme-overhaul` from `main`
  - [ ] `git push -u origin feature/readme-overhaul`
  - [ ] Open PR with:
    ```bash
    gh pr create \
      --base main \
      --head feature/readme-overhaul \
      --title "docs: README overhaul + splash asset + pi.image update" \
      --reviewer danielcherubini \
      --body "Overhauls the pi-archimedes README from a lean reference to a marketing-style document modeled after pi-ui-hephaestus. Also moves the splash asset and updates the \`pi.image\` URL to point at the archimedes repo.

    Refs: docs/plans/2026-06-14-readme-overhaul.md
    No version bump (docs only)."
    ```
- [ ] For pi-ui-hephaestus:
  - [ ] Create branch `feature/deprecation-notice` from `main`
  - [ ] `git push -u origin feature/deprecation-notice`
  - [ ] Open PR with:
    ```bash
    gh pr create \
      --base main \
      --head feature/deprecation-notice \
      --title "docs: deprecate in favor of pi-archimedes" \
      --reviewer danielcherubini \
      --body "Adds a top-of-README deprecation block pointing users to pi-archimedes. Migration steps cover install command, config namespace, and what's new. Archive date: 2026-09-01.

    Refs: docs/plans/2026-06-14-readme-overhaul.md"
    ```

**Acceptance criteria:**
- [ ] Both PRs are open
- [ ] Both PRs reference the spec
- [ ] Both PRs have a concrete body (not \"...\" placeholder)
- [ ] Both PRs have danielcherubini as a requested reviewer
- [ ] No merge conflicts

---

## Verification (after all tasks)

Run from `/home/daniel/Coding/Javascript/pi-archimedes`:

```bash
# Verify the new README renders locally
cat README.md | head -50

# Verify the splash asset is in place
file docs/splash-screen.png

# Verify pi.image points to the right place
grep -A 1 '"pi"' meta/package.json | head -10

# Verify the hephaestus deprecation block is at the top
head -15 /home/daniel/Coding/Javascript/pi-ui-hephaestus/README.md
```

All four checks should pass before tagging a release.

## Open questions (to resolve at execution time)
- ~~Version bump: 0.9.0 → 0.10.0 (minor) or 0.9.1 (patch docs only)?~~ **Resolved: no version bump. Docs-only change, current 0.9.0 stays.**
- ~~One PR or two?~~ **Resolved: two PRs, one per repo.**
