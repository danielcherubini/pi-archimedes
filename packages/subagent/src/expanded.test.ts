import { describe, it, expect } from "vitest";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { buildExpandedText, buildProgressExpandedText, renderExpanded, renderProgressExpanded } from "./expanded.js";
import { RowBlock, type RowSegment, RESET } from "./row-block.js";
import type { RunOutcome, SubagentProgress, SubagentResult } from "./types.js";

// The expanded row is what the user reads after `ctrl+o`; the compact row is
// what they see while it runs. Both have to carry the *Run outcome* vocabulary
// (CONTEXT.md) rather than collapsing it into done/failed.

const theme = { fg: (token: string, text: string) => `[${token}]${text}`, bold: (t: string) => t };

/** The content these segments carry, ignoring how each is laid out at render time. */
const drawnText = (segments: RowSegment[]): string => segments.map((s) => s.text).join("\n");

function makeResult(overrides: Partial<SubagentResult> = {}): SubagentResult {
  return {
    agent: "reviewer",
    task: "review the diff",
    exitCode: 0,
    usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0.01, turns: 1 },
    model: "anthropic/claude-opus-4.5",
    finalOutput: "the answer",
    error: undefined,
    progress: undefined,
    progressSummary: { toolCount: 2, tokens: 15, durationMs: 1000 },
    ...overrides,
  };
}

describe("expanded view: run outcomes", () => {
  it("still says Done for a completed run", () => {
    expect(drawnText(buildExpandedText(makeResult({ outcome: "completed" }), undefined, theme))).toContain("✓ Done");
  });

  it("says Truncated — and not Failed — for a cut-off answer", () => {
    const out = drawnText(buildExpandedText(
      makeResult({ outcome: "truncated", exitCode: 1, finalOutput: "partial" }),
      undefined,
      theme,
    ));
    expect(out).toMatch(/truncated/i);
    expect(out).not.toMatch(/Failed/);
  });

  it("says Aborted for a cancelled run", () => {
    const out = drawnText(buildExpandedText(
      makeResult({ outcome: "aborted", exitCode: 143, error: undefined }),
      undefined,
      theme,
    ));
    expect(out).toMatch(/aborted/i);
    expect(out).not.toMatch(/Failed/);
  });

  it("keeps reporting a real error as an error", () => {
    const failed = makeResult({ exitCode: 1, error: "401 unauthorized" });
    delete failed.outcome; // a failed run claims no outcome
    const out = drawnText(buildExpandedText(failed, undefined, theme));
    expect(out).toContain("401 unauthorized");
  });
});

// ── A multi-line error, read in full (issue #112) ───────────────────────────

/**
 * What a failed child actually reports: a command line, a compiler diagnostic, a
 * stack frame, and the exit status on the last line. The last line is the one
 * whoever reads it wants (`rc=1` says what happened), and it is exactly what the
 * row cut threw away — so every assertion below keys off it.
 */
const MULTI_LINE_ERROR = [
  "Command failed: pnpm -r exec -- tsc --noEmit",
  "packages/subagent/src/index.ts:42:7 - error TS2345: Argument of type 'string' is not assignable",
  "    at runChild (/home/daniel/Coding/Javascript/pi-archimedes/packages/subagent/src/spawn.ts:88:12)",
  "error: subagent exited with rc=1",
].join("\n");
const ERROR_LINES = MULTI_LINE_ERROR.split("\n");
/** Everything after the head — the part that moved from the row into the block. */
const TAIL_ERROR_LINES = ERROR_LINES.slice(1);
const FIRST_ERROR_LINE = ERROR_LINES[0]!;
const LAST_ERROR_LINE = ERROR_LINES[ERROR_LINES.length - 1]!;

/** `theme.fg` for real SGR bytes, so the rendered lines carry an ANSI state. */
const ERROR_SGR = "\x1b[31m";
const sgrTheme = {
  fg: (token: string, text: string) =>
    `${token === "error" ? ERROR_SGR : "\x1b[2m"}${text}\x1b[0m`,
  bold: (t: string) => `\x1b[1m${t}\x1b[0m`,
};

/** A `RowBlock` that remembers the segments it was last given, without faking the row layer. */
class CapturingRowBlock extends RowBlock {
  /** Named apart from `RowBlock`'s own private field of the same name. */
  lastSegments: RowSegment[] | undefined = undefined;
  /** A builder that handed its content over `setText` instead would land here. */
  lastSetText: string | undefined = undefined;

  override setSegments(segments: RowSegment[]): void {
    this.lastSegments = segments;
    super.setSegments(segments);
  }

  override setText(text: string): void {
    this.lastSetText = text;
    super.setText(text);
  }
}

/**
 * What the builder handed the row layer — asserted rather than assumed. Hooking
 * `setText` and checking it here means a builder that switched to `setText`
 * fails as a readable assertion instead of a `TypeError` on `lastSegments!`.
 */
function captured(rows: CapturingRowBlock): RowSegment[] {
  expect(rows.lastSetText, "the builder handed its content over setText, so nothing below reads it")
    .toBeUndefined();
  expect(rows.lastSegments, "setSegments was never called, so nothing below reads the view").toBeDefined();
  return rows.lastSegments!;
}

/** Strip this file's fake `theme.fg` markers, line by line — a block carries one per line. */
const plainLines = (text: string): string[] => text.split("\n").map((l) => l.replace(/^\[[a-z]+\]/, ""));

const content = (line: string): string => stripTerminalSequences(line).replace(/\s+$/, "");

function makeProgress(overrides: Partial<SubagentProgress> = {}): SubagentProgress {
  return {
    agent: "reviewer",
    status: "failed",
    task: "review the diff",
    currentTool: undefined,
    currentToolArgs: undefined,
    currentToolStartedAt: undefined,
    toolCount: 2,
    inputTokens: 10,
    outputTokens: 5,
    tokens: 15,
    cost: 0.01,
    durationMs: 1000,
    error: MULTI_LINE_ERROR,
    model: "anthropic/claude-opus-4.5",
    output: undefined,
    recentOutput: undefined,
    toolCalls: undefined,
    ...overrides,
  };
}

/** A failed run: an error and no outcome, which is what `stream.ts` reports. */
function failedResult(overrides: Partial<SubagentResult> = {}): SubagentResult {
  const result = makeResult({ exitCode: 1, error: MULTI_LINE_ERROR, ...overrides });
  // A failed run claims no outcome — `stream.ts` leaves the field off entirely.
  if (!("outcome" in overrides)) delete result.outcome;
  return result;
}

describe("expanded view: a multi-line error is readable in full (issue #112)", () => {
  /**
   * The guarantee, asserted the same way for all three builders: the error's last
   * line is present, and a `block` carries it. `block` is this repo's mechanism
   * for "read this in full" (`row-block.ts`; issue #112), so the assertion is on
   * the segment kind rather than on the joined text — a change that pushes the
   * error back through `row()` fails here even though the joined text would still
   * contain the line.
   *
   * Order and grouping are asserted too, because a builder that emitted one block
   * per line, or emitted the tail bottom-up, would satisfy the checks above: the
   * tail is exactly one block and its lines are in the order the child wrote them.
   */
  const revealsTheWholeError = (segments: RowSegment[]): void => {
    expect(drawnText(segments)).toContain(LAST_ERROR_LINE);
    expect(
      segments.filter((s) => s.text.includes(LAST_ERROR_LINE)).map((s) => s.kind),
      "the error's last line is inside a row again",
    ).toEqual(["block"]);
    const heads = segments
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.kind === "row" && s.text.includes(FIRST_ERROR_LINE));
    expect(heads, "the error's first line is no longer the row it was").toHaveLength(1);
    const tails = segments.filter(
      (s) => s.kind === "block" && TAIL_ERROR_LINES.some((line) => s.text.includes(line)),
    );
    // One block, not one per line: `RowBlock` renders a block by wrapping it, so
    // N blocks for N lines would draw the tail the same at a wide frame and hide
    // the difference at a narrow one (where each block re-wraps on its own).
    expect(tails, "the error's tail is not carried by exactly one block").toHaveLength(1);
    const [tail] = tails;
    expect(
      tail === undefined ? [] : plainLines(tail.text),
      "the error's tail block does not carry its lines in order",
    ).toEqual(TAIL_ERROR_LINES);
    expect(
      segments.indexOf(tail!),
      "the tail block was emitted before the row head, so the error reads bottom-up",
    ).toBeGreaterThan(heads[0]!.i);
  };

  it("shows every line of a finished run's error, the last one as a block", () => {
    const segments = buildExpandedText(failedResult(), undefined, theme);
    revealsTheWholeError(segments);
    // The marker convention survives: the first line is still the outcome row,
    // with the ✗ error marker in front of it. Pinned exactly, because that row is
    // what the collapsed view draws too — only the tail moves into a block.
    const heads = segments.filter((s) => s.kind === "row" && s.text.includes("✗ "));
    expect(heads).toEqual([{ kind: "row", text: "[error]✗ " + FIRST_ERROR_LINE }]);
  });

  it("shows every line of a streaming run's error, the last one as a block", () => {
    const rows = new CapturingRowBlock();
    renderProgressExpanded(rows, makeProgress({ status: "failed" }), theme);
    revealsTheWholeError(captured(rows));
  });

  it("shows every line of a streaming parallel run's error, the last one as a block", () => {
    revealsTheWholeError(buildProgressExpandedText(makeProgress({ status: "failed" }), theme));
  });

  // Both streaming builders choose this branch on `status === "completed" ||
  // outcome`, and still pass `progress.error` down, where `outcomeSegments` reads
  // `error` before `outcome` — mirroring `buildOutcomeLine` (`format.ts:101`).
  // `stream.ts` only ever sets `error` for a failed run today, but `progress` is
  // also data read back out of a persisted session, and the branch's own contract
  // is "state or outcome, plus whatever error came with it" — so the error has to
  // be revealed here too. Until now it was the one place the finished view's fix
  // had not reached: same run, full error in `buildExpandedText`, one line here.
  it("shows every line of a *completed* streaming run's error, not just a failed one's", () => {
    const rows = new CapturingRowBlock();
    renderProgressExpanded(rows, makeProgress({ status: "completed" }), theme);
    revealsTheWholeError(captured(rows));
  });

  it("shows every line of a *completed* parallel streaming run's error", () => {
    revealsTheWholeError(buildProgressExpandedText(makeProgress({ status: "completed" }), theme));
  });

  it("reveals the tail for a still-running progress that already carries an outcome", () => {
    // The `|| progress.outcome` half of the same condition.
    const rows = new CapturingRowBlock();
    renderProgressExpanded(rows, makeProgress({ status: "running", outcome: "truncated" }), theme);
    revealsTheWholeError(captured(rows));
  });

  it("draws the whole error on screen at a narrow width as well as a wide one", () => {
    // Through the real row component, so this is about what lands on screen and
    // not about the intermediate segments (the style of the width audit).
    const [headLine, ...carriedLines] = MULTI_LINE_ERROR.split("\n");
    for (const width of [200, 120, 80, 40]) {
      const rows = new CapturingRowBlock();
      renderExpanded(rows, failedResult(), undefined, sgrTheme);
      const rendered = rows.render(width);
      const joined = rendered.map(content).join("").replace(/\s+/g, "");
      // Every line the block carries survives the wrap, whole. (The first line
      // stays a row — cut at the frame like every other row, which is why it is
      // not in this list.)
      for (const line of carriedLines) {
        // A wrapped line may break a long line across rows, so compare with the
        // whitespace removed, exactly like the width audit does.
        expect(joined, `line lost at ${width}: ${JSON.stringify(rendered.map(content))}`)
          .toContain(line.replace(/\s+/g, ""));
      }
      // The last line — the one the old cut discarded outright — is on a row of
      // its own rather than smeared across a wrap boundary.
      expect(
        rendered.map(content).some((l) => l.includes(carriedLines[carriedLines.length - 1]!)),
        `last error line missing at ${width}: ${JSON.stringify(rendered.map(content))}`,
      ).toBe(true);
      // And the head is still there, cut the way a row cuts, marker and all.
      expect(rendered.map(content)[0]).toContain("reviewer");
      expect(
        rendered.map(content).some((l) => l.includes("✗ " + headLine!.slice(0, 10))),
        `error head missing at ${width}: ${JSON.stringify(rendered.map(content))}`,
      ).toBe(true);
      for (const line of rendered) {
        expect(visibleWidth(line), `row over the frame at ${width}`).toBeLessThanOrEqual(width);
      }
    }
  });

  it("closes the error colour on every line it drew, so colour does not bleed", () => {
    // Wide enough that nothing wraps: every logical line is one rendered line, so
    // each one has to carry its own complete SGR pair. Handing `block` the whole
    // `theme.fg("error", "✗ " + error)` string instead would open one span over
    // every line and land the single reset on the last one only — the padding of
    // the earlier lines then sits inside an open span.
    const rows = new CapturingRowBlock();
    renderExpanded(rows, failedResult(), undefined, sgrTheme);
    const drawn = rows.render(200);
    const errorLines = drawn.filter((l) => l.includes(ERROR_SGR));
    expect(errorLines.length).toBe(MULTI_LINE_ERROR.split("\n").length);
    for (const line of errorLines) {
      expect(line.startsWith(ERROR_SGR), `line does not open its own span: ${JSON.stringify(line)}`)
        .toBe(true);
      expect(
        line.trimEnd().endsWith(RESET),
        `line leaves its span open across the padding: ${JSON.stringify(line)}`,
      ).toBe(true);
    }
  });

  it("leaves a single-line error exactly as it was rendered before", () => {
    // Byte-identical: only the multi-line case changes, so every existing
    // assertion about the outcome row keeps its meaning.
    const failed = makeResult({ exitCode: 1, error: "401 unauthorized" });
    delete failed.outcome;
    const segments = buildExpandedText(failed, undefined, theme);
    const outcome = segments.filter((s) => s.text.includes("401 unauthorized"));
    expect(outcome).toEqual([{ kind: "row", text: "[error]✗ 401 unauthorized" }]);
    // Counted as segments, because a segment's text is already multi-line: the
    // claim is "the error reached the row layer exactly once", which a duplicate
    // (the same line in a row *and* in a block) would fail.
    expect(segments.filter((s) => s.text.includes("401"))).toHaveLength(1);
  });

  it("draws no blank row for an error that merely ends in a newline", () => {
    // A trailing newline is not a line of content, and opening a block for it
    // would add a blank row to the bottom of every failed run.
    const failed = makeResult({ exitCode: 1, error: "401 unauthorized\n" });
    delete failed.outcome;
    const segments = buildExpandedText(failed, undefined, theme);
    expect(segments.filter((s) => s.kind === "block" && s.text.trim() === "")).toEqual([]);
    // And through the real row component, because the segment layer cannot see
    // the failure this guards against: an emitted `row("")` is invisible in the
    // list above yet `RowBlock` would draw it as a blank bottom row.
    const rows = new CapturingRowBlock();
    renderExpanded(rows, failed, undefined, theme);
    const drawn = rows.render(200).map(content);
    expect(drawn.filter((l) => l.includes("401"))).toHaveLength(1);
    expect(
      drawn[drawn.length - 1],
      `a blank row was drawn under the outcome: ${JSON.stringify(drawn)}`,
    ).toContain("401 unauthorized");
  });

  it("still lets the error win over the outcome, even when the error is multi-line", () => {
    // Pinned as-is, not decided here: `outcomeSegments` reads `data.error`
    // before the outcome — the same precedence `buildOutcomeLine` gives it — so an
    // error and an outcome together report the error. Both halves of
    // the text have to survive that precedence now that the error is a block.
    const out = drawnText(
      buildExpandedText(failedResult({ outcome: "truncated", finalOutput: "partial" }), undefined, theme),
    );
    expect(out).toContain(FIRST_ERROR_LINE);
    expect(out).toContain(LAST_ERROR_LINE);
    expect(out).not.toMatch(/Truncated/);
  });

  // The collapsed half of this asymmetry is pinned where that code lives, not here: `compact.test.ts` ("hands over three row segments carrying whole fields, so newlines reach the row cut") and `tool-row.width-audit.test.ts` ("keeps a multiline task or error to three rows per agent (collapsed)").

  describe("a child that wrote CRLF line endings (a Windows child)", () => {
    // `stream.ts` reads stderr as `Buffer.concat(...).toString("utf-8").trim()` —
    // no newline normalisation — so `\r\n` arrives intact from a Windows child.
    // `pi-tui`'s `wrapTextWithAnsi` splits on `/\r\n|\r|\n/` but `truncateRow`
    // splits on `"\n"`, so a `\r` surviving the split rides inside a `row` and
    // gets drawn: pi-tui does not strip it, and a terminal interpreting a bare CR
    // rewinds the cursor to column 0 and paints the row over itself.
    const CRLF_ERROR = ERROR_LINES.join("\r\n");

    it("keeps every carriage return out of the segments and off the screen", () => {
      const builders: Array<[string, () => RowSegment[]]> = [
        ["buildExpandedText", () => buildExpandedText(failedResult({ error: CRLF_ERROR }), undefined, theme)],
        ["renderProgressExpanded", () => {
          const rows = new CapturingRowBlock();
          renderProgressExpanded(rows, makeProgress({ status: "completed", error: CRLF_ERROR }), theme);
          return captured(rows);
        }],
        ["buildProgressExpandedText", () => buildProgressExpandedText(makeProgress({ status: "failed", error: CRLF_ERROR }), theme)],
      ];
      for (const [name, build] of builders) {
        const segments = build();
        expect(
          segments.filter((s) => s.text.includes("\r")).map((s) => s.text),
          `${name} left a carriage return inside a segment`,
        ).toEqual([]);
      }
      // Asserted on the RAW rendered lines: `content()` trims trailing whitespace,
      // so it would swallow the very byte this is about.
      for (const width of [200, 80]) {
        const rows = new CapturingRowBlock();
        renderExpanded(rows, failedResult({ error: CRLF_ERROR }), undefined, sgrTheme);
        const rendered = rows.render(width);
        for (const line of rendered) {
          expect(JSON.stringify(line), `a bare CR was drawn at width ${width}`).not.toContain("\\r");
        }
        // Nothing was lost by the split either — every line still reaches the frame.
        const joined = rendered.map(content).join("").replace(/\s+/g, "");
        for (const line of ERROR_LINES) {
          expect(joined, `line lost at ${width}: ${JSON.stringify(rendered.map(content))}`)
            .toContain(line.replace(/\s+/g, ""));
        }
      }
    });
  });
});

// ── The fallback each builder keeps (the legacy-session shape) ──────────────

describe("expanded view: a run with nothing to report falls back the way its own builder did", () => {
  // `outcome` is optional (`types.ts:38,70,134`) and only populated from 8cf0d12
  // (#103) on, so both shapes below reach the empty case: a session JSON persisted
  // before it renders the finished view with `status:"completed"` and no outcome,
  // and a progress that reports a terminal state and no outcome renders the two
  // streaming views that way. Each site's fallback is load-bearing there, and they
  // are *not* the same fallback: the finished view says `✗ Failed`, the two
  // streaming views say `✓ Done`. Relabelling a completed run failed is how a
  // useful answer gets thrown away by whoever reads it.
  const saysDoneAndNeverFailed = (text: string): void => {
    expect(text).toContain("✓ Done");
    expect(text).not.toMatch(/Failed/);
  };

  it("says Done for a finished result that predates the outcome field", () => {
    const legacy = makeResult();
    delete legacy.outcome;
    saysDoneAndNeverFailed(drawnText(buildExpandedText(legacy, undefined, theme)));
  });

  it("says Done for streaming progress that predates the outcome field", () => {
    const rows = new CapturingRowBlock();
    renderProgressExpanded(rows, makeProgress({ status: "completed", error: undefined }), theme);
    saysDoneAndNeverFailed(drawnText(captured(rows)));
  });

  it("says Done for parallel streaming progress that predates the outcome field", () => {
    saysDoneAndNeverFailed(
      drawnText(buildProgressExpandedText(makeProgress({ status: "completed", error: undefined }), theme)),
    );
  });

  it("still names a truncated or aborted streaming run by its outcome, not as failed", () => {
    // The same sites, one step on from the legacy shape: a real outcome has to win
    // over the caller's fallback, and `✓ Done` must not flatten it either.
    for (const outcome of ["truncated", "aborted"] as const) {
      const expected = outcome === "truncated" ? /truncated/i : /aborted/i;
      const rows = new CapturingRowBlock();
      renderProgressExpanded(rows, makeProgress({ status: "completed", outcome, error: undefined }), theme);
      const streaming = drawnText(captured(rows));
      expect(streaming, `renderProgressExpanded flattened ${outcome}`).toMatch(expected);
      expect(streaming).not.toMatch(/Failed|✓ Done/);
      const parallel = drawnText(
        buildProgressExpandedText(makeProgress({ status: "completed", outcome, error: undefined }), theme),
      );
      expect(parallel, `buildProgressExpandedText flattened ${outcome}`).toMatch(expected);
      expect(parallel).not.toMatch(/Failed|✓ Done/);
    }
  });

  it("falls back to Failed on the finished view when a result reports nothing at all", () => {
    // One door onto the finished view's bottom row: a result with neither an
    // outcome nor an error and a nonzero exit — `buildExpandedText`'s own `else`,
    // which keeps saying Failed because such a run has no success to claim.
    const nothing = makeResult({ exitCode: 1 });
    delete nothing.outcome;
    const out = drawnText(buildExpandedText(nothing, undefined, theme));
    expect(out).toContain("✗ Failed");
    expect(out).not.toMatch(/✓ Done/);
  });

  it("falls back to Failed — not Done — for an outcome this build cannot name", () => {
    // The other door, and the one that only exists now the fallback is the
    // caller's: `outcome` set to something `buildOutcomeLine` has no case for (a
    // session written by a newer build, or a widened *Run outcome* axis) leaves it
    // returning `undefined`, and the segment `buildExpandedText` passes in is what
    // gets drawn. It stays Failed — a run whose ending this code cannot read is
    // not a success this code may claim — which is the byte this site rendered
    // before the fallback moved, so moving it changed nothing here.
    const unknown = makeResult({ exitCode: 1, outcome: "detached" as RunOutcome });
    const out = drawnText(buildExpandedText(unknown, undefined, theme));
    expect(out).toContain("✗ Failed");
    expect(out).not.toMatch(/✓ Done/);
  });
});
