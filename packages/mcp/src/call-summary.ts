/**
 * Compact two-line tool rendering — pure helpers.
 *
 * The MCP tool rows render as a two-line compact summary (mirroring the
 * subagent package's compact rows):
 *   line 1:  mcp <target>                          (call row, always)
 *   line 2:  → <key>: <value> [ (ctrl+o)]          (key-arg summary)
 *
 * These helpers are pure (no TUI imports) so they are directly unit-testable.
 */

/**
 * Arg keys shown in the summary line, in priority order. The first key
 * present with a scalar value wins.
 */
export const PREFERRED_ARG_KEYS: readonly string[] = [
  "sql",
  "query",
  "text",
  "prompt",
  "table",
  "column",
  "name",
  "path",
  "url",
  "server",
];

export type KeyArg = { key: string; value: string };

export type SummaryState = "running" | "success" | "error";

/**
 * The subset of pi's ThemeColor tokens the summary line uses. Kept as a
 * named union so these pure helpers stay decoupled from pi's theme types
 * while remaining assignable from a real pi Theme (the union is a subset of
 * ThemeColor — passing pi's wider Theme.fg where this is expected is legal
 * by parameter contravariance).
 */
export type SummaryToken =
  | "muted"
  | "dim"
  | "success"
  | "error"
  | "warning"
  | "toolTitle"
  | "toolOutput"
  | "accent";

/** Shape of the theme surface these helpers need (pi's Theme satisfies it). */
export type SummaryTheme = {
  fg: (token: SummaryToken, text: string) => string;
};

/** A scalar value is one we can meaningfully summarize as text. */
function isScalar(v: unknown): v is string | number | boolean {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function firstLine(text: string): string {
  const nl = text.indexOf("\n");
  return nl === -1 ? text : text.slice(0, nl);
}

/**
 * Plain-text truncation mirroring subagent's truncLine: first line only,
 * at most maxLen characters, "..." appended when anything is cut (including
 * a pure newline boundary). Unlike pi-tui's truncateToWidth this is a plain
 * slice — "..." stays *inside* any ANSI color wrapper applied around it.
 */
export function truncLinePlain(text: string, maxLen: number): string {
  const nlIdx = text.indexOf("\n");
  if (nlIdx !== -1) {
    return text.slice(0, nlIdx).slice(0, maxLen - 3) + "...";
  }
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

/**
 * Choose the key arg for the summary line.
 *
 * 1. First PREFERRED_ARG_KEYS key present with a string|number|boolean value
 *    (array/object/undefined/null values are skipped).
 * 2. Fallback: the first arg (insertion order) with a scalar value, skipping
 *    keys starting with "_".
 *
 * `value` is String(value), first line only — truncation to display width is
 * the caller's job (see formatSummaryLine). Returns null when no scalar arg
 * exists (the summary line then renders empty).
 */
export function pickKeyArg(
  args: Record<string, unknown> | null | undefined,
): KeyArg | null {
  if (args === null || args === undefined) return null;
  if (typeof args !== "object" || Array.isArray(args)) return null;

  for (const key of PREFERRED_ARG_KEYS) {
    if (Object.prototype.hasOwnProperty.call(args, key) && isScalar(args[key])) {
      return { key, value: firstLine(String(args[key])) };
    }
  }

  for (const [key, value] of Object.entries(args)) {
    if (key.startsWith("_")) continue;
    if (isScalar(value)) return { key, value: firstLine(String(value)) };
  }

  return null;
}

const STATE_TOKEN: Record<SummaryState, SummaryToken> = {
  running: "muted",
  success: "success",
  error: "error",
};

const MAX_VALUE_CHARS = 40;

/**
 * Format the summary line:
 *   → (muted) + key (state-colored) + ": value" (dim, ≤40 chars)
 *   + " (ctrl+o)" (muted) only once a result exists (success/error states).
 *
 * Returns "" when keyArg is null — the caller renders no line 2.
 */
export function formatSummaryLine(
  keyArg: KeyArg | null,
  state: SummaryState,
  theme: SummaryTheme,
): string {
  if (!keyArg) return "";
  const hint =
    state === "running" ? "" : theme.fg("muted", " (ctrl+o)");
  return (
    theme.fg("muted", "→ ") +
    theme.fg(STATE_TOKEN[state], keyArg.key) +
    theme.fg("dim", ": " + truncLinePlain(keyArg.value, MAX_VALUE_CHARS)) +
    hint
  );
}
