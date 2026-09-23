---
status: approved
done-when: packages/web is registered in meta and monorepo workspace, web_search, fetch_content, and get_search_content tools execute and render with Archimedes styling, /web slash command works, and all packages pass type-checking.
---

# Web Package Specification (`@pi-archimedes/web`)

## Overview
A new first-class Archimedes package (`@pi-archimedes/web`) providing web search, content extraction, and stored content retrieval tools for Pi, styled using Archimedes' two-line header/status convention and fully integrated into the Archimedes monorepo.

---

## 1. Package Structure & Workspace Integration

### Package Metadata (`packages/web/package.json`)
- **Package Name**: `@pi-archimedes/web`
- **Version**: `2.8.0` (matching workspace monorepo version)
- **Type**: `"module"`
- **Keywords**: `["pi-package"]`
- **Files**: `["src"]`
- **Pi Manifest**: `"pi": { "extensions": ["./src/index.ts"] }`
- **Dependencies**:
  - `@pi-archimedes/core`: `"workspace:*"`
- **Peer Dependencies**:
  - `@earendil-works/pi-coding-agent`: `*`
  - `@earendil-works/pi-tui`: `*`
  - `@earendil-works/pi-ai`: `*`

### Monorepo Integration Checklist (per `AGENTS.md`)
1. `packages/web/package.json` — workspace configuration with peer dependencies.
2. `meta/package.json` — add `"@pi-archimedes/web": "workspace:*"` to dependencies.
3. `meta/src/plugins.ts` — add manifest entry to `PLUGINS`:
   ```ts
   {
     id: "web",
     label: "Web",
     description: "Web search and content fetching with multi-provider routing",
     namespace: "archimedes.web",
     load: () => import("@pi-archimedes/web")
   }
   ```
4. `meta/src/index.ts` — register web extension gated by `isPluginEnabled("web")`.
5. `.github/workflows/release.yml` — add `pnpm --filter "@pi-archimedes/web" publish --access public --no-git-checks` in publish sequence before `meta`.
6. `AGENTS.md` — update package counts (14 packages) and publish order.
7. `README.md` — add Web Access section to features and directory tree.

### Settings Namespace (`archimedes.web`)
Stored in `~/.pi/agent/settings.json`:
- `enabled`: boolean (default `true`)
- `defaultProvider`: `"auto"` | `"duckduckgo"` | `"brave"` | `"tavily"` | `"openai"` | `"perplexity"` | `"searxng"` | `"exa"` | `"jina"`
- `braveApiKey`: string (optional, or via `BRAVE_API_KEY`)
- `tavilyApiKey`: string (optional, or via `TAVILY_API_KEY`)
- `openaiApiKey`: string (optional, or via `OPENAI_API_KEY`)
- `perplexityApiKey`: string (optional, or via `PERPLEXITY_API_KEY`)
- `searxngUrl`: string (optional, or via `SEARXNG_URL`)
- `maxResults`: number (default `5`, clamp `1..20`)
- `maxContentChars`: number (default `50000`)
- `proxy`: string (optional HTTP/SOCKS proxy URL)

---

## 2. Tools Architecture

### A. `web_search` Tool
Enables web searching with multi-query routing, provider auto-detection, and result deduplication.

- **Parameters**:
  - `query` (string, optional): Single search query.
  - `queries` (string[], optional): Up to 3 queries executed concurrently for multi-angle research.
  - `numResults` (number, optional, default `5`): Maximum results per query (1..20).
  - `provider` (string enum, optional): Provider override (`"auto"`, `"duckduckgo"`, `"brave"`, `"tavily"`, `"openai"`, `"perplexity"`, `"searxng"`, `"exa"`, `"jina"`).
  - `recencyFilter` (string enum, optional): `"day" | "week" | "month" | "year"`.
  - `domainFilter` (string[], optional): Include/exclude domain rules (e.g. `["github.com", "-reddit.com"]`).
  - `proxy` (string, optional): HTTP/SOCKS proxy URL.

- **Provider Interface (`providers/types.ts`)**:
  ```ts
  export interface SearchResultItem {
    title: string;
    url: string;
    snippet: string;
    publishedDate?: string;
  }

  export interface SearchProvider {
    readonly id: string;
    readonly name: string;
    isAvailable(config: WebConfig): boolean | Promise<boolean>;
    search(query: string, options: ProviderSearchOptions, config: WebConfig): Promise<SearchResultItem[]>;
  }
  ```

- **Resolution Logic**:
  - If `provider` explicitly passed and available, use it.
  - Else if `archimedes.web.defaultProvider !== "auto"`, use configured provider if available.
  - Auto-detection priority: Brave -> Tavily -> Perplexity -> OpenAI -> SearXNG -> Exa/Jina -> DuckDuckGo (zero-config fallback).
  - Capped parallel execution for multi-query requests, with URL canonicalization and deduplication.

### B. `fetch_content` Tool
Fetches web page content, performs SSRF validation, and routes to specialized extractors.

- **Parameters**:
  - `url` (string, optional): Single URL to fetch.
  - `urls` (string[], optional): Multiple URLs fetched in parallel (up to 5).
  - `mode` (string enum, optional, default `"readable"`): `"readable" | "raw" | "answer"`.
  - `prompt` (string, optional): Local question for `"answer"` mode.
  - `proxy` (string, optional): HTTP/SOCKS proxy URL.

- **SSRF Guard (`security/ssrf.ts`)**:
  - Resolves host DNS before network fetch.
  - Blocks loopback (`127.0.0.0/8`, `::1`), private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local / metadata endpoints (`169.254.0.0/16`, `fe80::/10`), and IPv6 ULA (`fc00::/7`).
  - Validates all HTTP redirect targets before following.

- **Specialized Extractors (`extractors/`)**:
  - `readable.ts`: Strips scripts, ads, and navigations; parses main semantic HTML to Markdown.
  - `github.ts`: Handles GitHub repositories, trees, issues, and PR comments cleanly.
  - `youtube.ts`: Extracts video metadata and timecoded captions/transcripts.
  - `pdf.ts`: Extracts text from PDF documents with page demarcations (`--- Page N ---`).

### C. `get_search_content` Tool
Retrieves stored content or searches for passages in previous search/fetch results without context overflow.

- **Parameters**:
  - `responseId` (string, required): Stored response ID from `web_search` or `fetch_content`.
  - `offset` (number, optional, default `0`): Character offset.
  - `limit` (number, optional, default `10000`, max `30000`): Maximum characters to return.
  - `findText` (string | string[], optional): Text or phrases to locate.
  - `findMode` (string enum, optional, default `"case-insensitive"`): `"case-insensitive" | "exact" | "fuzzy"`.
  - `url` (string, optional): Target URL within multi-fetch result.
  - `query` (string, optional): Target query within multi-query search.

- **Cache & Passage Search Engine (`storage/`)**:
  - In-memory LRU cache storing the last 50 responses with full text and metadata.
  - Match extraction with 200-character context window and match highlighting.

---

## 3. Archimedes TUI Rendering & Styling (`renderer.ts`)

Conforms strictly to `@pi-archimedes/core/tool-render`:
1. **Header Line**: `renderToolHeader(toolName, action, theme)`
   - `toolTitle` in bold blue, action/query in orange `accent`.
2. **Status Line**: `renderStatusLabel(status, label, theme)`
   - Status glyph: `▸` running (muted), `✓` success (green), `✗` error (red).
   - Label: muted, single-line sanitized string (newlines, tabs, and control chars stripped).
3. **Flicker-Free Text Reuse**:
   - Uses `reuseText(context)` pattern to prevent component churn and screen flicker.
4. **Expanded Breakdown**:
   - `web_search`: numbered result items with accent titles, dim URLs, and muted indented snippets.
   - `fetch_content`: status badge, extractor type, word count, and clean content preview.
   - `get_search_content`: matching passage windows with line offsets.

---

## 4. Slash Command (`command.ts`)

Registers `/web` command with pi:
- `/web` / `/web status`: Lists configured search providers, active API keys, default provider, proxy, and memory cache stats.
- `/web clear`: Flushes the in-memory response cache.
- `/web search <query>`: Fast inline search test verifying connectivity.
