---
status: accepted
date: 2026-10-13
superseded-by:
---

# Target fullscreen screen first, and gate scrollback-native features off it

pi 1.0.0 changed the default *screen mode* — the `tuiMode` setting, whose values are regular screen (`"regular"`, output flows into terminal scrollback) and fullscreen screen (`"fullscreen"`, components render into a clipped, height-allocated, wheel-routed viewport) — from regular to fullscreen (`settings-defaults.d.ts:59`). Nothing in this suite had any notion of the axis: `grep -rn "fullscreen\|tuiMode\|altScreen"` across `packages/` and `meta/src` returned nothing, while the suite patches the editor, the bash and codemode tool rows, the thinking renderer, the startup splash, and several overlays. We decided to treat fullscreen screen as the primary target and to suppress the features that are scrollback-native by construction, rather than render them partially.

Detection is supported and cheap, which is what makes the stance available at all: pi-tui exports `isViewportTUI(tui)` (`pi-tui/dist/index.d.ts:32`), so a component asks the renderer it was handed rather than guessing from settings. `pi.getSettings().tuiMode` remains available as *intent*, but the predicate is *fact*, and a component that has a `tui` should never prefer the weaker source. The stance is also forced by the fact that screen mode is mutable mid-session: `switchTuiMode()` (`interactive-mode.js:604`) stops the running TUI, constructs a new one, re-mounts every child into it, and rebinds extension terminal-input listeners — triggered in-session by the user flipping `tuiMode` in `/settings` (`interactive-mode.js:4238`) and at exit by `fullscreenExitOutput: "transcript"`. Any cached `tui` becomes a stopped renderer that still accepts writes without throwing, which is the failure mode this decision is mostly about.

**Considered Options**

- **Both screens fully first-class** — the maximal promise, and rejected on cost rather than principle: it means re-implementing scrollback semantics inside a clipped viewport for the splash animation and the startup resource listing, on a surface pi now owns and where `quietStartup` is the supported knob. That is new UI, not a port, and it does not belong in a compatibility effort.
- **Force regular screen from the suite** — rejected, and not merely because it overrides a user setting. It is unavailable: pi flips the mode itself (`stopInteractiveTui` → `switchTuiMode("regular", …)`), so an override would leave us asserting a state that is not true, and it is the same move ADR 0024 rejected for the mcp package — our configuration silently disabling a host behaviour.
- **Fullscreen only, drop regular screen** — rejected: `--tui-mode regular` and the `tuiMode` setting are first-party escapes users will use, especially over SSH or on terminals where the alt-screen behaves badly. Supporting them costs almost nothing once the fit rules are in place.
- **Detect and adapt per component, ad hoc** — rejected as a design, not as an idea: five packages each re-deriving their own policy from `isViewportTUI` is how the drift got unnoticed this time.

**Consequences**

- Two named screen capabilities carry all policy, resolved at render time: `transcriptWrite` (may append into scrollback — off on fullscreen) and `frameBounded` (must fit an allocated height, wheel-routed, selection owned by the app — on fullscreen). Nothing else differs today and nothing speculative was added.
- On fullscreen screen the suite deliberately shows *less*: the splash animation and the startup resource listing are suppressed. This is a promise, not a defect. Removing the underlying `addChild` patch (Section 5 of the spec) is what makes the gate a safety net rather than a crutch.
- A `tui` reference is never stored. Every render path we own receives a fresh one (`setFooter(factory(tui, …))`, `setHeader`, `ui.custom()`, `setEditorComponent`), so caching was never necessary — but the stale reference fails silently, so the rule is enforced by a test that rejects assigning a `tui` to a field or module binding.
- `switchTuiMode()` refuses to switch while an overlay is open (`hasOverlayEntries`), so our overlays can never be orphaned by a mode change. The reverse is a documented user-facing wart: while `/agents` or `/archimedes` is open, a `tuiMode` change is refused. There is no API to pre-empt it, so if pi does not surface the refusal we document the interaction instead of coding around it.
- Fullscreen raises the severity of things that were merely untidy on regular screen. Writes to `console.*` from a render path, and component lines wider than the frame, went unnoticed in scrollback because they scrolled away; inside a viewport they smear until the next full redraw. Those fixes are consequences of this stance, not separate findings.
