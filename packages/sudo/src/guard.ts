/**
 * bash-sudo guard (plan 030, Task 2) — a pure scanner that vetoes interactive
 * `sudo` issued through the built-in `bash` tool, so privileged execution is
 * funneled through `sudo_exec` (masked prompt, `-S` stdin, in-memory cache).
 * Heuristic per ADR 0010: best-effort heuristics, over-blocking is the safe
 * direction, the tested no-prompt flag set is a stable contract.
 *
 * Strategy (tokenize + lookahead, NOT raw-string matching):
 * 1. Strip Bash comments — a `#` at a word boundary starts a comment to end of
 *    line, unless it is inside quotes or a heredoc body. A naive
 *    `includes("sudo")` would false-positive on `sudo` in comments/strings
 *    and miss `FOO=sudo` env-prefixed tokens.
 * 2. A small character-level state machine tracks single quotes, double
 *    quotes, `$(...)` substitutions, backticks, and heredoc bodies, and splits
 *    the command into segments on whitespace / `;` / `|` / `&` / newline / `(`.
 * 3. Tokens keep their `$` / `${` / `$(...) ` prefixes: a `$NAME` or `${NAME}` token
 *    is a variable reference, distinguishable from the literal word `NAME`
 *    (a bare `$` no longer drops out of the token).
 * 4. A token is the *command word* `sudo` (matched by basename, so
 *    `/usr/bin/sudo` counts too) only when it is the first non-env-assignment,
 *    non-interpolated token of a segment — so `FOO=sudo x`, `alias x='sudo'`,
 *    `echo 'sudo'`, and `$(sudo ...)` never match as literal `sudo`. A
 *    *pure variable reference* in command position whose name is `sudo`
 *    case-insensitively (`$SUDO apt`) is treated as an interactive sudo and
 *    gets the same no-prompt lookahead — a conservative over-block (an
 *    actually-empty expansion like an unset `$sudo` doesn't run sudo, but
 *    blocking is the safe direction).
 * 5. For each command-word `sudo`, lookahead over the segment's remaining
 *    tokens: if any no-prompt flag appears (`-n`, `-l`, `-v`, `-K`, `-k`,
 *    `--non-interactive`, or a merged short flag composed solely of those)
 *    the segment cannot prompt and is allowed; otherwise, if any command
 *    operand applies, the segment is blocked.
 * 6. Runner wrappers: when the command word is one of `env nohup nice
 *    ionice time timeout command builtin exec xargs`, the segment's
 *    remaining tokens are scanned for a literal `sudo` word (or a sudo-named
 *    variable reference) and evaluated with the same no-prompt lookahead.
 *    `eval` is NOT a wrapper — it is handled by (7).
 * 7. Nested shells / eval: when the command word is one of `sh bash dash zsh
 *    ksh su` and the remainder carries a `-c` flag (exact `-c`, or a merged
 *    short-flag bundle whose last character is `c`, e.g. `-xc`), the token
 *    immediately after the flag is the program string — the whole scanner is
 *    re-run on it recursively. `eval <rest>` likewise recursively scans its
 *    remaining tokens as a shell string. Recursion is capped at 3 levels;
 *    past the cap, the command is blocked conservatively (reason
 *    "nested shell depth limit"), since over-blocking is acceptable.
 * 8. Compound-command keyword transparency: when the FIRST token of a segment
 *    is a bash keyword (`if then else elif while until for case do done fi
 *    esac ! { (`), the keyword tokens are skipped and the rest of the segment
 *    is evaluated — so `then sudo apt`, `do sudo apt`, `{ sudo apt`, and
 *    `! sudo apt` all reach the sudo command-word check.
 * 9. Heredoc bodies are treated as command text (a `bash <<EOF` heredoc
 *    executes; over-blocking a `cat <<EOF` body is the safe direction).
 *
 * Known gaps — accepted residual bypasses (heuristic, per ADR 0010):
 *  (1) Arbitrary-name indirection requires cross-token assignment
 *      attribution (`S='sudo'; $S apt`) — only the sudo-*named* variable
 *      reference case ($SUDO) is caught.
 *  (2) `$(...)`/backtick substitution — both the sudo-inside-interpolation
 *      and the substitution-word-erasure subcases (`$(true) sudo apt`,
 *      `` `x` sudo apt ``) remain plan-deferred; a substitution *prefixed*
 *      assignment word (`x=$(echo 1) sudo apt`) likewise stays allowed.
 *  (3) Program source from files/redirects (`bash script.sh`, `bash < file`,
 *      `su -c file`) is unresolvable without reading files.
 *  (4) Shell state persisting ACROSS separate bash-tool calls (assignments,
 *      aliases from earlier calls) is out of model.
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
/** Runner wrappers that can forward a real command after their own args. */
const RUNNER_WRAPPERS = new Set([
	"env",
	"nohup",
	"nice",
	"ionice",
	"time",
	"timeout",
	"command",
	"builtin",
	"exec",
	"xargs",
]);
/** Shells that take a program string after their `-c` flag. */
const NESTED_SHELLS = new Set(["sh", "bash", "dash", "zsh", "ksh", "su"]);
/** Bash compound-command keyword tokens transparent to the command position. */
const KEYWORD_TOKENS = new Set([
	"if",
	"then",
	"else",
	"elif",
	"while",
	"until",
	"for",
	"case",
	"do",
	"done",
	"fi",
	"esac",
	"!",
	"{",
	"(",
]);
/** Maximum nested-shell/eval recursion before we block conservatively. */
const MAX_NEST_DEPTH = 3;
/**
 * Reason for the depth-cap block — conservatively over-block a command when
 * the nested-shell/eval depth exceeds the cap.
 */
const DEPTH_LIMIT_CAUSE = "Nested shell/eval depth limit reached (blocked conservatively).";

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

/** Last path component — `/usr/bin/sudo` is still the `sudo` command. */
function basename(word: string): string {
	const i = word.lastIndexOf("/");
	return i === -1 ? word : word.slice(i + 1);
}

/**
 * Extract a variable's name from a *pure variable reference* word — `$NAME`
 * or `${NAME}` covering the whole token — otherwise null. Words embedded in
 * other characters (`$SUDO`, `x=\`${NAME}\``, shell names) return null.
 */
function variableRefName(word: string): string | null {
	const m = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(word);
	if (m) return m[1] ?? null;
	const b = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(word);
	return b ? (b[1] ?? null) : null;
}

/** Word that becomes an interactive `sudo` command position (exact or via reference). */
function isSudoWord(t: GuardToken): boolean {
	if (t.substituted) return false;
	if (basename(t.text) === "sudo") return true;
	const name = variableRefName(t.text);
	return name !== null && name.toLowerCase() === "sudo";
}

/**
 * Shell `-c` flag match: an exact `-c` or a merged short-flag bundle whose
 * last character is `c` (e.g. `-xc`, `-lc` — `c` consumes the next word as
 * the program string for all of the shells in NESTED_SHELLS). Long flags
 * (`--c`) and bare words do not match.
 */
function isShellCFlag(text: string): boolean {
	return /^-[A-Za-z]*c$/.test(text);
}

/**
 * No-prompt lookahead over the tokens after index `from` (the `sudo`
 * occurrence itself). Returns whether the occurrence would prompt: allowed
 * if any no-prompt flag, and a command operand applies.
 */
function lookaheadBlocks(tokens: GuardToken[], from: number): boolean {
	let allowed = false;
	let commandApplies = false;
	for (const t of tokens.slice(from + 1)) {
		if (t.text.length > 0 && t.text.startsWith("-") && !t.substituted) {
			if (isAllowedFlag(t.text)) allowed = true;
		} else {
			// A non-flag operand means a command is being elevated.
			commandApplies = true;
		}
	}
	return commandApplies && !allowed;
}

interface SegmentVerdict {
	blocked: boolean;
	segmentText: string;
	cause?: string;
}

/**
 * Classify one segment against the sudo rule. Returns null when the segment contains
 * no blocking `sudo`.
 */
function scanSegment(tokens: GuardToken[], depth: number): SegmentVerdict | null {
	if (tokens.length === 0) return null;
	const segmentText = tokens.map((t) => t.text).join(" ");
	// Above the nesting cap (even an empty segment inside a deeply-nested
	// program string), conservatively over-block.
	if (depth > MAX_NEST_DEPTH) {
		return { blocked: true, segmentText, cause: DEPTH_LIMIT_CAUSE };
	}

	// G-3: skip leading compound-command keyword tokens — `then sudo apt`,
	// `do sudo apt`, `{ sudo apt`, `! sudo apt` all reach the sudo check below.
	let rest = tokens;
	for (;;) {
		const head = rest[0];
		if (head === undefined || !KEYWORD_TOKENS.has(head.text)) break;
		rest = rest.slice(1);
	}
	if (rest.length === 0) return null;

	// Command word = first non-assignment, non-interpolated token.
	let cmdIdx = -1;
	for (let i = 0; i < rest.length; i++) {
		const t = rest[i];
		if (t === undefined) continue;
		if (t.substituted) continue; // `$(...)` / backtick results are not command position
		if (isEnvAssignment(t.text)) continue; // leading `FOO=...` assigns, doesn't invoke
		cmdIdx = i;
		break;
	}
	if (cmdIdx === -1) return null;
	const cmd = rest[cmdIdx];
	if (cmd === undefined) return null;

	// (1) Literal `sudo` (by basename) or a pure variable reference named
	// `sudo` case-insensitively → same no-prompt lookahead as a literal.
	if (isSudoWord(cmd)) {
		return lookaheadBlocks(rest, cmdIdx)
			? { blocked: true, segmentText }
			: null;
	}

	// (2) Recursive commands: shell `-c 'program'` and `eval <rest>`.
	const recurse = (program: string): SegmentVerdict | null => {
		if (depth + 1 > MAX_NEST_DEPTH) {
			return { blocked: true, segmentText, cause: DEPTH_LIMIT_CAUSE };
		}
		return scanSegments(tokenizeCommand(program), depth + 1);
	};
	if (NESTED_SHELLS.has(basename(cmd.text))) {
		for (let j = cmdIdx + 1; j < rest.length; j++) {
			const t = rest[j];
			if (t === undefined) continue;
			if (t.substituted || !isShellCFlag(t.text)) continue;
			// The next token is the program string (quotes already stripped by the tokenizer).
			const program = rest.slice(j + 1).map((x) => x.text).join(" ");
			return recurse(program);
		}
		return null; // `bash script.sh` / `bash < file` — known gap, no -c string to scan
	}
	if (basename(cmd.text) === "eval") {
		const program = rest.slice(cmdIdx + 1).map((x) => x.text).join(" ");
		return recurse(program);
	}

	// (3) Runner wrapper: scan the trailing tokens for a `sudo` occurrence
	// (exact word or sudo-named reference), skipping flags and assignments.
	if (RUNNER_WRAPPERS.has(basename(cmd.text))) {
		for (let j = cmdIdx + 1; j < rest.length; j++) {
			const t = rest[j];
			if (t === undefined) continue;
			if (t.substituted) continue;
			if (t.text.startsWith("-")) continue;
			if (isEnvAssignment(t.text)) continue;
			if (!isSudoWord(t)) continue;
			if (lookaheadBlocks(rest, j)) {
				return { blocked: true, segmentText };
			}
		}
	}
	return null;
}

/** Scan every segment of a (re-tokenized) program string at the given depth. */
function scanSegments(segments: GuardToken[][], depth: number): SegmentVerdict | null {
	for (const tokens of segments) {
		const verdict = scanSegment(tokens, depth);
		if (verdict?.blocked) return verdict;
	}
	return null;
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
				// G-4a: keep `$` in the token — a `$NAME`/`${NAME}` reference must
				// be distinguishable from the literal word `NAME`.
				pushChar("$");
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
	const verdict = scanSegments(segments, 0);
	if (verdict?.blocked) {
		return {
			blocked: true,
			reason:
				`${BLOCK_REASON_PREFIX}${verdict.cause ? `\n${verdict.cause}` : ""}\n` +
				`Matched segment: ${verdict.segmentText}`,
			matchedSudoSegment: verdict.segmentText,
		};
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
