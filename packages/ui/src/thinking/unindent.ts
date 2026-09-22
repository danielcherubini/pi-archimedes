/**
 * Strip common leading whitespace and trailing blank lines from every fenced
 * code block in `text`.  Returns the transformed string.
 *
 * Algorithm per block:
 * 0. Normalize `\r\n` → `\n` in the full input text before processing.
 * 1. Find the minimum leading whitespace across all non-empty lines.
 * 2. Strip that many characters from the start of every line
 *    (empty lines stay empty — they contribute no content but preserve structure).
 * 3. Pop trailing empty lines.
 *
 * Trailing blank lines are ALWAYS stripped, even from 0-indent blocks.
 * Leading whitespace is only stripped when minIndent > 0.
 * Blocks containing only whitespace are left untouched.
 *
 * Known limitations:
 * - Only space-based indentation is handled (tabs are not expanded).
 * - If one line has 0 indent and others have N indent, nothing is stripped
 *   (minIndent === 0). This is standard textwrap.dedent behavior.
 * - Fenced code blocks using 4+ backticks may be misparsed. The regex uses a
 *   negative lookahead to reject 4+ backtick openings (`/^(```(?!`))/
 * - Line endings in the output are always `\n` (CRLF input is normalized).
 */
export function unindentCodeBlocks(text: string): string {
	// Step 0: normalize CRLF → LF
	text = text.replace(/\r\n/g, "\n");

	// Regex matches fenced code blocks with 3 backticks (not 4+).
	// Group 1: opening fence
	// Group 2: language tag (may be empty)
	// Group 3: block content (everything between fences)
	// Group 4: closing fence
	const regex = /^(```(?!`))([^\n]*)\n([\s\S]*?)^(```(?!`))[ \t]*$/gm;

	return text.replace(regex, (match, opening, lang, content, closing) => {
		const lines = content.split("\n");

		// Check if all lines are empty or whitespace-only → leave untouched
		const allWhitespace = lines.every((line: string) => line.trim() === "");
		if (allWhitespace) {
			return match;
		}

		// Find minimum leading space count across non-empty lines
		let minIndent = Infinity;
		for (const line of lines) {
			if (line.length === 0) continue; // skip empty lines
			const m = line.match(/^( +)/);
			if (m) {
				minIndent = Math.min(minIndent, m[1].length);
			} else {
				// Line has no leading spaces → minIndent is 0
				minIndent = 0;
				break;
			}
		}

		// Strip common leading whitespace (only if minIndent > 0)
		if (minIndent > 0 && minIndent !== Infinity) {
			for (let i = 0; i < lines.length; i++) {
				if (lines[i].length >= minIndent) {
					lines[i] = lines[i].slice(minIndent);
				}
			}
		}

		// Pop trailing empty lines
		while (lines.length > 0 && lines[lines.length - 1] === "") {
			lines.pop();
		}

		return `${opening}${lang}\n${lines.join("\n")}\n${closing}`;
	});
}
