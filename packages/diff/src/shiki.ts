/** Shiki syntax highlighting — lazy init, LRU cache, language detection. */

import { extname } from "node:path";
import { codeToANSI } from "@shikijs/cli";
import type { BundledLanguage, BundledTheme } from "shiki";

import { normalizeShikiContrast } from "./ansi.js";

// ---------------------------------------------------------------------------
// Config access
// ---------------------------------------------------------------------------

let _getConfig: () => { diffTheme: string } = () => ({ diffTheme: "github-dark" });
export function setConfigGetter(fn: () => { diffTheme: string }): void {
	_getConfig = fn;
}

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

const EXT_LANG: Record<string, BundledLanguage> = {
	ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
	mjs: "javascript", cjs: "javascript", py: "python", rb: "ruby",
	rs: "rust", go: "go", java: "java", c: "c", cpp: "cpp",
	h: "c", hpp: "cpp", cs: "csharp", swift: "swift", kt: "kotlin",
	html: "html", css: "css", scss: "scss", json: "json",
	yaml: "yaml", yml: "yaml", toml: "toml", md: "markdown",
	sql: "sql", sh: "bash", bash: "bash", zsh: "bash",
	lua: "lua", php: "php", dart: "dart", xml: "xml",
	graphql: "graphql", svelte: "svelte", vue: "vue",
};

export function lang(fp: string): BundledLanguage | undefined {
	return EXT_LANG[extname(fp).slice(1).toLowerCase()];
}

// ---------------------------------------------------------------------------
// Shiki cache + lazy init
// ---------------------------------------------------------------------------

const MAX_HL_CHARS = 80_000;
const CACHE_LIMIT = 192;

let _shikiReady = false;
async function ensureShiki(): Promise<void> {
	if (_shikiReady) return;
	_shikiReady = true;
	codeToANSI("", "typescript", _getConfig().diffTheme as BundledTheme).catch(() => {});
}

const _cache = new Map<string, string[]>();

function _touch(k: string, v: string[]): string[] {
	_cache.delete(k);
	_cache.set(k, v);
	while (_cache.size > CACHE_LIMIT) {
		const first = _cache.keys().next().value;
		if (first === undefined) break;
		_cache.delete(first);
	}
	return v;
}

export async function hlBlock(code: string, language: BundledLanguage | undefined): Promise<string[]> {
	if (!code) return [""];
	if (!language || code.length > MAX_HL_CHARS) return code.split("\n");

	await ensureShiki();

	const theme = _getConfig().diffTheme;
	const k = `${theme}\0${language}\0${code}`;
	const hit = _cache.get(k);
	if (hit) return _touch(k, hit);

	try {
		const ansi = normalizeShikiContrast(await codeToANSI(code, language, theme as BundledTheme));
		const out = (ansi.endsWith("\n") ? ansi.slice(0, -1) : ansi).split("\n");
		return _touch(k, out);
	} catch {
		return code.split("\n");
	}
}
