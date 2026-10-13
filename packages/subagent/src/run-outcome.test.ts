import { describe, it, expect } from "vitest";
import { decideRunOutcome } from "./run-outcome.js";

// The decision table, pinned where it lives. Every row is a case the child can
// actually produce on pi 1.2.0 — see the table comment in `run-outcome.ts` for
// where each one comes from.

const SETTLED = { settledAborted: false, stopReason: undefined, exitCode: 0, signal: undefined };

describe("decideRunOutcome", () => {
  it("completed: exit 0, clean stopReason, settled not aborted", () => {
    expect(decideRunOutcome({ ...SETTLED, stopReason: "stop" })).toBe("completed");
    expect(decideRunOutcome(SETTLED)).toBe("completed");
  });

  it("truncated: stopReason length, whether the child exited 0 (json mode) or 1 (print mode)", () => {
    expect(decideRunOutcome({ ...SETTLED, stopReason: "length" })).toBe("truncated");
    expect(decideRunOutcome({ ...SETTLED, stopReason: "length", exitCode: 1 })).toBe("truncated");
  });

  it("aborted: agent_settled.aborted wins over a clean stopReason and a nonzero exit", () => {
    expect(decideRunOutcome({ ...SETTLED, settledAborted: true })).toBe("aborted");
    expect(decideRunOutcome({ ...SETTLED, settledAborted: true, exitCode: 143 })).toBe("aborted");
    expect(decideRunOutcome({ ...SETTLED, settledAborted: true, stopReason: "length" })).toBe("aborted");
  });

  it("aborted: the provider aborted the last response", () => {
    expect(decideRunOutcome({ ...SETTLED, stopReason: "aborted" })).toBe("aborted");
  });

  it("aborted: killed by a cancellation signal before it could settle", () => {
    const killed = { ...SETTLED, exitCode: null };
    expect(decideRunOutcome({ ...killed, signal: "SIGTERM" })).toBe("aborted");
    expect(decideRunOutcome({ ...killed, signal: "SIGKILL" })).toBe("aborted");
    expect(decideRunOutcome({ ...killed, signal: "SIGHUP" })).toBe("aborted");
    expect(decideRunOutcome({ ...killed, signal: "SIGINT" })).toBe("aborted");
  });

  it("aborted: pi's own signal handlers exit 143/129 instead of dying by the signal", () => {
    // Observed against a real 1.2.0 child SIGTERM'd mid-run: `close` reported
    // code 143 and NO signal, because print mode catches SIGTERM/SIGHUP and
    // calls process.exit(143)/process.exit(129) itself
    // (`dist/modes/print-mode.js`, registerSignalHandlers). Reading only
    // `signal` would call a cancellation a failure.
    expect(decideRunOutcome({ ...SETTLED, exitCode: 143 })).toBe("aborted");
    expect(decideRunOutcome({ ...SETTLED, exitCode: 129 })).toBe("aborted");
    // A completed last response does not make a cancelled child un-cancelled.
    expect(decideRunOutcome({ ...SETTLED, exitCode: 143, stopReason: "stop" })).toBe("aborted");
    // And it outranks the shapes a cancellation can leave behind on the way out.
    expect(decideRunOutcome({ ...SETTLED, exitCode: 143, stopReason: "error" })).toBe("aborted");
  });

  it("failed: the child's last response errored, whatever the exit code says", () => {
    expect(decideRunOutcome({ ...SETTLED, stopReason: "error", exitCode: 1 })).toBe("failed");
    expect(decideRunOutcome({ ...SETTLED, stopReason: "error", exitCode: 0 })).toBe("failed");
  });

  it("failed: a nonzero exit with no run behind it", () => {
    expect(decideRunOutcome({ ...SETTLED, exitCode: 1 })).toBe("failed");
    expect(decideRunOutcome({ ...SETTLED, exitCode: 2 })).toBe("failed");
    // 130 (SIGINT) is NOT one of pi's handler exits — SIGINT is uncaught, so it
    // arrives as a signal death above; anything else stays a failure.
    expect(decideRunOutcome({ ...SETTLED, exitCode: 130 })).toBe("failed");
    expect(decideRunOutcome({ ...SETTLED, exitCode: 137 })).toBe("failed");
  });

  it("failed: a crash on an unexpected signal is not someone cancelling", () => {
    expect(decideRunOutcome({ ...SETTLED, exitCode: null, signal: "SIGSEGV" })).toBe("failed");
    expect(decideRunOutcome({ ...SETTLED, exitCode: null, signal: undefined })).toBe("failed");
  });
});
