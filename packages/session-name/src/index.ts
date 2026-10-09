import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { loadConfig } from "@pi-archimedes/core/settings-io";
import type { SettingItem } from "@earendil-works/pi-tui";

// ── Config ──────────────────────────────────────────────────────────────────

export interface SessionNameSettings {
  // suite-managed by meta's plugin gate (archimedes.sessionName.enabled — see ADR 0012); session-name never reads this
  enabled?: boolean | undefined;
  model?: string | undefined;
  reasoning?: ThinkingLevel | null | undefined;
}

const DEFAULT_SESSION_NAME_CONFIG: SessionNameSettings = {
  model: undefined,
  reasoning: "minimal",
};

const NAMESPACE = "archimedes.sessionName";

/** The thinking levels we accept — pi-ai's set, minus `off` (see below). */
const REASONING_LEVELS: readonly ThinkingLevel[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/**
 * Decide what reasoning level the title request asks for, given whatever was
 * found in settings.json.
 *
 * `settings.json` is hand-edited strict JSON and `loadConfig` returns untyped
 * JSON, so the declared `ThinkingLevel` type narrows nothing at runtime: a
 * wrong case, a stray space, or a typo all get through. Junk must not be
 * forwarded, because pi cannot rescue it everywhere — of the ten adapters that
 * export a `streamSimple`, three never call `clampThinkingLevel`:
 * `anthropic-messages`, `bedrock-converse-stream`, and `pi-messages` (Radius,
 * which forwards the level verbatim to its backend). On the Anthropic pair an
 * unknown value hits `mapThinkingLevelToEffort`, whose `default:` returns
 * `"high"`: a typo silently buys maximum effort on a one-line title. On
 * budget-based Claude it instead misses the four-key budget table, and the
 * resulting `undefined` reaches the provider as an invalid `max_tokens`.
 *
 * Outcomes: a real level (casing/padding tolerated) is forwarded; `null` means
 * omit the option entirely; anything else — including absent — is treated like
 * an absent setting and gets the default, with a log line so the user can find
 * the typo. `"off"` is deliberately not accepted: pi skips thinking entirely
 * when the option is omitted, so it would be a fourth spelling of "unset".
 */
export function resolveTitleReasoning(raw: unknown): ThinkingLevel | null {
  if (raw === null) return null;
  if (typeof raw === "string") {
    const value = raw.trim().toLowerCase();
    const match = REASONING_LEVELS.find((level) => level === value);
    if (match) return match;
  }
  if (raw !== undefined) {
    console.error(
      "[archimedes] session-name: ignoring unrecognized reasoning",
      JSON.stringify(raw),
    );
  }
  return DEFAULT_SESSION_NAME_CONFIG.reasoning ?? null;
}

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

// ── Title generation (runs in background) ───────────────────────────────────

/**
 * Generate and set a session title. Runs asynchronously without blocking
 * the agent_end handler so the UI stays responsive.
 */
export async function generateTitle(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  onSuccess: () => void,
  onFailure: () => void,
) {
  try {
    const settings = loadSessionNameConfig();

    // 1. Build conversation text — first user + assistant exchange only
    const branch = ctx.sessionManager.getBranch();
    const userLines: string[] = [];
    const assistantLines: string[] = [];
    let foundUser = false;
    let foundAssistant = false;

    for (const entry of branch) {
      if (entry.type !== "message") continue;
      const msg = entry.message;
      if (msg.role !== "user" && msg.role !== "assistant") continue;

      const content = msg.content;

      if (msg.role === "user" && !foundUser) {
        const texts = typeof content === "string"
          ? [content]
          : Array.isArray(content)
            ? content
                .filter((b: any) => b?.type === "text" && typeof b.text === "string")
                .map((b: any) => b.text)
            : [];
        if (texts.length > 0) {
          const userText = texts.join("\n").trim().slice(0, 500);
          userLines.push("User: " + userText);
          foundUser = true;
        }
      }

      if (msg.role === "assistant" && !foundAssistant && foundUser) {
        const texts = typeof content === "string"
          ? [content]
          : Array.isArray(content)
            ? content
                .filter((b: any) => b?.type === "text" && typeof b.text === "string")
                .map((b: any) => b.text)
            : [];
        if (texts.length > 0) {
          const assistantText = texts.join("\n").trim().slice(0, 500);
          assistantLines.push("Assistant: " + assistantText);
          foundAssistant = true;
        }
      }

      if (foundUser && foundAssistant) break;
    }

    const conversationText = [...userLines, ...assistantLines].join("\n");
    if (!conversationText.trim()) return;

    // 2. Build title prompt
    const titlePrompt = [
      "Generate a concise title (3-8 words) for this conversation.",
      "The title should capture what the user is working on.",
      "Return only the title, nothing else.",
      "",
      "<conversation>",
      conversationText,
      "</conversation>",
    ].join("\n");

    // 3. Resolve model
    const settingsModel = resolveModel(settings.model, ctx.modelRegistry.getAll());
    const model = settingsModel ?? ctx.model;
    if (!model) return;

    // 4. Check auth — skip without incrementing failCount if not configured
    if (!ctx.modelRegistry.hasConfiguredAuth(model)) return;

    // 5. Stream simple with built-in auth resolution.
    // Reasoning is resolved, not forwarded raw: see resolveTitleReasoning().
    const reasoning = resolveTitleReasoning(settings.reasoning);
    const stream = ctx.modelRegistry.streamSimple(
      model,
      {
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: titlePrompt }],
            timestamp: Date.now(),
          },
        ],
      },
      {
        ...(reasoning !== null ? { reasoning } : {}),
        cacheRetention: "none",
        sessionId: crypto.randomUUID(),
      },
    );

    const response = await stream.result();
    // User/system cancellation is not a failure; don't burn the retry budget
    if (response.stopReason === "aborted") {
      return;
    }
    if (response.stopReason === "error") {
      console.error("[archimedes] session-name failed:", response.errorMessage ?? "title request failed");
      onFailure();
      return;
    }

    // 7. Extract and clean title
    const title = response.content
      .filter((c: any): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^(\"|')((?:(?!\1).)*)\1$/, "$2")
      .slice(0, 80);

    if (!title) {
      onFailure();
      return;
    }

    // 8. Race guard — re-check before setting
    if (pi.getSessionName()) return;

    // 9. Set session name
    pi.setSessionName(title);
    onSuccess();
  } catch (e) {
    // Session replacement or print-mode teardown makes an in-flight title irrelevant.
    if (e instanceof Error && e.message.includes("stale after session replacement")) return;
    console.error("[archimedes] session-name failed:", e);
    onFailure();
  }
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerSessionName(pi: ExtensionAPI) {
  let hasNamed = false;
  let failCount = 0;

  pi.on("session_start", () => {
    hasNamed = false;
    failCount = 0;
  });

  pi.on("agent_end", async (_event, ctx: ExtensionContext) => {
    // Guard: already named this session
    if (hasNamed) return;

    // Guard: too many transient failures — stop trying
    if (failCount >= 3) return;

    // Guard: session already named via --name or /name
    if (pi.getSessionName()) return;

    // Guard: skip ephemeral sessions (no session file)
    if (!ctx.sessionManager.getSessionFile()) return;

    // Fire-and-forget: spawn title generation in background so handler
    // returns immediately and the UI becomes responsive.
    void generateTitle(pi, ctx, () => { hasNamed = true; }, () => {
      failCount++;
      if (failCount !== 3) return;
      try {
        if (ctx.hasUI && !pi.getSessionName()) {
          ctx.ui.notify("Session naming failed 3 times. Check the model configuration or use /name.", "warning");
        }
      } catch { /* Reporting must not count as another naming failure. */ }
    });
  });
}

export default registerSessionName;

// ── Settings UI ─────────────────────────────────────────────────────────────

/** Build settings UI items for the session-name package. */
export function getSessionNameSettingsItems(config: SessionNameSettings): SettingItem[] {
  return [
    {
      id: "sessionNameModel",
      label: "Model for naming",
      description: "Model used for title generation (leave empty for current model)",
      currentValue: config.model || "(current model)",
    },
  ];
}
