// ── The `thinking:` field: what the child will actually accept ─────────────
//
// A child is spawned with `--thinking <level>`, and pi's CLI parser keeps its
// own list (`pi/dist/cli/args.js`: `VALID_THINKING_LEVELS`, `isValidThinkingLevel`).
// A level outside that list is **not** an error there: the parser pushes a
// `warning` diagnostic and drops the flag, so the child runs at the default
// thinking level while the config says something else. In `--mode json` that
// warning goes to stderr, and `stream.ts` only reads stderr for a *failed* run —
// so a successful dispatch reported "thinking: medium" having run nothing of the
// sort. Greptile found it; a live 1.2.0 child confirmed the mechanism.
//
// So the suite drops the same value first and says so out loud, at dispatch,
// where the user is watching. Not a refusal: the run still happens, at exactly
// the level pi would have used anyway — the difference is that it is now named
// instead of swallowed. That is also what keeps this safe across a pi upgrade
// that *adds* a level: the worst case is a warning and the default, never a
// dispatch refused over a word the host has since learned.
//
// The list is duplicated here because there is no other way to read it. pi
// exports only `"."` and `"./rpc-entry"` (its package `exports` map), so
// `@earendil-works/pi-coding-agent/dist/cli/args.js` — where `isValidThinkingLevel`
// and `VALID_THINKING_LEVELS` live — is not importable; the root entry does not
// re-export either, nor the `ThinkingLevel` type that would pin the set at
// compile time (that lives in `@earendil-works/pi-agent-core`, which this package
// cannot resolve). So the copy below is checked by test, not by the host, and the
// warning names the pi version it was read from — `thinking-validation.test.ts`
// pins both. `model-validation.ts` (ADR 0008) already keeps a host-owned set the
// same way for model ids, obtaining those through the `modelRegistry` handle
// instead, which for levels does not exist.

/** pi's own `VALID_THINKING_LEVELS` were read from, and the version they were
 * read from. The warning quotes the version so a reader on a newer host knows
 * which list they are being handed. */
export const THINKING_LEVELS_PI_VERSION = "1.4.0";

/** pi 1.4.0's `VALID_THINKING_LEVELS`, in pi's order. */
export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

/** Whether `level` is a thinking level pi's own `--thinking` accepts. */
export function isThinkingLevel(level: unknown): level is string {
  return typeof level === "string" && (THINKING_LEVELS as readonly string[]).includes(level);
}

/**
 * The thinking level to put on the child's command line, and what to say about
 * the one we are not putting there.
 *
 * `level` is what to pass (undefined = no `--thinking` flag at all); `warning`
 * is set when the config asked for something pi would have dropped anyway.
 */
export function resolveThinkingLevel(
  configured: string | undefined,
): { level: string | undefined; warning: string | undefined } {
  if (configured === undefined || configured === "") return { level: undefined, warning: undefined };
  if (isThinkingLevel(configured)) return { level: configured, warning: undefined };
  return { level: undefined, warning: formatUnknownThinkingWarning(configured) };
}

/**
 * The warning for a level pi's `--thinking` does not take.
 *
 * It names the value, the accepted set, and what the child is running at
 * instead — "the flag was dropped" is only useful if you learn the consequence.
 */
export function formatUnknownThinkingWarning(configured: string): string {
  return [
    `Subagent asked for thinking level "${configured}", which pi's --thinking does not take.`,
    `The run proceeds at pi's default thinking level. Valid levels (pi ${THINKING_LEVELS_PI_VERSION}): ${THINKING_LEVELS.join(", ")}.`,
  ].join(" ");
}
