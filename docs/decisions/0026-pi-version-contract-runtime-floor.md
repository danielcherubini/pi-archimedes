---
status: accepted
date: 2026-10-13
superseded-by:
---

# Declare pi floors honestly, and enforce them at runtime rather than in `peerDependencies`

pi 1.2.0 moved the installed runtime eleven releases ahead of the version this suite type-checks against (0.87.0 → 1.2.0 across 0.87.1, 0.99.0–0.99.2, 1.0.0–1.0.4, 1.1.0), and doing that audit surfaced two facts that make our existing version metadata close to meaningless. We decided to move dev type-check targets to exact `1.2.0`, raise `peerDependencies` floors only where behaviour actually requires it, add a runtime host-version check, and add a floating `pi@latest` type-check job that runs on a schedule as well as on PRs.

The first fact is that **pi does not follow semver, and says so in writing** — upstream `.pi/skills/release.md`: *"Lockstep versioning: all packages share one version … `patch` = fixes + additions, `minor` = breaking changes. No major releases."* So `^1.0.0` asserts "accept every future breaking change", and an upper bound like `<2` is decorative: 2.0 is never coming to enforce it. This is not theoretical — 1.2.0 shipped breaking changes (`BeforeAgentStartEvent` became a union on `messageType`; `ctx.isIdle()` became false while a run starts; `pi.sendUserMessage()` began requiring `deliverAs`), and so did **1.0.3, a patch**, which renamed the Azure provider and required users to migrate `auth.json`/`models.json`/`settings.json`. Note also that 0.88–0.98 were **never published**: 0.99.x was an RC runway for a merge, so the version history is not a linear 0.8x progression and anyone reasoning about our past floors from the numbers alone will get it wrong.

The second fact is that **pi never validates a peer range**, so the ranges we publish cannot protect anything. Managed installs pass `--legacy-peer-deps` (npm), `--config.auto-install-peers=false --config.strict-peer-dependencies=false` (pnpm), and `--omit=peer` (bun) — `dist/core/package-manager.js:1497-1526` — so peers are never installed, never solved, and never warned about. At runtime the loader aliases every host-provided specifier to pi's own copies (`dist/core/extensions/loader.js:37-84`), so `import { Editor } from "@earendil-works/pi-tui"` always receives the host's code regardless of what a package declared. The only manifest check pi performs reads `manifest.dependencies` and never parses `peerDependencies` (`resource-loader.js`, which warns if a host package appears in `dependencies` instead of `peers`), and there is no `engines` enforcement. `>=0.1.0` and `*` are therefore byte-for-byte equivalent at install time. The corollary is uncomfortable but clarifying: choosing a peer range is a **documentation and CI-signal** decision, never a resolution-safety one.

Given that, we picked asymmetric floors over pi's documented `"*"` convention (`docs/packages.md:88`) because this suite already has a peer policy in ADR 0013 — *"packages whose new code only needs types from pi stay `>=0.1.0` peers because those call sites are runtime-safe on older pi"* — and it is the only convention under which a published floor carries information a human can act on. Floors move to `>=1.2.0` only for `ui`, `diff`, and `subagent`, where the code we are adopting does not work below it (`pi.registerToolRenderer()` is 1.0.1, `durationMs` is 1.1.0, and subagent depends on 1.0.4's `--tools` semantics, 1.1.0's `agent_settled.aborted`, and 1.2.0's print-mode exit code). `notify` deliberately stays at `>=0.84.4` and `core` at `>=0.85.0`: their newer call sites are payload-agnostic or fall back, so they remain runtime-safe below the floor — which is also why the fallbacks are load-bearing for this decision, not incidental.

**Considered Options**

- **`"*"` peers everywhere** — pi's documented convention and the most honest statement of "we do not know what you run", and the strongest candidate. Rejected only because it discards the ADR 0013 signal: an npm reader, and anyone consuming a package outside pi's loader, loses the one hint about minimum host. If pi ever starts honouring peers, this becomes the right answer again.
- **Uniform `>=1.2.0` peers** — rejected: implies all twelve packages need 1.2.0 behaviour when most do not, which is the same lie in the safe-looking direction.
- **`>=0.87.0`, or keeping `>=0.1.0` untouched** — rejected: an open-ended "works from X upward" claim that pi's own changelog contradicts, unenforced either way. `>=0.1.0` in particular asserts compatibility across a major boundary we have never tested.
- **Bump devDeps and nothing else** — rejected: the suite would still validate published artifacts against a stale API. Both `ci.yml` and `release.yml` run `pnpm install --frozen-lockfile`, and the lockfile resolved to exactly 0.87.0, so `release.yml` type-checked every published version against a 21-day-old contract.

**Consequences**

- The runtime check is the only mechanism that can actually reach a user, so it is not optional polish. It reads the already-imported `VERSION`, warns once per session through the suite's own notification surface rather than `console.*` (a stray write smears the fullscreen viewport), and `meta` aggregates the messages so a mismatched host yields one line rather than one per package. It **warns and still registers**: refusing to load would make `/plugins` report an enabled package that loaded nothing, and ADR 0024 already gives us the correct instrument — deprecation — for something that genuinely cannot work.
- The floating `pi@latest` job must be **scheduled**, not merely PR-triggered. Under minor-means-breaking, a float job that only runs when we touch the repo is green exactly as long as we leave it alone.
- devDeps are pinned **exactly** at `1.2.0`, not `^1.2.0`, so the floor job's name means something and an unannounced pi minor cannot move the type-check target underneath us. Upstream pins its own dependencies for the same reason.
- `@types/node` stays held at **22.19.19** (matching root `devDependencies` and upstream `pi-coding-agent` `devDependencies`). pi 1.2.0 bundles 26.6.5, where `ChildProcess extends InternalEventEmitter<ChildProcessEventMap>`; resolving both copies into one program yields three false `Property 'on' does not exist` errors in `packages/image-paste/src/clipboard.ts` and `packages/sudo/src/tool.ts` that look exactly like real breakage. This pin will read as stale to a future contributor and must not be "cleaned up" without re-running the type check.
- `pnpm-lock.yaml` must be regenerated in the same commit as the range change, or both `--frozen-lockfile` jobs fail with `ERR_PNPM_OUTDATED_LOCKFILE`.
- Peer ranges still buy no protection at install time. If pi begins validating them, every `>=0.1.0` in this monorepo becomes a live false claim and this decision should be revisited.

## Amendment (2026-10-14): every floor re-verified against the published declarations

The set this decision recorded was chosen before three things merged: **#110** (tools declaring `outputSchema` and returning `structuredContent`, plus `annotations` and `exposure`, and `ask`'s note drawing its caret with pi-tui's `renderFakeCursor`), **#111** (`meta`'s settings overlay rebuilt on pi-tui's `SettingsList`), and the `pi.events` transport work ADR 0029 records. Each moved the oldest host its package can actually run on, so the 2026-10-13 set had become a set of claims the code no longer honoured — in the permissive direction, which is the dangerous one.

**Verified, not reasoned from version numbers.** Every non-test import and `pi.*` / `ctx.ui.*` call site was listed per package and checked against the `.d.ts` files of the actual npm tarballs of `@earendil-works/pi-coding-agent`, `pi-tui` and `pi-ai` at 0.84.4, 0.85.0, 0.86.0, 0.87.0, 0.99.0, 1.0.0, 1.0.1, 1.0.2, 1.0.3, 1.1.0 and 1.2.0. Two rules came out of that:

1. **One floor per package, across all its pi peers.** The family is published in lockstep, so no install has `pi-coding-agent@1.1.0` with `pi-tui@1.2.0`; splitting the numbers per package would describe a host that cannot exist. A package's floor is the oldest published train whose declarations provide every host symbol its shipped code touches.
2. **A guarded or optional symbol does not raise a floor.** `NativeClipboard.getFilePaths?()` (0.99.0) is behind optional chaining, so `image-paste` stays at `>=0.86.0`; `pi.getSettings()` (0.99.0) sits behind `core/src/settings-io.ts`'s file-read fallback, so `core` stays at `>=0.85.0`; `foregroundAnsi` (0.99.0) is read off a namespace import and cast to possibly-undefined (`core/src/chrome.ts`), so an old host loses the tint, not the palette. Those fallbacks are the reason the floors can stay low — as before, they are load-bearing.

| package | floor | what sets it (verified in that train's own declarations) |
| --- | --- | --- |
| `core` | `>=0.85.0` | unchanged. `pi.events` present at 0.84.4 (`types.d.ts:1077`); `pi.getSettings` only from 0.99.0, reached through the fallback above |
| `ui` | `>=1.2.0` | unchanged: `pi.registerToolRenderer()` (1.0.1) and `ToolRenderContext.durationMs`/`outputPad` (1.1.0); also its own `reportPiSupport("ui", "1.2.0")` |
| `diff` | `>=1.2.0` | unchanged for the same two symbols; `pi-tui` raised from `>=0.1.0` to match |
| `subagent` | `>=1.2.0` | unchanged: `agent_settled.aborted` is 1.1.0 (absent in 1.0.3), print-mode exit code is 1.2.0; `pi-tui` raised to match |
| `meta` | `>=1.2.0` | was `>=0.1.0`. `SettingsList` is old (0.84.4), but `meta` registers `ui`, `diff` and `subagent`, all of which self-report 1.2.0 — a suite whose own components say "below 1.2.0 I am degraded" does not support 0.84 |
| `ask` | `>=1.2.0` | was `>=0.85.0`. `renderFakeCursor` exists in **no** pi-tui before 1.2.0 and `note.ts` imports it by name, so on 1.1.0 the note's caret is a link error, not a degradation |
| `todo` | `>=0.99.0` | was `>=0.85.0`. `outputSchema` is 0.99.0 (`types.d.ts:457`); 0.87.0's declarations have no such field, so the structured payload it promises silently does not exist below it |
| `sudo` | `>=0.99.0` | was `>=0.1.0`. `annotations` (`destructiveHint`) is 0.99.0 (`types.d.ts:465`) |
| `web` | `>=0.99.0` | was `>=0.1.0`. `outputSchema` on three tools, `openWorldHint`, and a `pi.getSettings()` call (0.99.0, `types.d.ts:1236`) |
| `footer` | `>=0.84.4` | was `>=0.1.0`. It touches no `pi.events`, no renderer API and no `SettingsList`; everything it calls (`pi.getThinkingLevel`, `ctx.getContextUsage`, `setFooter`/`setStatus`) is present at 0.84.4, so the honest change is a real number rather than a placeholder |
| `notify` | `>=0.84.4` | unchanged for `pi-coding-agent` (ADR 0013); its `pi-tui` peer moves from `>=0.1.0` to the same number for the train rule |
| `image-paste` | `>=0.86.0` | unchanged, and now positively justified: `getNativeClipboard()` — the package's only clipboard primitive — first appears in pi-tui 0.86.0 and is absent from 0.85.0 |
| `session-name` | `>=0.86.0` | unchanged: everything it uses is present at 0.84.4, so the declared floor is conservative-but-published, which is the acceptable direction |

**`>=0.1.0` is gone from the manifests entirely.** Not only is it unevaluated at install time (this decision's opening fact); `0.1.0` **was never published** for `pi-coding-agent`, `pi-tui` or `pi-ai` — the oldest release of each on npm is `0.74.0` — so it never described a host, not even vacuously "from the beginning". ADR 0013's exemption ("packages whose new code only needs *types* from pi stay `>=0.1.0`") is not overruled, it simply has no members any more: every package in the suite calls host values at runtime. If a genuinely types-only package is added, the exemption is available again and this table should not be read as banning it.

## Amendment (2026-10-29, pi 1.4.0)

The compile-time target in `devDependencies` across all 13 package manifests is bumped from `"1.2.0"` to `"1.4.0"`. In accordance with this ADR:
1. Published `peerDependencies` floors remain at their honest minima (e.g. `>=1.2.0` for ui/diff/subagent/ask/meta, `>=0.85.0` for core, etc.) because existing runtime code requires no 1.4.0-exclusive APIs.
2. The `@types/node` hold at `22.19.19` remains in place to avoid the 26.x `ChildProcess` event signature mismatch.
3. The temporary `minimumReleaseAgeExclude` entries for 1.2.0 in `pnpm-workspace.yaml` were deleted following the expiration of their 24h release-age window.

