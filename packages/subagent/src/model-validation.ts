import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

export interface ValidateModelContext {
  /** Agent name the caller passed (used to detect the agent→model mirror footgun). */
  agentName?: string | undefined;
  /** File path of the agent config whose `model:` field is being validated. */
  agentFilePath?: string | undefined;
}

export type ValidateModelResult = { ok: true } | { ok: false; error: string };

/**
 * Find a model by reference, mirroring pi core's `findExactModelReferenceMatch`
 * rules (that function is not exported; rules read from pi core source):
 *   - canonical "provider/id" (case-insensitive), OR
 *   - bare "id" (case-insensitive); ambiguous (>=2 providers share the id) → no match.
 */
function findMatch<T extends { provider: string; id: string }>(
  ref: string,
  models: readonly T[],
): T | undefined {
  const lower = ref.toLowerCase();
  if (!lower) return undefined;
  // canonical provider/id
  const canonical = models.find((m) => `${m.provider}/${m.id}`.toLowerCase() === lower);
  if (canonical) return canonical;
  // bare id — must be unique across providers
  const idMatches = models.filter((m) => m.id.toLowerCase() === lower);
  return idMatches.length === 1 ? idMatches[0] : undefined;
}

/**
 * Validate that a model reference string resolves to a known model.
 *
 * Pure gate: returns `{ ok: true }` when valid (no resolved model object —
 * callers forward the ORIGINAL string to spawn.ts unchanged, preserving any
 * `:high` thinking suffix for the child's own resolver).
 *
 * Matching is against `registry.getAll()` (all known models — a pure
 * name-existence check; auth is deferred to the child, matching how the
 * child's `resolveCliModel` resolves against all models). Exact-match only;
 * fuzzy/alias patterns the child might accept are rejected here (acceptable —
 * `model` override is discouraged, so legitimate fuzzy usage is ~0).
 */
export function validateModel(
  model: string | undefined,
  registry: ModelRegistry,
  context: ValidateModelContext = {},
): ValidateModelResult {
  if (!model || !model.trim()) return { ok: true };
  const all = registry.getAll();
  if (all.length === 0) return { ok: true }; // unconfigured registry — defer to child

  const ref = model.trim();
  let matched = findMatch(ref, all);
  // Thinking-suffix tolerant: if the full string failed but it has a colon,
  // retry with the prefix before the last colon (handles "claude-sonnet-4-5:high").
  if (!matched && ref.includes(":")) {
    const prefix = ref.slice(0, ref.lastIndexOf(":"));
    if (prefix) matched = findMatch(prefix, all);
  }
  if (matched) return { ok: true };

  const sample = all.slice(0, 5).map((m) => `${m.provider}/${m.id}`).join(", ");
  const more = all.length > 5 ? `, … (${all.length} total)` : "";

  // Prioritize file-path message when both agentName and agentFilePath are set
  // (more actionable than the generic agent-name hint)
  if (context.agentFilePath) {
    return {
      ok: false,
      error: `Agent "${context.agentName ?? "unknown"}" is configured with an invalid model "${model}" (in ${context.agentFilePath}). Fix the model field or agents.local.json. Available: ${sample}${more}.`,
    };
  }
  if (context.agentName && ref === context.agentName.trim()) {
    return {
      ok: false,
      error: `Model "${model}" not found — it looks like an agent name, not a model. Omit the model parameter; the agent's configured model or the parent's current model will be used. Available models include: ${sample}${more}.`,
    };
  }
  return {
    ok: false,
    error: `Model "${model}" not found. Available models include: ${sample}${more}.`,
  };
}

/** Return the first error message from the given results, or undefined if all ok. */
export function firstError(...results: ValidateModelResult[]): string | undefined {
  for (const r of results) {
    if (!r.ok) return r.error;
  }
  return undefined;
}
