import { describe, expect, it } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { maskLine, promptForPassword } from "./prompt.js";

// ── minimal ui.custom fakes ──────────────────────────────────────────────────

interface MaskedComponent {
	handleInput(data: string): void;
	render(width: number): string[];
}

interface UnmaskedFactory {
	(
		tui: { requestRender(): void },
		theme: { fg: (token: string, text: string) => string },
		keybindings: unknown,
		done: (value: string) => void,
	): { handleInput(data: string): void; render(width: number): string[]; focused: boolean };
}

function maskedPromptUi(): { ctx: ExtensionContext; component(): MaskedComponent } {
	let active: MaskedComponent | undefined;
	const ui = {
		custom: (factory: UnmaskedFactory): Promise<string> =>
			new Promise<string>((resolve) => {
				active = factory({ requestRender: () => {} }, { fg: (_token, text) => text }, {}, resolve);
			}),
	} as unknown as ExtensionContext["ui"];
	const ctx = { mode: "tui" as const, hasUI: true, ui } as unknown as ExtensionContext;
	return { ctx, component: () => active as MaskedComponent };
}

const headlessCtx = (mode: string): ExtensionContext =>
	({ mode, hasUI: mode === "rpc", ui: {} }) as unknown as ExtensionContext;

// ── maskLine ─────────────────────────────────────────────────────────────────

describe("maskLine", () => {
	it("returns an empty string for an empty buffer", () => {
		expect(maskLine("")).toBe("");
	});

	it("renders one • per character and never leaks the raw value", () => {
		for (const secret of ["s", "supersecret", "pässword123"]) {
			expect(maskLine(secret)).toBe("•".repeat(secret.length));
			expect(maskLine(secret)).not.toContain(secret);
		}
	});
});

// ── headless block ────────────────────────────────────────────────────────────

describe("promptForPassword — headless block", () => {
	it("rejects when ctx.mode is json", async () => {
		await expect(promptForPassword(headlessCtx("json"))).rejects.toThrow();
	});

	it("rejects in print mode", async () => {
		await expect(promptForPassword(headlessCtx("print"))).rejects.toThrow();
	});

	it("rejects in rpc mode (hasUI is true there, but custom components need a TUI)", async () => {
		const ctx = headlessCtx("rpc");
		expect(ctx.hasUI).toBe(true);
		await expect(promptForPassword(ctx)).rejects.toThrow();
	});
});

// ── component behavior ────────────────────────────────────────────────────────

describe("promptForPassword — masked component", () => {
	it("buffers printable chars, applies Backspace, resolves on Enter, and never renders raw chars", async () => {
		const { ctx, component } = maskedPromptUi();
		const promise = promptForPassword(ctx);

		const c = component();
		for (const ch of ["s", "e", "c", "r", "e", "t"]) c.handleInput(ch);
		c.handleInput("\x7f"); // backspace drops the last char

		const renderedText = c.render(120).join("\n");
		expect(renderedText).toContain("•••••"); // 5 chars typed after backspace
		expect(renderedText).not.toContain("secre");
		expect(renderedText).not.toContain("secret");

		c.handleInput("\r"); // enter confirms
		await expect(promise).resolves.toBe("secre");
	});

	it("ignores non-printable control characters", async () => {
		const { ctx, component } = maskedPromptUi();
		const promise = promptForPassword(ctx);

		const c = component();
		c.handleInput("\x01"); // control char — not a printable
		c.handleInput("a");
		c.handleInput("\r");
		await expect(promise).resolves.toBe("a");
	});

	it("resolves with an empty string on Esc (cancellation)", async () => {
		const { ctx, component } = maskedPromptUi();
		const promise = promptForPassword(ctx);

		const c = component();
		c.handleInput("x");
		c.handleInput("y");
		c.handleInput("\x1b"); // escape
		await expect(promise).resolves.toBe("");
	});

	it("resolves with an empty string when Enter is pressed with no input", async () => {
		const { ctx, component } = maskedPromptUi();
		const promise = promptForPassword(ctx);
		component().handleInput("\r");
		await expect(promise).resolves.toBe("");
	});
});
