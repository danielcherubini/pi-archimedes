/**
 * bash-sudo guard (plan 030, Task 2) — a pure scanner that vetoes interactive
 * `sudo` issued through the built-in `bash` tool, so privileged execution is
 * funneled through `sudo_exec` (masked prompt, `-S` stdin, in-memory cache).
 *
 * Strategy (tokenize + lookahead, NOT raw-string matching):
 * 1. Strip Bash comments — a `#` at a word boundary starts a comment to end of
 *    line, unless it is inside quotes or a heredoc body. A naive
 *    `includes("sudo")` would false-positive on `sudo` in comments/strings
 *    and miss `FOO=sudo` env-prefixed tokens.
 * 2. A small character-level state machine tracks single quotes, double
 *    quotes, `$(...)` substitutions, backticks, and heredoc bodies, and splits
 *    the command into segments on whitespace / `;` / `|` / `&` / newline / `(`.
 * 3. A token is the *command word* `sudo` only when it is the first non-env-
 *    assignment, non-interpolated token of a segment — so `FOO=sudo x`,
 *    `alias x='sudo'`, `echo 'sudo'`, and `$(sudo ...)` never match.
 * 4. For each command-word `sudo`, lookahead over the segment's remaining
 *    tokens: if any no-prompt flag appears (`-n`, `-l`, `-v`, `-K`, `-k`,
 *    `--non-interactive`, or a merged short flag composed solely of those)
 *    the segment cannot prompt and is allowed; otherwise, if any command
 *    operand applies, the segment is blocked.
 * 5. Heredoc bodies are treated as command text (a `bash <<EOF` heredoc
 *    executes; over-blocking a `cat <<EOF` body is the safe direction).
 *
 * The scanner never mutates anything and has no I/O — the guarantee is a
 * tested function (ADR 0010).
 */
import type { BashToolInput, ToolCallEvent, ToolCallEventResult } from "@earendil-works/pi-coding-agent";

export interface GuardResult {
	blocked: boolean;
	reason?: string;
	matchedSudoSegment?: string;
}

/** Exact `sudo` flags that cannot (effectively) run an elevated command. */
const ALLOWED_FLAGS = new Set(["-n", "-l", "-v", "-K", "-k", "--non-interactive"]);
/** Single characters of merged short-flag bundles that count as no-prompt. */
const ALLOWED_SHORT_FLAG_CHARS = new Set(["n", "l", "v", "K", "k"]);

const BLOCK_REASON_PREFIX =
	"Interactive sudo in the bash tool is blocked — it can hang on a password prompt or leak the password.\n" +
	"Use the `sudo_exec` tool instead: it prompts for the password through the masked UI, passes it via `sudo -S` stdin, and never exposes it.\n" +
	"Non-interactive sudo (`sudo -n` / `-l` / `-v` / `-K` / `-k`) still works.";

interface GuardToken {
	/** Word text as it would appear to a command word (quotes dropped, escapes literalized). */
	text: string;
	/** True if any character was inside single or double quotes. */
	quoted: boolean;
	/** True if the word lives inside a `$(...)` substitution or backticks. */
	substituted: boolean;
}

interface HeredocState {
	delimiter: string;
	/** `<<-` strips leading tabs from the body/terminator lines. */
	stripTabs: boolean;
	/** True while consuming body lines (vs. the `<<DELIM` line itself). */
	active: boolean;
	/** Characters accumulated on the current heritage line (excludes the newline). */
	line: string;
}

/** `FOO=...` env-assignment word (never a command name). */
function isEnvAssignment(word: string): boolean {
	return /^[A-Za-z_][A-Za-z0-9_]*=/.test(word);
}

function isAllowedFlag(word: string): boolean {
	if (ALLOWED_FLAGS.has(word)) return true;
	// Merged short flags (`-nK`): allowed only if every character is no-prompt.
	if (word.length > 2 && word.startsWith("-") && !word.startsWith("--")) {
		for (const ch of word.slice(1)) {
			if (!ALLOWED_SHORT_FLAG_CHARS.has(ch)) return false;
		}
		return true;
	}
	return false;
}

/**
 * Classify one segment against the sudo rule. Returns null when the
 * command word is not `sudo` (nothing to evaluate).
 */
function evaluateSegment(tokens: GuardToken[]): { blocked: boolean; segmentText: string } | null {
	const segmentText = tokens.map((t) => t.text).join(" ");

	// Command word = first non-assignment, non-interpolated token.
	let command: GuardToken | undefined;
	for (const t of tokens) {
		if (t.substituted) continue; // `$(...)` / backtick results are not command position
		if (isEnvAssignment(t.text)) continue; // leading `FOO=...` assigns, doesn't invoke
		command = t;
		break;
	}
	if (command === undefined || command.text !== "sudo") return null;

	// Lookahead over the remaining tokens in this segment only.
	let allowed = false;
	let commandApplies = false;
	for (const t of tokens.slice(tokens.indexOf(command) + 1)) {
		if (t.text.length > 0 && t.text.startsWith("-") && !t.substituted) {
			if (isAllowedFlag(t.text)) allowed = true;
		} else {
			// A non-flag operand means a command is being elevated.
			commandApplies = true;
		}
	}
	return { blocked: commandApplies && !allowed, segmentText };
}

/**
 * Split a Bash command string into segments (arrays of tokens).
 * Pure: no I/O, shadows nothing, only reads `command`.
 */
export function tokenizeCommand(command: string): GuardToken[][] {
	const n = command.length;
	const segments: GuardToken[][] = [[]];
	const pushSegmentBoundary = (): void => {
		segments.push([]);
	};

	let current = "";
	let quoted = false;
	let substituted = false;
	let haveWord = false;

	let inSingle = false;
	let inDouble = false;
	let commentToEol = false;
	let subDepth = 0;
	let inBacktick = false;
	let heredoc: HeredocState | null = null;

	const flushWord = (): void => {
		const seg = segments[segments.length - 1];
		if (!seg || !haveWord) return;
		if (subDepth > 0 || inBacktick) substituted = true;
		seg.push({ text: current, quoted, substituted });
		current = "";
		quoted = false;
		substituted = false;
		haveWord = false;
	};

	const pushChar = (ch: string): void => {
		current += ch;
		haveWord = true;
	};

	let i = 0;
	while (i < n) {
		const c = command.charAt(i);
		const next = i + 1 < n ? command.charAt(i + 1) : "";

		if (heredoc?.active) {
			// Heredoc body: raw data, but each body line is parsed as command text
			// (a `bash <<EOF` heredoc executes; blocking is the safe direction).
			// `#` in a body is literal data, not a comment — a `#`-prefixed line's
			// first token is `#` (not `sudo`), so such lines are not blocked, matching
			// how bash would treat them in an executing here-doc.
			if (c === "\n") {
				const check = heredoc.stripTabs ? heredoc.line.replace(/^\t+/, "") : heredoc.line;
				if (check === heredoc.delimiter) {
					heredoc.active = false;
					heredoc = null;
					flushWord();
					pushSegmentBoundary();
				} else {
					flushWord();
					pushSegmentBoundary();
					heredoc.line = "";
				}
			} else if (c === "\t" && heredoc.stripTabs) {
				if (heredoc.line === "") continue; // leading tabs are stripped, not body content
				heredoc.line += c;
				current += c;
				haveWord = true;
			} else {
				heredoc.line += c;
				if (c === " " || c === "\t") flushWord();
				else pushChar(c);
			}
			i += 1;
			continue;
		}

		if (commentToEol) {
			if (c === "\n") {
				commentToEol = false;
				flushWord();
				pushSegmentBoundary();
			}
			i += 1;
			continue;
		}

		if (inSingle) {
			if (c === "'") inSingle = false;
			else pushChar(c);
			i += 1;
			continue;
		}

		if (inDouble) {
			if (c === "\\") {
				// `\"` and `\\` are escapes; everything else is literal.
				pushChar(next ?? "");
				i += 2;
				continue;
			}
			if (c === '"') inDouble = false;
			else pushChar(c);
			i += 1;
			continue;
		}

		switch (c) {
			case "'":
				inSingle = true;
				quoted = true;
				break;
			case '"':
				inDouble = true;
				quoted = true;
				break;
			case "\\":
				pushChar(next ?? "");
				i += 2;
				continue;
			case "$":
				if (next === "(") {
					subDepth += 1;
					substituted = true;
					pushChar("$");
					i += 1; // consume `$`; `(` falls back to the `(` case above
					continue;
				}
				break;
			case "(":
				// A top-level `(` opens a subshell — a fresh command position.
				// Inside an active `$(...)` the `(` is word text (e.g. `$( sudo)`),
				// not a segment boundary — substitution contents stay interpolated.
				if (subDepth === 0) {
					flushWord();
					pushSegmentBoundary();
				}
				break;
			case ")":
				if (subDepth > 0) subDepth -= 1;
				pushChar(c);
				break;
			case "`":
				inBacktick = !inBacktick;
				substituted = true;
				break;
			case "#": {
				const atWordBoundary =
					!haveWord && (i === 0 || " \t\n;|&(".includes(command.charAt(i - 1)));
				if (atWordBoundary) {
					flushWord();
					commentToEol = true;
				} else {
					pushChar(c);
				}
				break;
			}
			case "<":
				if (next === "<") {
					// Heredoc: `cat <<EOF`, `<<-TABEOF`, `<<'QEOF'`, etc.
					let d = i + 2;
					let stripTabs = false;
					if (command.charAt(d) === "-") {
						stripTabs = true;
						d += 1;
					}
					let stop: string | null = null;
					if (command.charAt(d) === "'" || command.charAt(d) === '"') {
						stop = command.charAt(d);
						d += 1;
					} else if (command.charAt(d) === "\\") {
						d += 1;
					}
					const start = d;
					while (d < n) {
						const dc = command.charAt(d);
						if (dc === stop || /[\s;|&]/.test(dc)) break;
						d += 1;
					}
					const delimiter = command.slice(start, d);
					heredoc = { delimiter, stripTabs, active: false, line: "" };
					pushChar("<");
					i = d; // skip past the delimiter word just consumed
					continue;
				}
				pushChar(c);
				break;
			case "\n":
				flushWord();
				if (heredoc && !heredoc.active && heredoc.delimiter !== "") {
					heredoc.active = true;
					heredoc.line = "";
				}
				pushSegmentBoundary();
				break;
			case " ":
			case "\t":
			case "\r":
				flushWord();
				break;
			case ";":
			case "|":
			case "&":
				flushWord();
				pushSegmentBoundary();
				break;
			default:
				pushChar(c);
		}
		i += 1;
	}

	flushWord();
	if (heredoc?.active && heredoc.line !== "") {
		flushWord();
	}
	return segments;
}

/**
 * Scan a bash command for an interactive `sudo` that can prompt for a
 * password. Pure — returns a structured verdict, never throws on input.
 */
export function isInteractiveSudoAttempt(command: string): GuardResult {
	const segments = tokenizeCommand(command);
	for (const tokens of segments) {
		if (tokens.length === 0) continue;
		const verdict = evaluateSegment(tokens);
		if (verdict?.blocked) {
			return {
				blocked: true,
				reason: `${BLOCK_REASON_PREFIX}\nMatched segment: ${verdict.segmentText}`,
				matchedSudoSegment: verdict.segmentText,
			};
		}
	}
	return { blocked: false };
}

/**
 * `pi.on("tool_call")` veto handler for the built-in `bash` tool (plan 030,
 * Task 2; ADR 0010). Returning `{ block: true }` makes pi produce an
 * immediate error tool result — the bash tool's `execute()` and the shell
 * spawn never run. `event.input` is NOT mutated. Exported as a named
 * function for direct integration testing.
 */
export function handleBashToolCall(event: ToolCallEvent): ToolCallEventResult | undefined {
	if (event.toolName !== "bash") return undefined;
	const command = (event.input as BashToolInput).command ?? "";
	const verdict = isInteractiveSudoAttempt(command);
	if (verdict.blocked) {
		return {
			block: true,
			reason:
				verdict.reason ??
				"Interactive sudo in the bash tool is blocked. Use sudo_exec instead — it prompts for the password through the masked UI and never exposes it. Non-interactive sudo -n / -l / -v / -K / -k still work.",
		};
	}
	return undefined;
}
