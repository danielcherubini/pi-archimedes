import { describe, expect, it } from "vitest";
import { splitCommandIntoArgv } from "./argv-split.js";

describe("splitCommandIntoArgv", () => {
	it("splits simple whitespace-separated words", () => {
		expect(splitCommandIntoArgv("apt install ripgrep")).toEqual(["apt", "install", "ripgrep"]);
	});

	it("collapses runs of spaces and trims leading/trailing whitespace", () => {
		expect(splitCommandIntoArgv("  ls   -la  ")).toEqual(["ls", "-la"]);
	});

	it("keeps single-quoted strings together, stripping the quotes", () => {
		expect(splitCommandIntoArgv("echo 'hello world'")).toEqual(["echo", "hello world"]);
	});

	it("keeps double-quoted strings together, stripping the quotes", () => {
		expect(splitCommandIntoArgv('echo "hi there"')).toEqual(["echo", "hi there"]);
	});

	it("honours backslash escapes outside quotes", () => {
		expect(splitCommandIntoArgv("echo a\\ b")).toEqual(["echo", "a b"]);
	});

	it("honours backslash-escaped quote characters inside double quotes", () => {
		expect(splitCommandIntoArgv('echo "a\\"b"')).toEqual(["echo", 'a"b']);
	});

	it("honours escaped backslashes inside double quotes", () => {
		expect(splitCommandIntoArgv('echo "a\\\\"')).toEqual(["echo", "a\\"]);
	});

	it("single quotes are fully literal (no backslash processing inside)", () => {
		expect(splitCommandIntoArgv("echo 'a\\ b'")).toEqual(["echo", "a\\ b"]);
	});

	it("produces an empty word for a quoted empty string", () => {
		expect(splitCommandIntoArgv('echo ""')).toEqual(["echo", ""]);
		expect(splitCommandIntoArgv("echo ''")).toEqual(["echo", ""]);
	});

	it("empty and whitespace-only input produce no words", () => {
		expect(splitCommandIntoArgv("")).toEqual([]);
		expect(splitCommandIntoArgv("   ")).toEqual([]);
	});

	it("adjacent quotes and bare text merge into one word", () => {
		expect(splitCommandIntoArgv('echo "a b"flag')).toEqual(["echo", "a bflag"]);
	});

	it("keeps shell metacharacters as their own words (no shell semantics)", () => {
		expect(splitCommandIntoArgv("ls | grep foo")).toEqual(["ls", "|", "grep", "foo"]);
		expect(splitCommandIntoArgv("echo a && echo b")).toEqual(["echo", "a", "&&", "echo", "b"]);
	});

	it("handles a missing closing double quote by running to end of input", () => {
		expect(splitCommandIntoArgv('echo "unterminated')).toEqual(["echo", "unterminated"]);
	});
});
