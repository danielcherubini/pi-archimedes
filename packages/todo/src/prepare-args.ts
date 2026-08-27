/**
 * Compatibility shim for LLM tool-call arguments.
 *
 * Wires into the tool via `prepareArguments`, which pi runs BEFORE schema
 * validation (and before `execute`). The model occasionally sends
 * malformed-but-recoverable `manage_todo_list` arguments; observed in
 * practice (frozen open-weight models, ADR 0009):
 *
 *   - `todoList` is a stringified JSON array instead of an array (sometimes
 *     with mangled escaping, e.g. `"id": 1"` — an extra quote after the
 *     number)
 *   - items put the task text under `title`/`step` (shapes borrowed from
 *     other harnesses) instead of the canonical `content`
 *   - `id` is invented, omitted, or nulled — the canonical schema has NO
 *     `id`; display numbering is array position, so it is stripped, not
 *     repaired
 *   - statuses come out dashed (a hyphenated variant of a canonical
 *     value that then collapses to a no-separator form), or as plain
 *     english synonyms ("doing", "done")
 *   - items are plain strings
 *   - stray top-level / per-item keys outside the schema
 *
 * Only *recoverable* deviations are repaired. Anything unrecoverable is
 * passed through untouched so the standard validation error still surfaces
 * with the real complaint. The public schema stays strict; this module is
 * purely a repair layer.
 */

import type { ManageTodoListInput } from "./tool.js";
import type { TodoItem, TodoStatus } from "./types.js";

type Record_ = Record<string, unknown>;

const VALID_STATUSES: ReadonlySet<string> = new Set<string>([
  "pending",
  "in_progress",
  "completed",
]);

/**
 * LLM synonyms for the three enum values, keyed by the collapsed form
 * (lowercase, all whitespace/underscore/dash separators removed) so dashed,
 * spaced, and underscored variants all land on the same key.
 */
const STATUS_ALIASES: ReadonlyMap<string, TodoStatus> = new Map<string, TodoStatus>([
  ["done", "completed"],
  ["complete", "completed"],
  ["finished", "completed"],
  ["closed", "completed"],
  ["success", "completed"],
  ["passed", "completed"],
  ["doing", "in_progress"],
  ["started", "in_progress"],
  ["working", "in_progress"],
  ["active", "in_progress"],
  ["wip", "in_progress"],
  ["ongoing", "in_progress"],
  ["inprogress", "in_progress"],
  ["pending", "pending"],
  ["todo", "pending"],
  ["planned", "pending"],
  ["untouched", "pending"],
  ["notstarted", "pending"],
  ["unstarted", "pending"],
  ["open", "pending"],
]);

/**
 * Keys the model sometimes uses instead of `content`. Checked only when
 * `content` itself is missing/empty, so a model that DID send `content` is
 * never overwritten.
 */
const CONTENT_FALLBACK_KEYS = ["title", "step", "task", "text", "name", "label", "activeForm"] as const;
const DESCRIPTION_FALLBACK_KEYS = ["details", "notes", "summary", "context"] as const;

/** Reserved keys the last-resort text scan must never pick up. */
const LAST_RESORT_SKIP_KEYS = new Set<string>([
  "content",
  ...(CONTENT_FALLBACK_KEYS as readonly string[]),
  "description",
  ...(DESCRIPTION_FALLBACK_KEYS as readonly string[]),
  "status",
  "id",
]);

const DERIVED_CONTENT_MAX = 60;

function isRecord(value: unknown): value is Record_ {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstStringOf(record: Record_, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return "";
}

/**
 * Collapse whitespace and cut at a word boundary so a derived `content`
 * stays a short, human-readable label in the widget.
 */
export function deriveTitleFromDescription(description: string): string {
  const flat = description.replace(/\s+/g, " ").trim();
  if (flat.length <= DERIVED_CONTENT_MAX) return flat;
  const cut = flat.slice(0, DERIVED_CONTENT_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  const head = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return `${head.trimEnd()}…`;
}

/**
 * Normalize a raw status to the canonical enum. Accepts dashed/spaced/
 * underscored variants and plain-english synonyms; anything unrecognized
 * (incl. non-strings) falls back to `"pending"`. Kept permissive — this is
 * the REPAIR layer. `state-manager.validate()` stays canonical-strict.
 */
export function normalizeStatus(raw: unknown): TodoStatus {
  if (typeof raw !== "string") {
    // Missing, null, number, … — no signal about intent.
    return "pending";
  }
  const s = raw.trim().toLowerCase();
  if (VALID_STATUSES.has(s)) return s as TodoStatus;
  const collapsed = s.replace(/[\s_-]+/g, "");
  return STATUS_ALIASES.get(collapsed) ?? "pending";
}

/**
 * Normalize one todo item. Returns a fresh object containing ONLY the
 * canonical keys `{content, description?, status}` — `id` is always dropped,
 * extra keys are dropped (the schema rejects them with "must not have
 * additional properties"). Unrecoverable items are returned as-is so the
 * schema error keeps its meaning.
 */
export function normalizeTodoItem(raw: unknown, index: number): unknown {
  // Laziest form: ["write tests", "deploy"]
  if (typeof raw === "string") {
    const text = raw.trim();
    if (text === "") return raw;
    return { content: deriveTitleFromDescription(text), status: "pending" as TodoStatus };
  }

  if (!isRecord(raw)) return raw; // null / number / nested array → schema error

  const description =
    (typeof raw.description === "string" ? raw.description.trim() : "") ||
    firstStringOf(raw, DESCRIPTION_FALLBACK_KEYS);
  let content =
    (typeof raw.content === "string" ? raw.content.trim() : "") ||
    firstStringOf(raw, CONTENT_FALLBACK_KEYS);
  if (content === "" && description !== "") {
    content = deriveTitleFromDescription(description);
  }
  // Last resort: any remaining non-empty string field that isn't a known
  // alias/status/id. This alone is the catch-all.
  if (content === "") {
    for (const [key, value] of Object.entries(raw)) {
      if (!LAST_RESORT_SKIP_KEYS.has(key) && typeof value === "string" && value.trim() !== "") {
        content = value;
        break;
      }
    }
  }

  // If both are empty this returns { content: "", status } — deliberately
  // keeps an empty (valid-string) field so state-manager.validate() reports
  // the missing `content` instead of the schema masking it.
  return {
    content,
    ...(description !== "" ? { description } : {}),
    status: normalizeStatus(raw.status),
  };
}

/**
 * Normalize a raw todo list (e.g. from bus payloads) into canonical
 * TodoItems. Returns [] for an empty input array, undefined for anything
 * unrecoverable. Used by the bus consumer (index.ts) and the subagent
 * stream — where prepareArguments is NOT in the call path.
 */
export function normalizeTodoItems(raw: unknown): TodoItem[] | undefined {
  let list: unknown[] | undefined;
  if (Array.isArray(raw)) {
    list = raw;
  } else if (raw != null && looksLikeTodoItem(raw)) {
    list = [raw];
  } else {
    return undefined;
  }

  const items = list.map((item, i) => normalizeTodoItem(item, i));
  const surviving = items.filter(
    (item): item is TodoItem =>
      isRecord(item) &&
      typeof item.content === "string" &&
      item.content.trim() !== "" &&
      typeof item.status === "string" &&
      VALID_STATUSES.has(item.status),
  );
  if (items.length === 0) return [];
  if (surviving.length === 0) return undefined;
  return surviving;
}

/**
 * Repair the occasional mangled JSON: `"id": 1"` (an extra quote after the
 * number). The replacement is safe to apply blindly — that shape is invalid
 * JSON to begin with.
 */
// The long backslash sequence is spelled out as char codes for robustness.
const ID_FIX_PATTERN = String.fromCharCode(40, 34, 105, 100, 34, 92, 115, 42, 58, 92, 115, 42, 92, 100, 43, 41, 92, 34);
const ID_QUOTE_FIX = new RegExp(ID_FIX_PATTERN, "g");
function repairStringifiedJson(s: string): string {
  return s.replace(ID_QUOTE_FIX, "$1");
}

function parseStringifiedList(raw: string): unknown {
  try {
    return JSON.parse(repairStringifiedJson(raw));
  } catch {
    return raw; // Unparseable — keep the string; schema error says "must be array"
  }
}

function looksLikeTodoItem(value: unknown): boolean {
  return (
    isRecord(value) &&
    ("content" in value ||
      "title" in value ||
      "step" in value ||
      "description" in value ||
      "status" in value)
  );
}

/**
 * Normalize the `todoList` argument. `kept` is false only when the field was
 * absent and must not appear in the output object at all.
 */
function normalizeTodoList(raw: unknown): { value: unknown; kept: boolean } {
  let value: unknown = raw;
  if (typeof raw === "string") value = parseStringifiedList(raw);

  if (value === null) {
    // Required-schema fields reject null; dropping the key yields the clearer
    // "todoList is required for write operation" from execute().
    return { value: undefined, kept: true };
  }

  if (value === undefined) return { value, kept: false };

  if (Array.isArray(value)) {
    return { value: value.map((item, i) => normalizeTodoItem(item, i)), kept: true };
  }

  // A single bare item instead of an array.
  if (looksLikeTodoItem(value)) {
    return { value: [normalizeTodoItem(value, 0)], kept: true };
  }

  return { value, kept: true }; // Unmendable — original validation error stands
}

function normalizeOperation(raw: unknown, listPresent: boolean): "write" | "read" {
  if (raw === "write" || raw === "read") return raw;
  if (typeof raw === "string") {
    const lowered = raw.trim().toLowerCase();
    if (lowered === "write" || lowered === "read") return lowered;
  }
  // Model omitted/garbled the operation: a list implies a write.
  return listPresent ? "write" : "read";
}

/**
 * Repair raw `manage_todo_list` call arguments before schema validation.
 * Never throws, never mutates its input, and passes through anything it
 * cannot recover.
 */
export function prepareTodoArguments(args: unknown): ManageTodoListInput {
  if (!isRecord(args)) return args as ManageTodoListInput;

  const normalized =
    args.todoList === undefined ? undefined : normalizeTodoList(args.todoList);
  const present =
    normalized !== undefined && normalized.kept && normalized.value !== undefined;

  const out: Record_ = {
    operation: normalizeOperation(args.operation, present),
  };
  if (present) {
    out.todoList = (normalized as { value: unknown }).value;
  }
  return out as ManageTodoListInput;
}
