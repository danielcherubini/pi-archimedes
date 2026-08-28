# Plugin enable/disable via a single global gate

We decided (2026-08, design discussion) to add a plugin manager to the meta orchestrator: an explicit manifest of the non-core packages meta composes, an `archimedes.plugins` settings namespace (`{ [pluginId]: boolean }`) as the **single global enable gate**, and a `/plugins` slash command that opens a toggle-list overlay (the existing `SettingsManager` TUI) so users can enable/disable optional packages and isolate them out.

The manifest is **discovery-driven, not a hardcoded optional list**: each entry carries an `import()` loader; an entry is shown as installed only when its import resolves, and core is never listed (it cannot be disabled). This satisfies "only show what's installed" — someone who installs just `footer` gets only a footer entry, someone who installs the full meta suite gets the full list, all default-enabled.

Enforcement is one gate applied at **three surface points**: (1) registration — `register*()` calls for disabled packages are skipped in meta's factory and session_start, which also skips their internal session/tool/command subscriptions; (2) settings items — `openSettings()` does not compose disabled packages' items; (3) shutdown — disabled packages' cleanup references (e.g. `imagePasteShutdown`) are guarded.

We decided the gate is **single**: `archimedes.plugins.{id}` replaces any per-package `enabled` flag. In particular, plan-030's `archimedes.sudo.enabled` is superseded — sudo becomes the first plugin in the manifest (its own config loses the `enabled` field). Rationale: one place to look, one toggle to operate, and disabling a package skips its registration entirely rather than leaving an inert half-registered surface.

Considered and rejected:

- **Per-package `enabled` flags everywhere** (e.g. `archimedes.sudo.enabled`) — multiple toggles, no single discoverable place; a package could be "enabled" in two conflicting spots.
- **Runtime scan of meta's package.json dependencies** — magical, no label/description metadata, and no way to carry a lazy loader per package; the explicit manifest is greppable and self-documenting.
- **Folding the toggle into `/archimedes`** as a section — a dedicated `/plugins` command is discoverable and keeps the settings menu focused on values, not on which extensions are mounted.
- **Hardcoded "optional" list** (only heavy packages toggleable) — the user rejected this: what's "optional" should depend on what's installed, not on our judgment about specific packages.

Consequences: `archimedes.plugins` becomes the canonical on/off switch for the whole suite (except core). Toggling takes effect on the next session/reload (registration is session-scoped — pi creates a fresh Extension per session). The manifest must be kept in sync when new packages are added (AGENTS.md's "Adding a New Package" checklist gains a manifest entry). Plan-030 (sudo) must NOT ship its own `enabled` flag; it relies on the plugin gate.