---
status: accepted
date: 2026-10-09
superseded-by:
---

# Keep `minimal` as the default reasoning level for title requests

`archimedes.sessionName.reasoning` (#81) lets a user pick the thinking level for the one-off title request; this decides what is asked for when they haven't configured one. We keep `minimal` rather than omitting the option (#85).

The two candidate defaults fail in opposite directions, and no provider description settles which failure you get. Requesting no level is cheapest on providers that declare an `off` mapping, but on a provider that leaves thinking on and declares nothing, thinking simply stays on — every session title pays for reasoning, and nothing reports it, because the request succeeded. Requesting `minimal` is a cheap floor on both, and fails only on a provider that accepts `low`/`medium`/`off` but rejects `minimal` (#80's reporter hit HTTP 400 exactly there). The model registry does not mark `minimal` unsupported for such a provider, so pi's clamp can't intervene; the request just fails.

The deciding factor is which failure the user can find. The `minimal` failure is loud and self-healing: #82's third-strike warning fires, `[archimedes] session-name failed: 400 …` lands in the log, and the fix is one line of `settings.json` (`"reasoning": null`). The omit-the-default failure is silent spend with no warning path at all — the same class of problem #86 fixes, where an unrecognised level buys *more* thinking on Anthropic/Bedrock without failing. We prefer a failure that announces itself over a cost that doesn't.

**Considered Options**

- **Default to no level** — rejected: cheapest on well-described providers, but on providers that think by default it is invisible recurring spend, and the failure is unobservable by design.
- **Keep `minimal`, retry once with no level on `stopReason: "error"`** — rejected: self-heals the #80 case without touching the common path, but doubles the call volume on precisely the broken providers, and a second request per turn makes #82's three-strike budget hard to reason about (three warnings' worth of attempts, six requests). Untested against real providers. Deferred rather than dismissed: if #80-style 400s turn out to be common rather than anecdotal, this is the fallback worth revisiting.

**Consequences**

- Users on a provider that rejects `minimal` must set `"reasoning": null` by hand. #82's warning plus the logged provider error are what make that discoverable, so the warning's wording and the log line are load-bearing for this decision, not incidental.
- `minimal` is a floor we ask for, not one pi guarantees: pi clamps only on the adapters that call `clampThinkingLevel`, and an unrecognised level clamps to the *lowest available*, which is provider-dependent.
- Now that #86 validates the setting, a typo (`"Minimal"`, `"ultra"`) is treated as absent config and so falls back to this default. That makes the default the value junk config resolves to, which is a further reason to prefer the safe floor over an omission.
