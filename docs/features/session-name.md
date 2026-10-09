---
status: live
last-verified: 2026-10-09
---

# Session naming

## What it is

`@pi-archimedes/session-name` names a session after its first user + assistant exchange, so `pi -r` lists sessions by topic instead of by timestamp or hash. The title comes from a separate `streamSimple` call outside the main agent run.

## Durable semantics

- **Manual names always win.** Naming is skipped if the session already has a name (`--name`, `/name`), and the name is re-checked immediately before `setSessionName` because the title request is fire-and-forget and could land after the user named the session by hand.
- **One title per session.** A `hasNamed` flag stops further attempts once a name is set; `session_start` clears it.
- **Three attempts per session.** Failures are counted and naming stops after three; the budget resets on `session_start`, so `/reload` gives it another go.
- **Exactly one user-visible warning per session**, emitted on the third failure: *"Session naming failed 3 times. Check the model configuration or use /name."* A provider error or thrown exception additionally logs `[archimedes] session-name failed: <reason>` through `console.error`, matching how the rest of the suite reports (footer, diff, bus). The warning is suppressed when `ctx.hasUI` is false (`pi -p`, JSON mode) or when the session has since been named manually.
- **Non-events do not burn attempts.** A cancelled request (`stopReason: "aborted"`) returns without a failure. So does a **stale extension context**: print-mode teardown or a session replacement can invalidate the ctx while the title request is in flight, and pi's every-accessor `assertActive()` guard then throws from the post-stream re-check. That is detected by message substring and returns silently — the session is gone, so naming is moot, and charging it to the budget would be a category error.
- **Reporting never becomes another failure.** The third-strike notification is wrapped in its own `try/catch`: `ctx.hasUI` is a proxied getter and `ctx.ui.notify` can both throw once the ctx is stale, which would otherwise re-enter the `generateTitle` catch, log a misleading fourth strike, and reject the `void` promise.
- **Skips that are not failures:** ephemeral sessions (no session file) and a model with no configured auth.

## Settings

`archimedes.sessionName`: `model` (defaults to the current model; canonical `provider/id`, bare IDs, and thinking-suffix forms all resolve) and `reasoning` (defaults to `minimal`; `null` omits the option for providers that reject thinking levels). `model` has a "Model for naming" row in `/archimedes`, opened with Enter as free text — blank or `(current model)` stores it as unset. `reasoning` is JSON-only.

`reasoning` is validated at the point of use, not at parse time: casing and surrounding whitespace are tolerated, `null` means "omit the option", and any other unrecognised value is ignored in favour of the default with a `[archimedes] session-name: ignoring unrecognized reasoning <value>` line. Invalid config therefore behaves exactly like absent config. `"off"` is deliberately not accepted — pi already treats an omitted option as no-effort on every adapter, so it would be a fourth spelling of "unset" for no gain.

## Implementation notes

- `generateTitle()` builds the prompt from the first exchange only (500 characters per side), caps the result at 80 characters, and strips surrounding quotes.
- The stale-context check matches on `"stale after session replacement"` because pi exports no error code, class, or `isStale()` probe — `ExtensionRunner.assertActive()` throws a bare `new Error(this.staleMessage)`. If pi rewords that message the guard stops matching and stale ctx becomes a logged strike again, which is loud enough to find this line from the log text.
- The title request passes `cacheRetention: "none"` and a fresh `sessionId`, so it neither pollutes nor reuses the main conversation's prompt cache.
- `resolveTitleReasoning()` guards the value handed to `streamSimple` because most of pi's adapters cannot rescue a bad one. Of the ten adapters in pi-ai 0.87.0 that export a `streamSimple`, three never call `clampThinkingLevel` (`grep -c`, zero occurrences each): `anthropic-messages`, `bedrock-converse-stream`, and `pi-messages` — the Radius adapter, which forwards the level verbatim to its backend. On the Anthropic pair a forwarded non-level reaches their level tables verbatim. On adaptive-thinking models `mapThinkingLevelToEffort` has no `off` case and its `default:` returns `"high"` — a typo silently buys maximum effort on a one-line title. On budget-based models the four-key budget table yields `undefined`, which propagates into `max_tokens` as `NaN` and is rejected by the provider. Omitting the option is well-defined on the Anthropic pair, which request no thinking when `reasoning` is absent; on `pi-messages` an absent level is dropped by `JSON.stringify`, so the Radius backend's own default applies — the same "don't ask, get the provider default" trade-off ADR 0025 weighs.

## Known gaps

- When the model returns no usable text (no text blocks, or text that collapses to empty after quote-stripping), `onFailure()` records a strike with neither a log line nor a reason — unlike the provider-error and exception paths. Harmless, but it is the one failure mode that leaves nothing in the log.
