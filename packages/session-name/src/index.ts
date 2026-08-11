import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "@pi-archimedes/core/settings-io";

// ── Config ──────────────────────────────────────────────────────────────────

export interface SessionNameSettings {
  enabled?: boolean | undefined;
  model?: string | undefined;
}

const DEFAULT_SESSION_NAME_CONFIG: SessionNameSettings = {
  enabled: true,
  model: undefined,
};

const NAMESPACE = "archimedes.sessionName";

export function loadSessionNameConfig(): SessionNameSettings {
  return loadConfig(NAMESPACE, DEFAULT_SESSION_NAME_CONFIG);
}

// ── Model resolution ────────────────────────────────────────────────────────

/**
 * Find a model by reference string.
 *
 * Resolution order:
 *   1. Canonical "provider/id" (case-insensitive)
 *   2. Bare "id" (case-insensitive) — only if unique across providers
 *   3. Thinking-suffix tolerance: strip everything after the last colon and retry
 */
function findMatch<T extends { provider: string; id: string }>(
  ref: string,
  models: readonly T[],
): T | undefined {
  const lower = ref.toLowerCase();
  if (!lower) return undefined;

  // 1. Canonical provider/id match
  const canonical = models.find(
    (m) => `${m.provider}/${m.id}`.toLowerCase() === lower,
  );
  if (canonical) return canonical;

  // 2. Bare id match — must be unique
  const idMatches = models.filter((m) => m.id.toLowerCase() === lower);
  if (idMatches.length === 1) return idMatches[0];

  // 3. Thinking-suffix tolerance: strip after last colon and retry
  if (ref.includes(":")) {
    const prefix = ref.slice(0, ref.lastIndexOf(":"));
    if (prefix) return findMatch(prefix, models);
  }

  return undefined;
}

/**
 * Resolve a model reference against the available models.
 * Returns the matched model or undefined if no match found.
 */
export function resolveModel<T extends { provider: string; id: string }>(
  modelRef: string | undefined,
  models: readonly T[],
): T | undefined {
  if (!modelRef || !modelRef.trim()) return undefined;
  return findMatch(modelRef.trim(), models);
}

// ── Registration ────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let hasNamed = false;

  pi.on("session_start", () => {
    hasNamed = false;
  });

  pi.on("agent_end", (_event, ctx: ExtensionContext) => {
    const settings = loadSessionNameConfig();

    // Guard: feature disabled
    if (!settings.enabled) return;

    // Guard: already named this session
    if (hasNamed) return;

    // Guard: session already named via --name or /name
    if (pi.getSessionName()) return;

    // Guard: skip ephemeral sessions (no session file)
    if (!ctx.sessionManager.getSessionFile()) return;

    hasNamed = true;

    // TODO (Task 3): Generate and apply session title using AI
    // - Summarize the conversation to produce a concise title
    // - Call pi.sessionName(title) to set it
  });
}
