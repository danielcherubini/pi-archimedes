import { unindentCodeBlocks } from "./unindent.js";

/**
 * message_end handler: mutate thinking content before it reaches the UI.
 *
 * Only does unindent of fenced code blocks. The "Thinking..." label is
 * prepended inside updateContent (patch.ts) so it appears during streaming,
 * not just after thinking completes.
 */
export function transformThinkingContent(
	message: { role: string; content: Array<{ type: string; thinking?: string }> },
): void {
	if (message.role !== "assistant") return;

	for (const content of message.content) {
		if (content.type === "thinking" && content.thinking?.trim()) {
			const trimmed = content.thinking.trim();
			content.thinking = unindentCodeBlocks(trimmed);
		}
	}
}
