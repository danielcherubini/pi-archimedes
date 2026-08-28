import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

/**
 * Render one `•` per typed character — pure, so the masking itself is
 * unit-testable without a TUI. The raw buffer must never appear in
 * rendered output.
 */
export function maskLine(buffer: string): string {
	return "•".repeat(buffer.length);
}

/**
 * Prompt for the sudo password through a masked `ui.custom` component
 * (ask's picker.ts pattern, extended for a text field).
 *
 * Hard requirement (ADR 0010): the password ONLY ever comes from this
 * masked interactive UI — never from a tool parameter. Headless sessions
 * (json / print, RPC, subagent children) have no TUI surface, so we reject
 * with a clear error rather than prompt. `ctx.mode === "tui"` is the
 * precise gate: `hasUI` is also true in RPC mode, where custom components
 * cannot run.
 *
 * Resolves to the typed password, or `""` when the user cancels (Esc)
 * or confirms with an empty buffer — callers treat `""` as cancellation.
 */
export function promptForPassword(ctx: ExtensionContext, command?: string, reason?: string): Promise<string> {
	if (ctx.mode !== "tui") {
		return Promise.reject(
			new Error(
				"sudo_exec can only prompt for a password in an interactive session (TUI). Headless/RPC/subagent sessions have no masked input surface.",
			),
		);
	}

	return ctx.ui.custom<string>((tui, theme, _keybindings, done) => {
		let buffer = "";

		const isPrintable = (data: string): boolean => {
			if (data.length !== 1) return false;
			const code = data.codePointAt(0);
			return code !== undefined && code >= 0x20 && code !== 0x7f;
		};

		const render = (width: number): string[] => {
			const lines: string[] = [];
			lines.push(truncateToWidth(theme.fg("warning", "  ⚠ sudo — enter your password (input is masked)"), width));
			if (command) lines.push(truncateToWidth(theme.fg("text", `  $ ${command}`), width));
			if (reason) lines.push(truncateToWidth(theme.fg("muted", `  ${reason}`), width));
			lines.push("");
			const masked = maskLine(buffer);
			lines.push(
				truncateToWidth(`  password: ${theme.fg("accent", masked)}${masked.length > 0 ? "" : theme.fg("dim", "(hidden)")}`, width),
			);
			lines.push(theme.fg("dim", "  Enter confirm · Esc cancel · Backspace delete"));
			return lines;
		};

		const handleInput = (data: string): void => {
			if (matchesKey(data, Key.ctrl("c")) || matchesKey(data, Key.escape)) {
				done("");
				return;
			}
			if (matchesKey(data, Key.enter)) {
				done(buffer);
				return;
			}
			if (matchesKey(data, Key.backspace) || matchesKey(data, Key.delete)) {
				buffer = buffer.slice(0, -1);
				tui.requestRender();
				return;
			}
			if (isPrintable(data)) {
				buffer += data;
				tui.requestRender();
				return;
			}
			// everything else (alt-sequences, other control chars): ignore
		};

		return {
			focused: true,
			render,
			invalidate: () => {},
			handleInput,
		};
	});
}

/**
 * Display the exact privileged command and the human-readable reason to
 * the user and require an explicit confirmation BEFORE any credential is
 * requested. Declining returns false — the tool must fail without
 * prompting for a password.
 */
export async function confirmCommand(ctx: ExtensionContext, command: string, reason: string): Promise<boolean> {
	const message = ["This will run with elevated privileges (password required until cached):", "", `$ ${command}`, "", `Reason: ${reason}`].join("\n");
	return ctx.ui.confirm("Confirm privileged command", message);
}
