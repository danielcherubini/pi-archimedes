import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { handleBashToolCall, isInteractiveSudoAttempt } from "./guard.js";

// ── plan-030 Task 2: the 12 enumerated detection cases ─────────────────────

describe("isInteractiveSudoAttempt — plan-030 Task 2 cases", () => {
	it("1. `sudo apt update` → blocked", () => {
		const r = isInteractiveSudoAttempt("sudo apt update");
		expect(r.blocked).toBe(true);
	});

	it("2. `sudo -n true` → NOT blocked (sudo -n can't prompt)", () => {
		const r = isInteractiveSudoAttempt("sudo -n true");
		expect(r.blocked).toBe(false);
	});

	it("3. `sudo -n true; sudo apt update` → blocked (second segment)", () => {
		const r = isInteractiveSudoAttempt("sudo -n true; sudo apt update");
		expect(r.blocked).toBe(true);
	});

	it("4. `FOO=sudo bar; sudo rm -rf /` → blocked (only the second sudo is a real call)", () => {
		const r = isInteractiveSudoAttempt("FOO=sudo bar; sudo rm -rf /");
		expect(r.blocked).toBe(true);
		expect(r.matchedSudoSegment).toContain("sudo rm -rf /");
	});

	it("5. `echo 'sudo apt update'` → NOT blocked (inner command is echo)", () => {
		const r = isInteractiveSudoAttempt("echo 'sudo apt update'");
		expect(r.blocked).toBe(false);
	});

	it("6. heredoc body containing `sudo apt` → blocked", () => {
		const r = isInteractiveSudoAttempt("cat <<EOF\nsudo apt\nEOF");
		expect(r.blocked).toBe(true);
	});

	it("7. `FOO=sudo; sudo -n true` → NOT blocked (only the -n form is present)", () => {
		const r = isInteractiveSudoAttempt("FOO=sudo; sudo -n true");
		expect(r.blocked).toBe(false);
	});

	it("8. `sudo ls; echo hi` → blocked", () => {
		const r = isInteractiveSudoAttempt("sudo ls; echo hi");
		expect(r.blocked).toBe(true);
	});

	it("9. `alias x='sudo'; echo hi` → NOT blocked (alias string, no real sudo segment)", () => {
		const r = isInteractiveSudoAttempt("alias x='sudo'; echo hi");
		expect(r.blocked).toBe(false);
	});

	it("10. `sudo -l` → NOT blocked (list allowed)", () => {
		const r = isInteractiveSudoAttempt("sudo -l");
		expect(r.blocked).toBe(false);
	});

	it("11. `FOO=sudo echo hi` → NOT blocked (env-assignment value, not command word)", () => {
		const r = isInteractiveSudoAttempt("FOO=sudo echo hi");
		expect(r.blocked).toBe(false);
	});

	it("returns a structured result: reason only when blocked, matched segment when blocked", () => {
		const blocked = isInteractiveSudoAttempt("sudo apt update");
		expect(blocked.blocked).toBe(true);
		expect(blocked.reason).toBeTruthy();
		expect(blocked.matchedSudoSegment).toBe("sudo apt update");

		const allowed = isInteractiveSudoAttempt("sudo -n true");
		expect(allowed.blocked).toBe(false);
		expect(allowed.reason).toBeUndefined();
		expect(allowed.matchedSudoSegment).toBeUndefined();
	});
});

// ── lookahead / tokenization hardening (beyond the enumerated 12) ──────────

describe("isInteractiveSudoAttempt — tokenizer + lookahead hardening", () => {
	it("allows the full no-prompt flag set: -v, -K, -k", () => {
		expect(isInteractiveSudoAttempt("sudo -v").blocked).toBe(false);
		expect(isInteractiveSudoAttempt("sudo -K").blocked).toBe(false);
		expect(isInteractiveSudoAttempt("sudo -k").blocked).toBe(false);
	});

	it("blocks `sudo -u root apt update` (disallowed flag + command)", () => {
		const r = isInteractiveSudoAttempt("sudo -u root apt update");
		expect(r.blocked).toBe(true);
	});

	it("blocks merged short flags that are not purely no-prompt: `sudo -ABC true`", () => {
		expect(isInteractiveSudoAttempt("sudo -ABC true").blocked).toBe(true);
	});

	it("allows merged short flags that are purely no-prompt: `sudo -nk true`", () => {
		expect(isInteractiveSudoAttempt("sudo -nk true").blocked).toBe(false);
	});

	it("allows the `--non-interactive` long form", () => {
		expect(isInteractiveSudoAttempt("sudo --non-interactive true").blocked).toBe(false);
	});

	it("blocks `sudo` inside command substitution chains' real command word: `sleep 1 && sudo apt`", () => {
		expect(isInteractiveSudoAttempt("sleep 1 && sudo apt install x").blocked).toBe(true);
	});

	it("does not treat sudo inside $() or backticks as a command word (plan: interpolation is not command position)", () => {
		expect(isInteractiveSudoAttempt("echo $(sudo -l)").blocked).toBe(false);
		expect(isInteractiveSudoAttempt("cd $(dirname sudo)").blocked).toBe(false);
		expect(isInteractiveSudoAttempt("X=$( sudo ls )").blocked).toBe(false);
		expect(isInteractiveSudoAttempt("ls $(sudo apt update)").blocked).toBe(false);
	});

	it("ignores sudo in comments (word-boundary #), including `sudo -n` in a comment", () => {
		expect(isInteractiveSudoAttempt("# sudo rm -rf /").blocked).toBe(false);
		expect(isInteractiveSudoAttempt("echo hi # sudo apt update").blocked).toBe(false);
	});

	it("does not false-positive on words that merely contain sudo", () => {
		expect(isInteractiveSudoAttempt("find . -name 'sudo'").blocked).toBe(false);
		expect(isInteractiveSudoAttempt("ls ./sudoku").blocked).toBe(false);
	});

	it("allows bare `sudo -K` (flags only, no command to elevate)", () => {
		expect(isInteractiveSudoAttempt("sudo -K").blocked).toBe(false);
	});

	it("blocks a `); sudo apt` tail after substitution on the same line", () => {
		expect(isInteractiveSudoAttempt("$(kill 1); sudo apt update").blocked).toBe(true);
	});

	it("treats an `&&`-chained second segment without -n as blocked", () => {
		expect(isInteractiveSudoAttempt("sudo -n true && sudo apt update").blocked).toBe(true);
	});
});

// ── review G-4a: `$`-preservation in the tokenizer (no `$`-dropping) ────────

describe("isInteractiveSudoAttempt — G-4a `$`-preservation stays identical", () => {
	it("does not treat a `$`-prefixed echo operand as a command word", () => {
		expect(isInteractiveSudoAttempt("echo $SUDO").blocked).toBe(false);
		expect(isInteractiveSudoAttempt("echo ${SUDO}").blocked).toBe(false);
		expect(isInteractiveSudoAttempt("for i in 1; do echo $i; done").blocked).toBe(false);
	});

	it("keeps substitution/interpolation cases unchanged (no false `$` detection)", () => {
		expect(isInteractiveSudoAttempt("X=$( sudo apt)").blocked).toBe(false);
		expect(isInteractiveSudoAttempt("echo $(sudo -l)").blocked).toBe(false);
		expect(isInteractiveSudoAttempt("git log -S sudo").blocked).toBe(false);
		expect(isInteractiveSudoAttempt("ps aux | grep sudo").blocked).toBe(false);
		expect(isInteractiveSudoAttempt("find . -name sudo").blocked).toBe(false);
		expect(isInteractiveSudoAttempt("echo use sudo -n carefully").blocked).toBe(false);
		expect(isInteractiveSudoAttempt("$(kill 1); sudo apt update").blocked).toBe(true);
	});
});

// ── review G-4b: sudo-named variable reference in command position ──────────

describe("isInteractiveSudoAttempt — G-4b variable-ref command word", () => {
	it("blocks `$SUDO apt` when `SUDO` is a variable reference (cross-token attribution missed — conservative)", () => {
		const r = isInteractiveSudoAttempt("SUDO=sudo; $SUDO apt");
		expect(r.blocked).toBe(true);
	});

	it("blocks lowercase `$sudo apt` (over-block, safe direction — `sudo` unset expands to empty)", () => {
		expect(isInteractiveSudoAttempt("$sudo apt").blocked).toBe(true);
	});

	it("blocks braced `${SUDO} apt"
	, () => {
		expect(isInteractiveSudoAttempt("${SUDO} apt").blocked).toBe(true);
	});

	it("allows `$SUDO -n true` (same no-prompt lookahead as a literal sudo)", () => {
		expect(isInteractiveSudoAttempt("$SUDO -n true").blocked).toBe(false);
		expect(isInteractiveSudoAttempt("$SUDO -l").blocked).toBe(false);
	});

	it("allows non-sudo-named pure variable references and non-command-position refs", () => {
		expect(isInteractiveSudoAttempt("$SUDOTO apt").blocked).toBe(false);
		expect(isInteractiveSudoAttempt("echo $SUDO").blocked).toBe(false);
		expect(isInteractiveSudoAttempt("$SUDO echo hi").blocked).toBe(true); // `$SUDO` as the command with an operand
	});
});

// ── review G-1: runner-wrapper pass-through (env / nohup / nice / ...) ──────

describe("isInteractiveSudoAttempt — G-1 runner wrappers", () => {
	it.each([
		"env sudo apt update",
		"nice -n 10 sudo apt update",
		"nohup sudo apt >/dev/null",
		"time sudo apt",
		"ionice -c2 -n0 sudo apt",
		"timeout 5 sudo apt update",
		"command sudo apt update",
		"exec sudo apt",
		"xargs -I {} sudo {} < list",
		"env FOO=bar sudo apt",
	])("blocks `%s`", (command) => {
		expect(isInteractiveSudoAttempt(command).blocked).toBe(true);
	});

	it("allows a no-prompt sudo inside a runner wrapper", () => {
		expect(isInteractiveSudoAttempt("env sudo -n true").blocked).toBe(false);
		expect(isInteractiveSudoAttempt("timeout 5 sudo -n ls").blocked).toBe(false);
		expect(isInteractiveSudoAttempt("nice -n 10 sudo -l").blocked).toBe(false);
		expect(isInteractiveSudoAttempt("command -v sudo").blocked).toBe(false);
		expect(isInteractiveSudoAttempt("which sudo").blocked).toBe(false);
	});

	it("allows a bare runner with `sudo` and no command operand (cannot prompt)", () => {
		expect(isInteractiveSudoAttempt("env sudo").blocked).toBe(false);
		expect(isInteractiveSudoAttempt("sudo -n ls && timeout 10 sudo").blocked).toBe(false);
	});

	it("blocks a sudo-named variable reference in the runner remainder (over-block, safe direction)", () => {
		expect(isInteractiveSudoAttempt("env $SUDO apt").blocked).toBe(true);
	});

	it.each([
		"command grep -r sudo .",
		"timeout 5 grep -c sudo big.log",
		"env LC_ALL=C grep sudo file",
		"env echo a sudo b",
	])("allows `%s` (sudo is an operand of the wrapped command, not its command word — B-2)", (command) => {
		expect(isInteractiveSudoAttempt(command).blocked).toBe(false);
	});

	it("keeps `xargs '\"sudo\" cat' < list` allowed (no command-word sudo survives the quotes — B-1 no-collateral)", () => {
		expect(isInteractiveSudoAttempt("xargs '\"sudo\" cat' < list").blocked).toBe(false);
	});
});

// ── review G-2: nested-shell / eval recursion ───────────────────────────────

describe("isInteractiveSudoAttempt — G-2 nested shells and eval", () => {
	/** Nest a program string in N `bash -c "..."` levels (inner quotes escaped). */
	function nestBashC(program: string, levels: number): string {
		let s = program;
		for (let i = 0; i < levels; i++) {
			s = `bash -c "${s.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
		}
		return s;
	}

	it.each([
		"sh -c 'sudo apt update'",
		'bash -c "sudo apt update"',
		"bash -c 'sudo apt update'",
		"dash -xc 'sudo apt update'",
		"su -c \"sudo apt\"",
		"ksh -c sudo apt",
		"eval 'sudo apt update'",
		"eval sudo apt",
		"zsh -c 'sudo apt update'",
	])("blocks `%s`", (command) => {
		expect(isInteractiveSudoAttempt(command).blocked).toBe(true);
	});

	it("allows a no-prompt or non-sudo program string", () => {
		expect(isInteractiveSudoAttempt("bash -c 'sudo -n true'").blocked).toBe(false);
		expect(isInteractiveSudoAttempt("sh -c 'echo sudo'").blocked).toBe(false);
		expect(isInteractiveSudoAttempt("bash -c 'apt update'").blocked).toBe(false);
		expect(isInteractiveSudoAttempt("su -c \"sudo -n true\"").blocked).toBe(false);
		expect(isInteractiveSudoAttempt("eval 'sudo -n ls'").blocked).toBe(false);
		expect(isInteractiveSudoAttempt("bash script.sh").blocked).toBe(false); // known gap: program from file
	});

	it("blocks a deeply-quoted `bash -c` fixture that exceeds the depth cap", () => {
		// fixture: `bash -c 'bash -c "bash -c \\(escaped inner levels) sudo apt''`
		const command = `bash -c 'bash -c "bash -c \\"bash -c \\\\\\\"sudo apt\\\\\\\"\\""''`;
		const r = isInteractiveSudoAttempt(command);
		expect(r.blocked).toBe(true);
		expect(r.reason).toContain("depth");
	});

	it("blocks a 3-level nested `bash -c` chain reaching a real interactive sudo (not the depth cap)", () => {
		const r = isInteractiveSudoAttempt(nestBashC("sudo apt", 3));
		expect(r.blocked).toBe(true);
		expect(r.reason).not.toContain("depth");
		expect(isInteractiveSudoAttempt(nestBashC("sudo -n true", 3)).blocked).toBe(false);
	});

	it("blocks beyond the nesting depth cap (4 levels): reason names the depth limit", () => {
		const r = isInteractiveSudoAttempt(nestBashC("sudo apt", 4));
		expect(r.blocked).toBe(true);
		expect(r.reason).toContain("depth");
	});

	it.each([
		"sh -c '\"sudo apt\"'",
		"bash -c \"'sudo apt'\"",
		"bash -c '\"sudo apt update\"'",
		"eval '\"sudo apt\"'",
		"eval \"'sudo apt'\"",
		"env '\"sudo\" apt'",
		"nohup '\"sudo\" apt'",
		"timeout 5 '\"sudo\" apt'",
		"command '\"sudo\" apt'",
	])("blocks `%s` (quoted sudo survives re-tokenization as one word, hiding from the command word — B-1)", (command) => {
		expect(isInteractiveSudoAttempt(command).blocked).toBe(true);
	});
});

// ── review G-3: compound-command keyword transparency ───────────────────────

describe("isInteractiveSudoAttempt — G-3 compound-command keywords", () => {
	it.each([
		"if true; then sudo apt update; fi",
		"while :; do sudo apt update; done",
		"for i in 1; do sudo apt update; done",
		"{ sudo apt update; }",
		"! sudo apt update",
		"( sudo apt update )",
	])("blocks `%s`", (command) => {
		expect(isInteractiveSudoAttempt(command).blocked).toBe(true);
	});

	it("allows a no-prompt sudo inside a compound body", () => {
		expect(isInteractiveSudoAttempt("if true; then sudo -n true; fi").blocked).toBe(false);
		expect(isInteractiveSudoAttempt("while :; do sudo -n true; done").blocked).toBe(false);
		expect(isInteractiveSudoAttempt("for i in 1; do echo $i; done").blocked).toBe(false);
	});

	it("treats bare keyword-only segments as having no command word", () => {
		expect(isInteractiveSudoAttempt("fi").blocked).toBe(false);
		expect(isInteractiveSudoAttempt("done").blocked).toBe(false);
		expect(isInteractiveSudoAttempt("else").blocked).toBe(false);
		expect(isInteractiveSudoAttempt("}").blocked).toBe(false);
	});
});

// ── integration: handleBashToolCall (called directly, as the tool_call veto) ─

describe("handleBashToolCall — tool_call veto integration", () => {
	function bashEvent(command: string): ToolCallEvent {
		return { type: "tool_call", toolCallId: "t-1", toolName: "bash", input: { command, timeout: 30 } };
	}

	it("blocks a bash event whose command is interactive sudo", () => {
		const result = handleBashToolCall(bashEvent("sudo apt update"));
		expect(result).toEqual(
			expect.objectContaining({
				block: true,
				reason: expect.stringContaining("sudo_exec"),
			}),
		);
	});

	it("returns undefined for a bash event that is `sudo -n`", () => {
		expect(handleBashToolCall(bashEvent("sudo -n true"))).toBeUndefined();
	});

	it("returns undefined for non-bash tools", () => {
		const result = handleBashToolCall({
			type: "tool_call",
			toolCallId: "t-2",
			toolName: "read",
			input: { path: "src/index.ts" },
		});
		expect(result).toBeUndefined();
	});

	it("returns undefined for a bash event with an empty command", () => {
		expect(handleBashToolCall(bashEvent(""))).toBeUndefined();
	});
});
