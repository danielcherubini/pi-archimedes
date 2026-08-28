/**
 * A small POSIX-ish shell-word splitter for `sudo -S` argv construction.
 *
 * Handles single quotes (fully literal), double quotes (backslash escapes
 * `\"` and `\\`), and backslash escapes outside quotes. It deliberately has
 * NO other shell semantics: no pipes, redirects, globbing, `&&`, or env
 * assignments are interpreted — those characters stay in the words, so a
 * `command` param containing them passes through to sudo's argv rather than
 * being executed by a shell. This is why the tool spawns a real argv and
 * never interpolates into a shell string.
 */
export function splitCommandIntoArgv(command: string): string[] {
	const args: string[] = [];
	let current = "";
	let hasWord = false;
	let i = 0;

	const appendWord = () => {
		args.push(current);
		current = "";
		hasWord = false;
	};

	while (i < command.length) {
		const ch = command.charAt(i);

		if (ch === "'") {
			// Single quotes: literal until the closing quote.
			i++;
			let closed = false;
			while (i < command.length) {
				const inner = command.charAt(i);
				if (inner === "'") {
					closed = true;
					i++;
					break;
				}
				current += inner;
				i++;
			}
			hasWord = true;
			if (!closed) break; // unterminated — rest was literal
		} else if (ch === '"') {
			// Double quotes: backslash only escapes " and \.
			i++;
			let closed = false;
			while (i < command.length) {
				const inner = command.charAt(i);
				if (inner === "\\" && (command.charAt(i + 1) === '"' || command.charAt(i + 1) === "\\")) {
					current += command.charAt(i + 1);
					i += 2;
					continue;
				}
				if (inner === '"') {
					closed = true;
					i++;
					break;
				}
				current += inner;
				i++;
			}
			hasWord = true;
			if (!closed) break; // unterminated — rest was literal
		} else if (ch === "\\") {
			// Outside quotes: escape the next character.
			const next = command.charAt(i + 1);
			current += next === undefined ? "\\" : next;
			i += 2;
			hasWord = true;
		} else if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
			if (hasWord) appendWord();
			i++;
		} else {
			current += ch;
			i++;
			hasWord = true;
		}
	}

	if (hasWord) appendWord();
	return args;
}
