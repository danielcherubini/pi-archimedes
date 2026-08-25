/**
 * Compatibility shim for LLM tool-call arguments.
 *
 * Wires into the tool via `prepareArguments`, which pi runs BEFORE schema
 * validation (and before `execute`). The model occasionally sends
 * malformed-but-recoverable `manage_todo_list` arguments; observed in practice:
 *
 *   - `todoList` is a stringified JSON array instead of an array (sometimes
 *     with mangled escaping, e.g. `"id": 1"` — an extra quote after the number)
 *   - items are missing `title` because the model considers it redundant
 *     with `description`
 *   - items are missing `status` (or it is a non-enum phrase like "doing")
 *   - items are plain strings
 *   - `id` missing or a numeric string
 *   - stray top-level / per-item keys outside the schema
 *
 * Only *recoverable* deviations are repaired. Anything unrecoverable is passed
 * through untouched so the standard validation error still surfaces with the
 * real complaint. The public schema stays strict; this module is purely a
 * repair layer.
 */

import type { ManageTodoListInput } from "./tool.js";
import type { TodoStatus } from "./types.js";

type Record_ = Record<string, unknown>;

const VALID_STATUSES: ReadonlySet<string> = new Set<string>([
  "not-started",
  "in-progress",
  "completed",
]);

/** LLM synonyms for the three enum values (after case/spacing normalization). */
const STATUS_ALIASES: ReadonlyMap<string, TodoStatus> = new Map<string, TodoStatus>([
  ["done", "completed"],
  ["complete", "completed"],
  ["finished", "completed"],
  ["closed", "completed"],
  ["success", "completed"],
  ["passed", "completed"],
  ["doing", "in-progress"],
  ["started", "in-progress"],
  ["working", "in-progress"],
  ["active", "in-progress"],
  ["wip", "in-progress"],
  ["ongoing", "in-progress"],
  ["pending", "not-started"],
  ["todo", "not-started"],
  ["planned", "not-started"],
  ["untouched", "not-started"],
]);

/**
 * Keys the model sometimes uses instead of `title`/`description`. Checked
 * only when the canonical field is itself missing, so a model that DID send
 * `title`/`description` is never overwritten.
 */
const TITLE_FALLBACK_KEYS = ["content", "task", "text", "name", "label"] as const;
const DESCRIPTION_FALLBACK_KEYS = ["details", "notes", "summary", "context"] as const;

/** Upper bound for a `title` derived from `description`. */
const DERIVED_TITLE_MAX = 60;

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
 * Collapse whitespace and cut at a word boundary so a derived title stays a
 * short, human-readable label in the widget.
 */
export function deriveTitleFromDescription(description: string): string {
  const flat = description.replace(/\s+/g, " ").trim();
  if (flat.length <= DERIVED_TITLE_MAX) return flat;
  const cut = flat.slice(0, DERIVED_TITLE_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  const head = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return `${head.trimEnd()}…`;
}

function normalizeId(raw: unknown, index: number): number {
  let n: number;
  if (typeof raw === "number") {
    n = raw;
  } else if (typeof raw === "string" && raw.trim() !== "") {
    n = Number(raw);
  } else {
    n = Number.NaN;
  }
  return Number.isFinite(n) ? Math.trunc(n) : index + 1;
}

function normalizeStatus(raw: unknown): TodoStatus {
  if (typeof raw !== "string") {
    // Missing, null, number, … — no signal about intent.
    return "not-started";
  }
  // "in progress" / "In_Progress" / "IN-PROGRESS" → "in-progress"
  const normalized = raw.trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (VALID_STATUSES.has(normalized)) return normalized as TodoStatus;
  return STATUS_ALIASES.get(normalized) ?? "not-started";
}

/**
 * Normalize one todo item. Returns a fresh object containing ONLY the four
 * schema keys (extra keys are dropped — the schema rejects them with "must
 * not have additional properties"). Unrecoverable items are returned as-is so
 * the schema error keeps its meaning.
 */
export function normalizeTodoItem(raw: unknown, index: number): unknown {
  // Laziest form: ["write tests", "deploy"]
  if (typeof raw === "string") {
    const text = raw.trim();
    if (text === "") return raw;
    return {
      id: index + 1,
      title: deriveTitleFromDescription(text),
      description: text,
      status: "not-started" as TodoStatus,
    };
  }

  if (!isRecord(raw)) return raw; // null / number / nested array → schema error

  const description =
    (typeof raw.description === "string" ? raw.description.trim() : "") ||
    firstStringOf(raw, DESCRIPTION_FALLBACK_KEYS);
  let title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (title === "") title = firstStringOf(raw, TITLE_FALLBACK_KEYS);
  if (title === "" && description !== "") title = deriveTitleFromDescription(description);

  // No text at all: keep the (empty) fields so the schema error lists the
  // missing `title`/`description` instead of masking it with a derivation.
  return {
    id: normalizeId(raw.id, index),
    title,
    description: description || title,
    status: normalizeStatus(raw.status),
  };
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
    ("id" in value || "title" in value || "description" in value || "status" in value)
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
