# pi-archimedes README + Hephaestus deprecation

## Status
📋 DRAFT

## Goal
Overhaul the pi-archimedes README from a lean reference to a marketing-style document modeled after pi-ui-hephaestus. Add a deprecation block to hephaestus pointing users to pi-archimedes. Update `pi.image` in `meta/package.json` to point to the archimedes repo.

## Affected repos
- `pi-archimedes` (active monorepo) — new README, splash asset move, `pi.image` URL update
- `pi-ui-hephaestus` (deprecated) — top-of-README deprecation block

## Decisions (locked)
- README style: marketing-style like hephaestus
- Splash: reuse hephaestus splash for now, swap later (copy `docs/splash-screen.png`)
- Deprecation notice: full block with migration link
- `pi.image` field: keep and update URL (Pi's extensions website reads it)
- Hero tagline: emphasizes "composable but complete"
- Architecture section: cross-ref to AGENTS.md instead of duplicating
- Architecture section: no mention of hephaestus
- Subagent feature card: real description (not TBD)

## A. New pi-archimedes README

**File:** `README.md`

### Section 1 — Hero
- Centered splash image (from hephaestus, copied to `docs/splash-screen.png`, attribution in alt text)
- Project name + tagline: "Visual polish and useful context for the Pi coding agent TUI — composable but complete"
- npm badges: version, TypeScript, License

### Section 2 — Why pi-archimedes?
- (a) What it is: modular monorepo of Pi UI extensions
- (b) Why split: install only what you need, isolate regressions, faster upgrades
- (c) Integration: install `pi-archimedes` (bundles all five) for a tightly integrated experience, or pick the ones you need

### Section 3 — Features (one card per package)
- 🎬 **Core** (`@pi-archimedes/core`): animated splash, framed editor with quit guard, muted thinking blocks
- 📊 **Footer** (`@pi-archimedes/footer`): table of status elements (dir, git, model, thinking, worktree, tokens, context bar)
- 🔍 **Diff** (`@pi-archimedes/diff`): Shiki split/unified, word-level emphasis, theme-aware, graceful fallback
- 🖼️ **Image-paste** (`@pi-archimedes/image-paste`): Ctrl+V (Linux) / Alt+V (Windows) clipboard, inline preview via Pi's image rendering
- 🤖 **Subagent** (`@pi-archimedes/subagent`): dispatch agents with live TUI streaming, parallel execution, per-subagent tool counts/tokens/duration, cost summary
- 📝 **Agents** (`/agents` command, new in 0.9.0): full CRUD TUI for `.pi/agents/*.md`, searchable list, model picker, tool picker, dirty-tracking, cross-scope collision warnings. Available when installed via `pi-archimedes` (meta), not standalone `@pi-archimedes/subagent`

**How packages compose** callout: when installed via meta, subagent emits cost events via `@pi-archimedes/core/bus` → footer's `CostAccumulator` subscribes and merges subagent tokens/cost with main agent stats.

### Section 4 — Quick Start
- Lead: `pi install pi-archimedes` (drop-in hephaestus replacement)
- Then: "Or install selectively" listing individual `@pi-archimedes/*` packages
- Mention `/archimedes` command for settings access

### Section 5 — Settings
- Per-package deep tables with actual config keys, types, defaults
- Image-paste: "uses Pi's `terminal.showImages` (no package settings)"
- Subagent: "TBD — no settings yet"
- Settings section leads with: "Run `/archimedes` to open the interactive settings panel"

### Section 6 — Architecture
- Monorepo tree (5 packages + meta)
- Per-package `src/` layout
- Cross-reference to AGENTS.md for import rules and config namespaces (not duplicated)
- Closing "Requirements" block (Pi TUI, Node.js >= 24)
- No mention of hephaestus

## B. Hephaestus README deprecation

**File:** `pi-ui-hephaestus/README.md`

Add at the very top (before the existing header block):

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

## C. Update `pi.image` in `meta/package.json`

**File:** `meta/package.json`

Change `pi.image` URL from:
```
https://raw.githubusercontent.com/danielcherubini/pi-ui-hephaestus/main/docs/splash-screen.png
```
to:
```
https://raw.githubusercontent.com/danielcherubini/pi-archimedes/main/docs/splash-screen.png
```

## D. Asset move

**Action:** Copy `pi-ui-hephaestus/docs/splash-screen.png` → `pi-archimedes/docs/splash-screen.png`.

## Implementation checklist
- [ ] Copy splash PNG from hephaestus
- [ ] Update `pi.image` URL in `meta/package.json`
- [ ] Rewrite `pi-archimedes/README.md` per spec
- [ ] Add deprecation block to `pi-ui-hephaestus/README.md`
- [ ] Bump `pi-archimedes` version (minor: 0.9.0 → 0.10.0? — to be decided)
- [ ] Open PR

## Open questions
- Version bump: 0.9.0 → 0.10.0 (minor feature) or 0.9.1 (patch docs only)?
- Should this be one PR or two (one for archimedes, one for hephaestus)?
