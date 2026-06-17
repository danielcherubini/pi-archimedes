/**
 * Minimal "ask" tool for the forked child process.
 *
 * Uses IPC (process.send / process.on("message")) to forward questions
 * to the parent, which displays the UI and sends back the response.
 */

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { randomUUID } from "node:crypto";

// ── Schema (matches the existing ask tool) ───────────────────────────────────

const OptionItemSchema = Type.Object({
  label: Type.String({ description: "Display label" }),
});

const QuestionItemSchema = Type.Object({
  id: Type.String({ description: "Question id" }),
  question: Type.String({ description: "Question text" }),
  description: Type.Optional(Type.String({
    description: "Optional context in Markdown/plain text.",
  })),
  options: Type.Array(OptionItemSchema, {
    description: "Available options. Do not include 'Other'.",
    minItems: 1,
  }),
  multi: Type.Optional(Type.Boolean({ description: "Allow multi-select" })),
  recommended: Type.Optional(Type.Number({
    description: "0-indexed recommended option.",
  })),
});

const AskParamsSchema = Type.Object({
  questions: Type.Array(QuestionItemSchema, { description: "Questions to ask", minItems: 1 }),
});

type AskParams = Static<typeof AskParamsSchema>;

// ── Session content helpers (minimal from packages/ask) ──────────────────────

interface QuestionResult {
  id: string;
  question: string;
  description: string | undefined;
  options: string[];
  multi: boolean;
  selectedOptions: string[];
  customInput: string | undefined;
}

function sanitizeForSessionText(value: string): string {
  return value
    .replace(/[\r\n\t]/g, " ")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function sanitizeMultilineForSessionText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => sanitizeForSessionText(line))
    .join("\n")
    .trim();
}

function toSessionSafeQuestionResult(result: QuestionResult): QuestionResult {
  const selectedOptions = result.selectedOptions
    .map(sanitizeForSessionText)
    .filter((s) => s.length > 0);

  const rawDescription = result.description;
  const description = rawDescription == null ? undefined : sanitizeMultilineForSessionText(rawDescription);
  const rawCustomInput = result.customInput;
  const customInput = rawCustomInput == null ? undefined : sanitizeForSessionText(rawCustomInput);

  return {
    id: sanitizeForSessionText(result.id) || "(unknown)",
    question: sanitizeForSessionText(result.question) || "(empty question)",
    description: description && description.length > 0 ? description : undefined,
    options: result.options.map((o) => sanitizeForSessionText(o) || "(empty option)"),
    multi: result.multi,
    selectedOptions,
    customInput: customInput && customInput.length > 0 ? customInput : undefined,
  };
}

function formatSelectionForSummary(result: QuestionResult): string {
  const hasSelected = result.selectedOptions.length > 0;
  const hasCustom = Boolean(result.customInput);

  if (!hasSelected && !hasCustom) return "(cancelled)";
  if (hasSelected && hasCustom) {
    const selected = result.multi ? `[${result.selectedOptions.join(", ")}]` : result.selectedOptions[0] ?? "";
    return `${selected} + Other: "${result.customInput}"`;
  }
  if (hasCustom) return `"${result.customInput}"`;
  if (result.multi) return `[${result.selectedOptions.join(", ")}]`;
  return result.selectedOptions[0] ?? "";
}

function formatQuestionResult(result: QuestionResult): string {
  return `${result.id}: ${formatSelectionForSummary(result)}`;
}

function formatQuestionContext(result: QuestionResult, index: number): string {
  const lines: string[] = [
    `Question ${index + 1} (${result.id})`,
    `Prompt: ${result.question}`,
  ];

  if (result.description) {
    lines.push("Context:");
    for (const line of result.description.split("\n")) {
      lines.push(`  ${line}`);
    }
  }

  lines.push("Options:");
  lines.push(...result.options.map((opt, i) => `  ${i + 1}. ${opt}`));
  lines.push("Response:");

  const hasSelected = result.selectedOptions.length > 0;
  const hasCustom = Boolean(result.customInput);

  if (!hasSelected && !hasCustom) {
    lines.push("  Selected: (cancelled)");
    return lines.join("\n");
  }

  if (hasSelected) {
    const text = result.multi ? `[${result.selectedOptions.join(", ")}]` : result.selectedOptions[0];
    lines.push(`  Selected: ${text}`);
  }

  if (hasCustom) {
    if (!hasSelected) lines.push("  Selected: (Other)");
    lines.push(`  Custom input: ${result.customInput}`);
  }

  return lines.join("\n");
}

function buildAskSessionContent(results: QuestionResult[]): string {
  const safe = results.map(toSessionSafeQuestionResult);
  const summary = safe.map(formatQuestionResult).join("\n");
  const context = safe.map((r, i) => formatQuestionContext(r, i)).join("\n\n");
  return `User answers:\n${summary}\n\nAnswer context:\n${context}`;
}

// ── Tool definition ─────────────────────────────────────────────────────────

const ASK_TOOL_DESCRIPTION = `
Ask the user for clarification when a choice materially affects the outcome.

- Use when multiple valid approaches have different trade-offs.
- Prefer 2-5 concise options.
- Use multi=true when multiple answers are valid.
- Use recommended=<index> (0-indexed) to mark the default option.
- Use description to provide Markdown/plain context.
- You can ask multiple related questions in one call using questions[].
- Do NOT include an 'Other' option; UI adds it automatically.
`.trim();

export function createIpcAskTool(): ToolDefinition<any, unknown, any> {
  return {
    name: "ask",
    label: "Ask",
    description: ASK_TOOL_DESCRIPTION,
    parameters: AskParamsSchema,

    async execute(_toolCallId, params: AskParams, _signal, _onUpdate, _ctx) {
      const requestId = randomUUID();
      const questions = params.questions;

      // Send ask_request to parent via IPC.
      process.send?.({ type: "ask_request", requestId, questions });

      // Await response from parent.
      const response = await new Promise<{
        cancelled: boolean;
        results: Array<{ id: string; selectedOptions: string[]; customInput?: string }>;
      }>((resolve) => {
        // If IPC channel is closed, resolve immediately with cancelled.
        if (!process.send) {
          resolve({ cancelled: true, results: questions.map((q) => ({ id: q.id, selectedOptions: [] })) });
          return;
        }

        let resolved = false;
        const finish = (r: { cancelled: boolean; results: Array<{ id: string; selectedOptions: string[]; customInput?: string }> }) => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timer);
          process.removeListener("message", listener);
          resolve(r);
        };

        const listener = (msg: { type?: string; requestId?: string; cancelled?: boolean; results?: unknown[] }) => {
          if (msg.type === "ask_response" && msg.requestId === requestId) {
            finish({
              cancelled: msg.cancelled ?? true,
              results: msg.results as Array<{ id: string; selectedOptions: string[]; customInput?: string }>,
            });
          }
        };
        process.on("message", listener);

        // 5-minute timeout.
        const timer = setTimeout(() => {
          finish({ cancelled: true, results: questions.map((q) => ({ id: q.id, selectedOptions: [] })) });
        }, 5 * 60 * 1000);
        timer.unref();
      });

      // Build results matching the existing ask tool's format.
      const results: QuestionResult[] = questions.map((q, i) => {
        const r = response.results[i];
        return {
          id: q.id,
          question: q.question,
          description: q.description && q.description.trim().length > 0 ? q.description : undefined,
          options: q.options.map((o) => o.label),
          multi: q.multi ?? false,
          selectedOptions: r?.selectedOptions ?? [],
          customInput: r?.customInput ?? undefined,
        };
      });

      const contentText = buildAskSessionContent(results);

      if (response.cancelled && results.every((r) => r.selectedOptions.length === 0)) {
        return {
          content: [{ type: "text", text: "User cancelled the question." }],
          details: {},
        };
      }

      return {
        content: [{ type: "text", text: contentText }],
        details: {},
      };
    },
  };
}
