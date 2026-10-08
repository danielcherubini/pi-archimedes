import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ModelThinkingLevel, ThinkingLevel, ThinkingLevelMap } from "@earendil-works/pi-ai";
import { loadConfig } from "@pi-archimedes/core/settings-io";
import type { SettingItem } from "@earendil-works/pi-tui";

// ── Config ──────────────────────────────────────────────────────────────────

/**
 * Values accepted in `archimedes.sessionName.reasoning`. `"off"` and an unset
 * value mean the same thing (see {@link resolveReasoningOption}): no reasoning
 * level is requested, which is how pi represents "thinking off".
 */
export type SessionNameReasoning = ModelThinkingLevel;

/** Display label for the unset value in the /archimedes panel (the default). */
export const REASONING_DEFAULT_LABEL = "(none)";

/** Panel cycle order — left/right on the reasoning row. */
export const REASONING_VALUES: readonly string[] = [
  REASONING_DEFAULT_LABEL,
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export interface SessionNameSettings {
  // suite-managed by meta's plugin gate (archimedes.sessionName.enabled — see ADR 0012); session-name never reads this
  enabled?: boolean | undefined;
  model?: string | undefined;
  reasoning?: SessionNameReasoning | undefined;
}

const DEFAULT_SESSION_NAME_CONFIG: SessionNameSettings = {
  model: undefined,
  reasoning: undefined,
};

const NAMESPACE = "archimedes.sessionName";

export function loadSessionNameConfig(): SessionNameSettings {
  const raw = loadConfig<SessionNameSettings>(NAMESPACE, DEFAULT_SESSION_NAME_CONFIG);
  // settings.json is hand-editable strict JSON: anything unrecognised in
  // `reasoning` falls back to the default (no reasoning requested) rather than
  // being forwarded to the provider.
  return { ...raw, reasoning: normalizeReasoning(raw.reasoning) };
}

/** Accept only known reasoning labels; anything else (wrong case, typo, junk) → undefined. */
export function normalizeReasoning(raw: unknown): SessionNameReasoning | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim().toLowerCase();
  return isReasoningLevel(value) ? value : undefined;
}

const REASONING_LEVELS: readonly string[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

function isReasoningLevel(value: string): value is SessionNameReasoning {
  return (REASONING_LEVELS as readonly string[]).includes(value);
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

// ── Reasoning level ─────────────────────────────────────────────────────────

/** Shape of the model fields that decide whether a reasoning level is usable. */
type ReasoningCapableModel = {
  reasoning?: boolean;
  thinkingLevelMap?: ThinkingLevelMap;
};

/**
 * Decide the `reasoning` option for the title request.
 *
 * `undefined` (the default) means "request no reasoning level", which is how pi
 * encodes thinking-off: adapters send nothing, or the model's own `off`
 * mapping when it declares one. Passing a level at all is opt-in via
 * `archimedes.sessionName.reasoning`.
 *
 * A configured level is dropped when the model marks it unsupported —
 * `thinkingLevelMap[level] === null` is pi-ai's explicit "this provider/model
 * rejects this level", and forwarding it is what got us HTTP 400s (issue #80).
 * `"off"` is never forwarded: it is the default.
 */
export function resolveReasoningOption(
  setting: SessionNameReasoning | undefined,
  model: ReasoningCapableModel | undefined,
): ThinkingLevel | undefined {
  if (!setting || setting === "off") return undefined;
  if (model?.thinkingLevelMap?.[setting] === null) return undefined;
  return setting;
}

// ── Failure reporting ───────────────────────────────────────────────────────

/** Attempts allowed per session before naming gives up. */
export const MAX_TITLE_FAILURES = 3;

/**
 * Per-session failure accounting for title generation.
 *
 * Naming runs unattended, so silence is a bug: `record()` notifies exactly twice
 * at most — once on the first failure (with the provider's reason) and once when
 * the retry budget runs out. Failures in between stay quiet so a broken model
 * cannot spam the chat. Reset on `session_start`, so `/reload` gives it another shot.
 */
export interface FailureReporter {
  /** Record a failed attempt; `notify` is called only at the two milestones. */
  record(reason: string, notify: (message: string) => void): void;
  /** True once {@link MAX_TITLE_FAILURES} attempts have failed — stop trying. */
  exhausted(): boolean;
  reset(): void;
}

export function createFailureReporter(): FailureReporter {
  let failures = 0;
  let notifiedFirst = false;
  let notifiedBudget = false;

  return {
    record(reason, notify) {
      failures++;
      if (!notifiedFirst) {
        notifiedFirst = true;
        notify(`Session naming failed: ${reason}`);
      }
      if (failures >= MAX_TITLE_FAILURES && !notifiedBudget) {
        notifiedBudget = true;
        notify(
          `Session naming gave up after ${failures} failures this session. ` +
            "Check archimedes.sessionName.model / .reasoning in settings.json, or use /name.",
        );
      }
    },
    exhausted: () => failures >= MAX_TITLE_FAILURES,
    reset() {
      failures = 0;
      notifiedFirst = false;
      notifiedBudget = false;
    },
  };
}

// ── Stale context ───────────────────────────────────────────────────────────

/**
 * pi marks a captured ctx/pi as stale after session replacement, reload, or
 * print-mode teardown, and every proxied accessor then throws this. The title
 * request outlives `agent_end`, so in `pi -p` teardown races the in-flight
 * stream (issue #80, root cause 3): the name simply doesn't get set, which is
 * not a naming failure and must not burn the retry budget. pi exposes no
 * isStale() probe, so the message is the only signal available.
 */
const STALE_CTX_MARKER = "This extension ctx is stale";

export function isStaleCtxError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(STALE_CTX_MARKER);
}

/** Notify without ever throwing back into a background task. */
function notifyWarning(ctx: ExtensionContext, message: string): void {
  try {
    // hasUI is false in print/JSON mode (no ui context is bound there), and
    // reading either member throws once the ctx is stale — both are fine:
    // there is nobody to tell.
    if (ctx.hasUI) ctx.ui.notify(message, "warning");
  } catch {
    /* stale ctx after teardown / reload — nothing to notify */
  }
}

// ── Title generation (runs in background) ───────────────────────────────────

/**
 * Generate and set a session title. Runs asynchronously without blocking
 * the agent_end handler so the UI stays responsive.
 *
 * `onFailure` receives a human-readable reason for the failure so the caller
 * can surface it; it is not called for cancellations, skipped models, or a
 * stale context.
 */
export async function generateTitle(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  onSuccess: () => void,
  onFailure: (reason: string) => void,
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

    // 4. Check auth — skip without counting a failure if not configured
    if (!ctx.modelRegistry.hasConfiguredAuth(model)) return;

    // 5. Pick a reasoning level: none unless the user asked for one and the
    //    model accepts it (see resolveReasoningOption).
    const reasoning = resolveReasoningOption(settings.reasoning, model);

    // 6. Stream simple with built-in auth resolution
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
        ...(reasoning ? { reasoning } : {}),
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
      onFailure(friendlyResponseError(response));
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
      onFailure(`model ${model.provider}/${model.id} returned no title`);
      return;
    }

    // 8. Race guard — re-check before setting
    if (pi.getSessionName()) return;

    // 9. Set session name
    pi.setSessionName(title);
    onSuccess();
  } catch (e) {
    // Teardown/reload raced the background request: the name is lost, nothing
    // is wrong with the model. Stay silent and leave the budget alone.
    if (isStaleCtxError(e)) return;
    console.error("[archimedes] session-name failed:", e);
    onFailure(e instanceof Error ? e.message : String(e));
  }
}

/** Provider error text for a failed response, trimmed to something notify-able. */
function friendlyResponseError(response: { errorMessage?: string; content?: unknown }): string {
  const raw = response.errorMessage?.trim();
  if (raw) return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
  return "the model returned an error with no message";
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerSessionName(pi: ExtensionAPI) {
  let hasNamed = false;
  const failures = createFailureReporter();

  pi.on("session_start", () => {
    hasNamed = false;
    failures.reset();
  });

  pi.on("agent_end", async (_event, ctx: ExtensionContext) => {
    // Guard: already named this session
    if (hasNamed) return;

    // Guard: too many failures — stop trying (and the user was already told)
    if (failures.exhausted()) return;

    // Guard: session already named via --name or /name
    if (pi.getSessionName()) return;

    // Guard: skip ephemeral sessions (no session file)
    if (!ctx.sessionManager.getSessionFile()) return;

    // Fire-and-forget: spawn title generation in background so handler
    // returns immediately and the UI becomes responsive.
    void generateTitle(pi, ctx, () => { hasNamed = true; }, (reason) => {
      failures.record(reason, (message) => notifyWarning(ctx, message));
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
    {
      id: "sessionNameReasoning",
      label: "Naming reasoning",
      description:
        "Reasoning level for the title request. (none) is the default and asks for no reasoning; some providers reject specific levels, so the default is the safe setting.",
      currentValue: config.reasoning && config.reasoning !== "off" ? config.reasoning : REASONING_DEFAULT_LABEL,
      values: [...REASONING_VALUES],
    },
  ];
}
