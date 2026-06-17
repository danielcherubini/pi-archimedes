import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

interface AppendWrappedTextOptions {
	indent?: number;
	formatLine?: (line: string) => string;
}

function normalizeMultilineText(text: string): string[] {
	const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	const lines = normalized.split("\n");
	return lines.length > 0 ? lines : [""];
}

export function appendWrappedTextLines(
	renderedLines: string[],
	text: string,
	width: number,
	options: AppendWrappedTextOptions = {},
): void {
	const safeWidth = Number.isFinite(width) ? Math.max(1, Math.floor(width)) : 1;
	const indent = Number.isFinite(options.indent) ? Math.max(0, Math.floor(options.indent ?? 0)) : 0;
	const prefix = " ".repeat(indent);
	const wrapWidth = Math.max(1, safeWidth - indent);
	const formatLine = options.formatLine ?? ((line: string) => line);

	for (const sourceLine of normalizeMultilineText(text)) {
		const wrappedLines = wrapTextWithAnsi(sourceLine, wrapWidth);
		const safeWrappedLines = wrappedLines.length > 0 ? wrappedLines : [""];
		for (const wrappedLine of safeWrappedLines) {
			renderedLines.push(truncateToWidth(`${prefix}${formatLine(wrappedLine)}`, safeWidth));
		}
	}
}
