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
