import type { RunOutcome } from "./types.js";

// ── The *Run outcome* decision table (CONTEXT.md vocabulary, ADR 0028) ──────
//
// The child's exit code cannot tell these apart, and after pi 1.2.0 it cannot
// even be trusted to mean "failed": print mode exits **1** when the final
// response hit the output token limit, so a useful-but-cut-off answer arrives as
// the same `1` as a crash. `stream.ts` used to reduce the child to `code ?? 1`,
// which destroyed that distinction exactly where the plan says it must not.
//
// The two signals that do carry it are the child's own `stopReason` (on the last
// assistant `message_end`) and pi 1.1.0's `agent_settled.aborted`. Note that
// `--mode json` — what the child actually runs — does *not* map `stopReason` onto
// the exit code at all (that mapping lives in print mode's text branch), so a
// json child reports truncation through `stopReason` alone and exits 0. Both
// shapes are handled: truncation is read from the child, never inferred from
// the code.
//
// | input                                                       | outcome     |
// |-------------------------------------------------------------|-------------|
// | `agent_settled.aborted: true`                               | aborted     |
// | last assistant `stopReason: "aborted"`                      | aborted     |
// | killed by a cancellation signal (SIGKILL/SIGINT — uncaught) | aborted     |
// | exit 143 / 129 (pi caught SIGTERM / SIGHUP and exited)      | aborted     |
// | last assistant `stopReason: "error"`                        | failed      |
// | any other nonzero exit                                      | failed      |
// | killed by an unexpected signal (SIGSEGV, …)                 | failed      |
// | last assistant `stopReason: "length"` — exit 0 **or** 1     | truncated   |
// | exit 0, nothing above matched                               | completed   |
//
// `truncated` is not an error and neither is `aborted`; `failed` is, and is what
// the caller reports as one (the result carries no outcome in that case).

/** Signals that mean "someone cancelled this run", as opposed to "it broke". */
const CANCELLATION_SIGNALS = new Set(["SIGTERM", "SIGKILL", "SIGHUP", "SIGINT"]);

/**
 * The same cancellation, arriving as an exit code instead of a signal.
 *
 * print mode catches SIGTERM (and SIGHUP on non-Windows) and exits by itself —
 * `process.exit(signal === "SIGHUP" ? 129 : 143)`
 * (`pi-coding-agent/dist/modes/print-mode.js`, `registerSignalHandlers`) — so a
 * real SIGTERM'd child closes with code 143 and **no** signal, which the table
 * would otherwise read as an ordinary failure. Verified against a live 1.2.0
 * child killed mid-run. SIGINT is not caught, so it still arrives as a signal
 * death; SIGKILL cannot be caught at all. Hence exactly these two codes.
 */
const CANCELLATION_EXIT_CODES = new Set([143, 129]);

export interface RunOutcomeInput {
  /** `agent_settled.aborted` seen on the child's event stream. */
  settledAborted: boolean;
  /** `stopReason` of the last assistant message the child emitted. */
  stopReason: string | undefined;
  /** Process exit code, or `null` when it was terminated by a signal. */
  exitCode: number | null;
  /** The terminating signal, when there was one. */
  signal: string | undefined;
}

/**
 * Decide the run's terminal state, or `failed` when the run did not reach one.
 *
 * Order is the table above: cancellation first (an aborted run's `stopReason` may
 * be `error` or `length` on the way out), then the child's own account of how its
 * last response ended, then the exit code — the least informative of the three.
 */
export function decideRunOutcome(input: RunOutcomeInput): RunOutcome | "failed" {
  if (input.settledAborted) return "aborted";
  if (input.stopReason === "aborted") return "aborted";
  if (input.exitCode === null) {
    return CANCELLATION_SIGNALS.has(input.signal ?? "") ? "aborted" : "failed";
  }
  if (CANCELLATION_EXIT_CODES.has(input.exitCode)) return "aborted";
  if (input.stopReason === "error") return "failed";
  if (input.stopReason === "length") return "truncated";
  if (input.exitCode !== 0) return "failed";
  return "completed";
}
