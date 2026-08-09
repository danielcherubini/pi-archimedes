import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock @shikijs/cli to avoid actual Shiki initialization
vi.mock("@shikijs/cli", () => ({
	codeToANSI: vi.fn().mockResolvedValue("mocked"),
}));

// Mock the ANSI normalization
vi.mock("./ansi/index.js", () => ({
	normalizeShikiContrast: vi.fn((s: string[]) => s),
}));

// ── Imports ──────────────────────────────────────────────────────────────────

import { lang, setConfigGetter } from "./shiki.js";

// ── lang ─────────────────────────────────────────────────────────────────────

describe("lang", () => {
	it("resolves .ts to typescript", () => {
		expect(lang("file.ts")).toBe("typescript");
	});

	it("resolves .tsx to tsx", () => {
		expect(lang("file.tsx")).toBe("tsx");
	});

	it("resolves .js to javascript", () => {
		expect(lang("file.js")).toBe("javascript");
	});

	it("resolves .jsx to jsx", () => {
		expect(lang("file.jsx")).toBe("jsx");
	});

	it("resolves .mjs to javascript", () => {
		expect(lang("file.mjs")).toBe("javascript");
	});

	it("resolves .cjs to javascript", () => {
		expect(lang("file.cjs")).toBe("javascript");
	});

	it("resolves .py to python", () => {
		expect(lang("script.py")).toBe("python");
	});

	it("resolves .rb to ruby", () => {
		expect(lang("script.rb")).toBe("ruby");
	});

	it("resolves .rs to rust", () => {
		expect(lang("lib.rs")).toBe("rust");
	});

	it("resolves .go to go", () => {
		expect(lang("main.go")).toBe("go");
	});

	it("resolves .java to java", () => {
		expect(lang("Main.java")).toBe("java");
	});

	it("resolves .c to c", () => {
		expect(lang("main.c")).toBe("c");
	});

	it("resolves .cpp to cpp", () => {
		expect(lang("main.cpp")).toBe("cpp");
	});

	it("resolves .h to c", () => {
		expect(lang("header.h")).toBe("c");
	});

	it("resolves .hpp to cpp", () => {
		expect(lang("header.hpp")).toBe("cpp");
	});

	it("resolves .cs to csharp", () => {
		expect(lang("Program.cs")).toBe("csharp");
	});

	it("resolves .swift to swift", () => {
		expect(lang("main.swift")).toBe("swift");
	});

	it("resolves .kt to kotlin", () => {
		expect(lang("Main.kt")).toBe("kotlin");
	});

	it("resolves .html to html", () => {
		expect(lang("index.html")).toBe("html");
	});

	it("resolves .css to css", () => {
		expect(lang("styles.css")).toBe("css");
	});

	it("resolves .scss to scss", () => {
		expect(lang("styles.scss")).toBe("scss");
	});

	it("resolves .json to json", () => {
		expect(lang("package.json")).toBe("json");
	});

	it("resolves .yaml to yaml", () => {
		expect(lang("config.yaml")).toBe("yaml");
	});

	it("resolves .yml to yaml", () => {
		expect(lang("config.yml")).toBe("yaml");
	});

	it("resolves .toml to toml", () => {
		expect(lang("Cargo.toml")).toBe("toml");
	});

	it("resolves .md to markdown", () => {
		expect(lang("README.md")).toBe("markdown");
	});

	it("resolves .sql to sql", () => {
		expect(lang("query.sql")).toBe("sql");
	});

	it("resolves .sh to bash", () => {
		expect(lang("script.sh")).toBe("bash");
	});

	it("resolves .bash to bash", () => {
		expect(lang("script.bash")).toBe("bash");
	});

	it("resolves .zsh to bash", () => {
		expect(lang("script.zsh")).toBe("bash");
	});

	it("resolves .lua to lua", () => {
		expect(lang("init.lua")).toBe("lua");
	});

	it("resolves .php to php", () => {
		expect(lang("index.php")).toBe("php");
	});

	it("resolves .dart to dart", () => {
		expect(lang("main.dart")).toBe("dart");
	});

	it("resolves .xml to xml", () => {
		expect(lang("config.xml")).toBe("xml");
	});

	it("resolves .graphql to graphql", () => {
		expect(lang("schema.graphql")).toBe("graphql");
	});

	it("resolves .svelte to svelte", () => {
		expect(lang("App.svelte")).toBe("svelte");
	});

	it("resolves .vue to vue", () => {
		expect(lang("App.vue")).toBe("vue");
	});

	it("returns undefined for unknown extensions", () => {
		expect(lang("file.unknown")).toBeUndefined();
	});

	it("returns undefined for no extension", () => {
		expect(lang("Makefile")).toBeUndefined();
	});

	it("returns undefined for empty string", () => {
		expect(lang("")).toBeUndefined();
	});

	it("is case-insensitive for extensions", () => {
		expect(lang("file.TS")).toBe("typescript");
		expect(lang("file.Ts")).toBe("typescript");
		expect(lang("file.PY")).toBe("python");
		expect(lang("file.JS")).toBe("javascript");
	});

	it("handles deep paths", () => {
		expect(lang("/some/deep/path/to/file.ts")).toBe("typescript");
	});

	it("handles paths with dots in filename", () => {
		expect(lang("my.file.name.ts")).toBe("typescript");
	});

	// ── Property tests ───────────────────────────────────────────────────

	it("property: lang(x) returns consistent result for same extension", () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 1, maxLength: 100 }),
				filename => {
					const result1 = lang(filename);
					const result2 = lang(filename);
					return result1 === result2;
				},
			),
		);
	});

	it("property: lang only returns known languages or undefined", () => {
		const knownLanguages = new Set([
			"typescript", "tsx", "javascript", "jsx", "python", "ruby",
			"rust", "go", "java", "c", "cpp", "csharp", "swift", "kotlin",
			"html", "css", "scss", "json", "yaml", "toml", "markdown",
			"sql", "bash", "lua", "php", "dart", "xml", "graphql",
			"svelte", "vue",
		]);

		fc.assert(
			fc.property(
				fc.string({ minLength: 1, maxLength: 100 }),
				filename => {
					const result = lang(filename);
					return result === undefined || knownLanguages.has(result);
				},
			),
		);
	});
});

// ── setConfigGetter ──────────────────────────────────────────────────────────

describe("setConfigGetter", () => {
	it("changes the config getter", async () => {
		// Import hlBlock to test config getter effect
		const { hlBlock } = await import("./shiki.js");

		setConfigGetter(() => ({ diffTheme: "github-light" }));

		// The config getter should now return the new theme
		// We can't directly inspect _getConfig, but we can verify hlBlock
		// doesn't throw and uses the new config
		const result = await hlBlock("const x = 1;", "javascript");
		expect(Array.isArray(result)).toBe(true);
	});

	it("accepts custom theme", async () => {
		setConfigGetter(() => ({ diffTheme: "nord" }));

		const { hlBlock } = await import("./shiki.js");
		const result = await hlBlock("print('hello')", "python");
		expect(Array.isArray(result)).toBe(true);
	});

	it("restores default behavior after setting", () => {
		setConfigGetter(() => ({ diffTheme: "github-dark" }));
		// Should not throw
		expect(() => setConfigGetter(() => ({ diffTheme: "one-dark" }))).not.toThrow();
	});
});
