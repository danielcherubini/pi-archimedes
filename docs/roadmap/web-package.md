---
status: committed
done-when: packages/web is registered in meta and monorepo workspace, web_search, fetch_content, and get_search_content tools execute and render with Archimedes styling, /web slash command works, all tests pass, and all packages pass type-checking.
---

# Web Package Implementation Plan

**Goal:** Build `@pi-archimedes/web`, a modular web access extension for Pi delivering web search (`web_search`), content extraction (`fetch_content`), stored content retrieval (`get_search_content`), and a `/web` status slash command, styled natively with Archimedes' 2-line header/status convention.

**Architecture:** A modular package within the pnpm workspace adhering to `@pi-archimedes/core` patterns. Search routing supports pluggable providers with zero-config DuckDuckGo fallback and API-key priority auto-detection. Extraction features SSRF-protected HTTP fetching with manual redirect validation and specialized extractors for HTML readability (via Readability + LinkeDOM + Turndown), GitHub objects, YouTube transcripts, and PDF parsing (via unpdf). Large results are cached in an LRU memory store with passage search capabilities. Rendering uses `@pi-archimedes/core/tool-render` with `reuseText` component recycling.

**Tech Stack:** TypeScript, Node.js 20+ fetch & DNS, `@pi-archimedes/core`, TypeBox, `@mozilla/readability`, `linkedom`, `turndown`, `unpdf`, `p-limit`, Vitest.

---

### Task 1: Package Scaffolding & Monorepo Integration

**Context:**
Create `packages/web/` as a first-class Archimedes workspace package and register it across monorepo infrastructure in strict accordance with `AGENTS.md`.

**Files:**
- Create: `packages/web/package.json`
- Create: `packages/web/tsconfig.json`
- Create: `packages/web/vitest.config.ts`
- Create: `packages/web/src/index.ts`
- Modify: `meta/package.json`
- Modify: `meta/src/plugins.ts`
- Modify: `meta/src/index.ts`
- Modify: `AGENTS.md`
- Modify: `.github/workflows/release.yml`

**What to implement:**
- `packages/web/package.json`:
  - Read shared monorepo version from `meta/package.json` (currently `2.8.0`).
  - Name: `"@pi-archimedes/web"`, `"type": "module"`, `"keywords": ["pi-package"]`, `"files": ["src"]`.
  - Main/Exports: `"main": "./src/index.ts"`, `"exports": { ".": "./src/index.ts" }`, `"pi": { "extensions": ["./src/index.ts"] }`.
  - Dependencies:
    - `"@pi-archimedes/core": "workspace:*"`
    - `"@mozilla/readability": "^0.6.0"`
    - `"linkedom": "^0.18.9"`
    - `"turndown": "^7.2.0"`
    - `"unpdf": "^0.13.0"`
    - `"p-limit": "^6.2.0"`
  - PeerDependencies:
    - `"@earendil-works/pi-coding-agent": ">=0.1.0"`
    - `"@earendil-works/pi-tui": ">=0.1.0"`
    - `"typebox": ">=1.1.0"`
  - DevDependencies (matching `packages/mcp/package.json`):
    - `"@earendil-works/pi-coding-agent": "^0.87.0"`
    - `"@earendil-works/pi-tui": "^0.87.0"`
    - `"@types/node": "^22.0.0"`
    - `"@types/turndown": "^5.0.5"`
    - `"typebox": "^1.1.38"`
    - `"typescript": "^6.0.3"`
- `packages/web/tsconfig.json`: mirror `packages/mcp/tsconfig.json`. Note strict workspace flags: `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` (always use `import type`).
- `packages/web/vitest.config.ts`: mirror `packages/mcp/vitest.config.ts`.
- `packages/web/src/index.ts`: export named `registerWeb(pi: ExtensionAPI)` and default export `register(pi: ExtensionAPI)`.
- `meta/package.json`: add `"@pi-archimedes/web": "workspace:*"` to `dependencies`.
- `meta/src/plugins.ts`: add `web` entry to `PLUGINS` manifest:
  ```ts
  {
    id: "web",
    label: "Web",
    description: "Web search and content fetching with multi-provider routing",
    namespace: "archimedes.web",
    load: () => import("@pi-archimedes/web"),
  }
  ```
- `meta/src/index.ts`: in the lazy-load `session_start` handler alongside `mcpMod`:
  - In `Promise.all([...])`:
    ```ts
    isPluginEnabled("web")
      ? import("@pi-archimedes/web").catch((e) => {
          console.error("[archimedes] web load failed:", e);
          return null;
        })
      : Promise.resolve(null),
    ```
  - After loading: `if (webMod) webMod.registerWeb(pi);`
- `AGENTS.md`:
  - Add `- packages/web — web search and content fetching with multi-provider routing (depends on core)` to Monorepo Structure.
  - Bump "Bump all 13 package versions" to 14 and append `packages/web`.
  - Bump "run `npx tsc --noEmit` in each of the 12 package directories (11 components + session-name)" to 13.
  - Insert `web` into the publish-order line: `... subagent → mcp → web → meta`.
- `.github/workflows/release.yml`:
  - Insert `pnpm --filter "@pi-archimedes/web" publish --access public --no-git-checks --provenance` immediately after `@pi-archimedes/mcp` and before `pnpm --filter "pi-archimedes"`.

**Steps:**
- [ ] Create `packages/web/package.json`, `packages/web/tsconfig.json`, and `packages/web/vitest.config.ts`
- [ ] Create stub `packages/web/src/index.ts` with `registerWeb` and `default` exports
- [ ] Update `meta/package.json`, `meta/src/plugins.ts`, and `meta/src/index.ts`
- [ ] Update `AGENTS.md` and `.github/workflows/release.yml`
- [ ] Run `pnpm install`
  - Did pnpm install workspace links and dependencies cleanly?
- [ ] Run `npx tsc --noEmit` in `packages/web`
  - Did TypeScript compilation pass?
- [ ] Run `npx tsc --noEmit` in `meta`
  - Did TypeScript compilation pass?
- [ ] Commit with message: "chore(web): scaffold @pi-archimedes/web package and integrate with monorepo"

**Acceptance criteria:**
- [ ] `packages/web` is installed and recognized across the workspace
- [ ] `meta` compiles with lazy-loaded `@pi-archimedes/web`
- [ ] All AGENTS.md counts and release workflow entries match exactly

---

### Task 2: Security & Network Utilities (SSRF Guard & Safe Fetch)

**Context:**
All outbound requests from `fetch_content` and search providers must be secured against SSRF attacks and DNS rebinding, with support for proxy configuration. Because Node's native `fetch` does not offer redirect hooks, `safeFetch` uses `redirect: "manual"` and a loop to validate each hop.

**Files:**
- Create: `packages/web/src/security/ssrf.ts`
- Create: `packages/web/src/network/fetch.ts`
- Create: `packages/web/src/config.ts`
- Test: `packages/web/src/security/ssrf.test.ts`
- Test: `packages/web/src/network/fetch.test.ts`

**What to implement:**
- `packages/web/src/config.ts`: Define `WebConfig` interface, default settings, and loader reading from `~/.pi/agent/settings.json` (`archimedes.web` namespace) and environment variables (`BRAVE_API_KEY`, `TAVILY_API_KEY`, `OPENAI_API_KEY`, `PERPLEXITY_API_KEY`, `SEARXNG_URL`, `HTTP_PROXY`, `HTTPS_PROXY`). Honor `exactOptionalPropertyTypes`. Proxy precedence rule: per-call `proxy` option overrides `config.proxy`, which overrides `HTTPS_PROXY`/`HTTP_PROXY`; empty string forces direct access.
- `packages/web/src/security/ssrf.ts`:
  - `isPrivateIp(ip: string): boolean`: checks IPv4 and IPv6 addresses against loopback (`127.0.0.0/8`, `::1`), private networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local / cloud metadata (`169.254.0.0/16`, `fe80::/10`), and IPv6 ULA (`fc00::/7`).
  - `assertSafeUrl(urlString: string): Promise<void>`: parses URL, resolves hostname via `dns.promises.lookup(hostname, { all: true })`, and throws `Error("SSRF protection: access to private network address blocked")` if any resolved IP is private.
- `packages/web/src/network/fetch.ts`:
  - `safeFetch(url: string, init?: RequestInit, options?: { proxy?: string; maxRedirects?: number }): Promise<Response>`:
    - Validates starting URL with `assertSafeUrl(url)`.
    - Uses `redirect: "manual"` to intercept redirects up to `maxRedirects ?? 5`.
    - For 3xx responses, reads `Location` header, resolves relative URLs against current URL, validates target with `assertSafeUrl`, and continues the fetch loop.
    - Supports proxy agent when proxy is configured.

**Steps:**
- [ ] Write unit tests for SSRF guard in `packages/web/src/security/ssrf.test.ts` covering IPv4, IPv6, localhost, cloud metadata, and public IPs.
- [ ] Implement `packages/web/src/security/ssrf.ts`
- [ ] Implement `packages/web/src/config.ts` and `packages/web/src/network/fetch.ts`
- [ ] Write unit tests for `safeFetch` in `packages/web/src/network/fetch.test.ts` covering redirect hop validation and private target interception.
- [ ] Run `npx vitest run packages/web/src/security/ssrf.test.ts packages/web/src/network/fetch.test.ts`
  - Did all tests pass?
- [ ] Run `npx tsc --noEmit` in `packages/web`
  - Did TypeScript compilation pass?
- [ ] Commit with message: "feat(web): implement SSRF protection and safe network fetch client"

**Acceptance criteria:**
- [ ] Private IP addresses, localhost, and metadata endpoints are blocked with clear errors
- [ ] Redirect hops to private networks are intercepted and blocked
- [ ] Valid public URLs pass safely through validation

---

### Task 3: Multi-Provider Web Search Engine

**Context:**
`web_search` supports querying via multiple search providers. A unified interface allows pluggable providers with automated resolution, priority detection, and fallback to DuckDuckGo when no API keys are configured.

**Files:**
- Create: `packages/web/src/providers/types.ts`
- Create: `packages/web/src/providers/duckduckgo.ts`
- Create: `packages/web/src/providers/brave.ts`
- Create: `packages/web/src/providers/tavily.ts`
- Create: `packages/web/src/providers/openai.ts`
- Create: `packages/web/src/providers/perplexity.ts`
- Create: `packages/web/src/providers/searxng.ts`
- Create: `packages/web/src/providers/registry.ts`
- Test: `packages/web/src/providers/registry.test.ts`
- Test: `packages/web/src/providers/duckduckgo.test.ts`

**What to implement:**
- `packages/web/src/providers/types.ts`: Define `SearchResultItem`, `SearchOptions`, and `SearchProvider` interface. Use `import type` for type-only imports.
- Provider implementations:
  - `duckduckgo.ts`: Zero-config HTML/Lite endpoint parser returning title, url, snippet.
  - `brave.ts`: Brave Search API integration with `BRAVE_API_KEY`.
  - `tavily.ts`: Tavily Search API integration with `TAVILY_API_KEY`.
  - `openai.ts`: OpenAI Search API integration with `OPENAI_API_KEY`.
  - `perplexity.ts`: Perplexity API integration with `PERPLEXITY_API_KEY`.
  - `searxng.ts`: Self-hosted SearXNG JSON API endpoint with `SEARXNG_URL`.
- `packages/web/src/providers/registry.ts`:
  - `resolveProvider(requested?: string, config?: WebConfig): SearchProvider`: resolves active provider according to priority (explicit override -> configured setting -> Brave -> Tavily -> Perplexity -> OpenAI -> SearXNG -> DuckDuckGo fallback).
  - `executeSearch(queries: string[], options: SearchOptions, config: WebConfig): Promise<{ provider: string; results: SearchResultItem[] }>`: runs up to 3 queries concurrently via `p-limit(3)`, merges and deduplicates results by canonical URL.

**Steps:**
- [ ] Write unit tests for provider resolution and multi-query deduplication in `packages/web/src/providers/registry.test.ts`
- [ ] Write unit tests for DuckDuckGo parser in `packages/web/src/providers/duckduckgo.test.ts`
- [ ] Implement `packages/web/src/providers/types.ts` and `packages/web/src/providers/registry.ts`
- [ ] Implement providers (`duckduckgo.ts`, `brave.ts`, `tavily.ts`, `openai.ts`, `perplexity.ts`, `searxng.ts`)
- [ ] Run `npx vitest run packages/web/src/providers/`
  - Did all tests pass?
- [ ] Run `npx tsc --noEmit` in `packages/web`
  - Did TypeScript compilation pass?
- [ ] Commit with message: "feat(web): implement multi-provider search engine with auto-detection"

**Acceptance criteria:**
- [ ] Provider auto-detection correctly selects available provider by priority
- [ ] DuckDuckGo functions without any API keys as default fallback
- [ ] Multi-query searches run concurrently and deduplicate identical result URLs

---

### Task 4: Content Extractors Pipeline (Readable HTML, GitHub, YouTube, PDF)

**Context:**
`fetch_content` fetches URLs and extracts structured, human-readable text. It routes requests based on URL patterns and content types to dedicated extractors.

**Files:**
- Create: `packages/web/src/extractors/types.ts`
- Create: `packages/web/src/extractors/readable.ts`
- Create: `packages/web/src/extractors/github.ts`
- Create: `packages/web/src/extractors/youtube.ts`
- Create: `packages/web/src/extractors/pdf.ts`
- Create: `packages/web/src/extractors/pipeline.ts`
- Test: `packages/web/src/extractors/readable.test.ts`
- Test: `packages/web/src/extractors/github.test.ts`
- Test: `packages/web/src/extractors/pipeline.test.ts`

**What to implement:**
- `packages/web/src/extractors/types.ts`: Define `ExtractedDoc { title: string; url: string; markdown: string; wordCount: number; status: number; extractor: string }`.
- `packages/web/src/extractors/readable.ts`: Uses `linkedom` DOM parser, `@mozilla/readability` to extract semantic article body, and `turndown` to convert HTML to clean Markdown.
- `packages/web/src/extractors/github.ts`: Detects GitHub URLs (`github.com/owner/repo`, issues, PRs, files, tree), uses public GitHub raw/API endpoints to extract discussions, metadata, and file content cleanly.
- `packages/web/src/extractors/youtube.ts`: Detects YouTube links, extracts video title, channel, description, and timed captions/transcripts.
- `packages/web/src/extractors/pdf.ts`: Uses `unpdf` to extract text from PDF responses and annotate page divisions (`--- Page N ---`).
- `packages/web/src/extractors/pipeline.ts`:
  - `extractContent(url: string, mode: "readable" | "raw" | "answer", options?: { prompt?: string; proxy?: string }): Promise<ExtractedDoc>`
  - Dispatches to appropriate extractor, enforces maximum character bounds, and formats output.

**Steps:**
- [ ] Write unit tests for HTML readable extraction in `packages/web/src/extractors/readable.test.ts`
- [ ] Write unit tests for GitHub URL parsing and formatting in `packages/web/src/extractors/github.test.ts`
- [ ] Write unit tests for pipeline routing in `packages/web/src/extractors/pipeline.test.ts`
- [ ] Implement extractors and pipeline
- [ ] Run `npx vitest run packages/web/src/extractors/`
  - Did all tests pass?
- [ ] Run `npx tsc --noEmit` in `packages/web`
  - Did TypeScript compilation pass?
- [ ] Commit with message: "feat(web): implement content extraction pipeline for HTML, GitHub, YouTube, and PDF"

**Acceptance criteria:**
- [ ] HTML pages are cleaned into readable markdown using Readability and Turndown
- [ ] GitHub issues, PRs, and files are detected and extracted cleanly
- [ ] Content extraction routes safely through SSRF-protected fetch

---

### Task 5: Stored Content Cache & Passage Search Engine

**Context:**
To prevent context window bloat, large search results and fetched documents are stored in an LRU memory cache with a unique `responseId`. The `get_search_content` tool allows querying offsets, character limits, or targeted search terms (`findText`).

**Files:**
- Create: `packages/web/src/storage/cache.ts`
- Create: `packages/web/src/storage/find.ts`
- Test: `packages/web/src/storage/cache.test.ts`
- Test: `packages/web/src/storage/find.test.ts`

**What to implement:**
- `packages/web/src/storage/cache.ts`:
  - `storeResponse(data: StoredItem): string`: stores item, returns generated `responseId` (e.g. `web_...`). Evicts oldest items if cache exceeds 50 items.
  - `getResponse(responseId: string): StoredItem | undefined`
  - `clearCache(): void`
  - `getCacheStats(): { count: number; estimatedBytes: number }`
- `packages/web/src/storage/find.ts`:
  - `findPassages(text: string, queries: string[], options: { mode: "case-insensitive" | "exact" | "fuzzy"; windowChars?: number }): PassageResult[]`: extracts matching excerpts with context windows and character offsets.

**Steps:**
- [ ] Write unit tests for cache LRU retention, eviction, and stats in `packages/web/src/storage/cache.test.ts`
- [ ] Write unit tests for passage finding and window extraction in `packages/web/src/storage/find.test.ts`
- [ ] Implement `packages/web/src/storage/cache.ts` and `packages/web/src/storage/find.ts`
- [ ] Run `npx vitest run packages/web/src/storage/`
  - Did all tests pass?
- [ ] Run `npx tsc --noEmit` in `packages/web`
  - Did TypeScript compilation pass?
- [ ] Commit with message: "feat(web): implement response cache and passage search engine"

**Acceptance criteria:**
- [ ] Responses are stored and retrievable by `responseId`
- [ ] Passage search extracts matching context windows with offsets accurately
- [ ] LRU cache bounds memory usage and supports clearing

---

### Task 6: Archimedes TUI Renderer

**Context:**
All tool calls and results must render using Archimedes' polished visual style matching `packages/ask` and `packages/mcp`, using helpers from `@pi-archimedes/core/tool-render` (`renderToolHeader`, `renderStatusLabel`) and flicker-free component reuse (`reuseText`). Renderers must never throw.

**Files:**
- Create: `packages/web/src/renderer.ts`
- Test: `packages/web/src/renderer.test.ts`

**What to implement:**
- `packages/web/src/renderer.ts`:
  - Import `Text` from `@earendil-works/pi-tui`.
  - Import type `{ Theme }` from `@earendil-works/pi-coding-agent` (using `import type` for verbatimModuleSyntax).
  - Import `renderToolHeader`, `renderStatusLabel` from `@pi-archimedes/core/tool-render`.
  - `reuseText(context?: unknown): Text`:
    ```ts
    return (context && typeof context === "object" && "lastComponent" in context && (context as { lastComponent?: unknown }).lastComponent instanceof Text
      ? (context as { lastComponent: Text }).lastComponent
      : new Text("", 0, 0));
    ```
  - `sanitizeStatus(text: string): string`: strips newlines, tabs, and control characters to produce a clean single-line status row.
  - Wrap all rendering logic in try/catch blocks so renderers never throw.
  - `renderWebSearchCall(args: unknown, theme: Theme, context?: unknown): Text`: renders header with `renderToolHeader("web_search", query, theme)`.
  - `renderWebSearchResult(result: unknown, options: RenderOptions, theme: Theme, context?: unknown): Text`:
    - Collapsed: `renderStatusLabel("running" | "success" | "error", label, theme)`. Label examples: `5 results (brave)`, `querying duckduckgo...`, `rate limit exceeded`.
    - Expanded: formatted cards for each search result with accent title, dim URL, and indented muted snippet.
  - `renderFetchContentCall(args: unknown, theme: Theme, context?: unknown): Text`: renders header with `renderToolHeader("fetch_content", url, theme)`.
  - `renderFetchContentResult(result: unknown, options: RenderOptions, theme: Theme, context?: unknown): Text`:
    - Collapsed: `renderStatusLabel("running" | "success" | "error", label, theme)`. Label examples: `200 OK — Page Title (1,240 words)`.
    - Expanded: metadata badge, HTTP status, and formatted content preview.
  - `renderGetSearchContentCall(args: unknown, theme: Theme, context?: unknown): Text`: renders header with `renderToolHeader("get_search_content", action, theme)`.
  - `renderGetSearchContentResult(result: unknown, options: RenderOptions, theme: Theme, context?: unknown): Text`:
    - Collapsed: `renderStatusLabel("running" | "success" | "error", label, theme)`.
    - Expanded: matched passages highlighted with line/character offsets.

**Steps:**
- [ ] Write unit tests in `packages/web/src/renderer.test.ts` verifying:
  - Header line uses `renderToolHeader` with `toolTitle` bold and orange `accent` action
  - Collapsed status line uses `renderStatusLabel` with proper status glyphs (`▸`, `✓`, `✗`)
  - Status labels are sanitized against newlines and control characters
  - Expanded view renders structured items
  - `reuseText` recycles existing `Text` component without re-allocation
  - Exception resilience: returns fallback text on malformed input without throwing
- [ ] Implement `packages/web/src/renderer.ts`
- [ ] Run `npx vitest run packages/web/src/renderer.test.ts`
  - Did all tests pass?
- [ ] Run `npx tsc --noEmit` in `packages/web`
  - Did TypeScript compilation pass?
- [ ] Commit with message: "feat(web): implement Archimedes 2-line TUI renderer for web tools"

**Acceptance criteria:**
- [ ] Visual styling conforms exactly to Archimedes design conventions (`toolTitle` blue bold, `accent` orange action, muted labels)
- [ ] Collapsed rows are sanitized single lines with status glyphs
- [ ] Component reuse prevents rendering flicker and renderers never throw

---

### Task 7: Tool Registrations, Slash Command & Full Suite Verification

**Context:**
Wire all components together in `packages/web/src/tools.ts`, `packages/web/src/command.ts`, and `packages/web/src/index.ts`. Register tools with Pi, implement the `/web` slash command, and verify the entire monorepo workspace.

**Files:**
- Create: `packages/web/src/tools.ts`
- Create: `packages/web/src/command.ts`
- Modify: `packages/web/src/index.ts`
- Test: `packages/web/src/tools.test.ts`
- Test: `packages/web/src/command.test.ts`
- Modify: `README.md`

**What to implement:**
- `packages/web/src/tools.ts`:
  - Registers `web_search`, `fetch_content`, and `get_search_content` using TypeBox schemas (`import { Type } from "typebox"`).
  - Attaches custom `renderCall` and `renderResult` hooks from `renderer.ts`.
- `packages/web/src/command.ts`:
  - Registers `/web` slash command with subcommands: `status`, `clear`, `search <query>`.
  - Displays provider status table, configured keys, active cache count/size, and test query execution.
- `packages/web/src/index.ts`:
  - Extension entry point: export `registerWeb(pi: ExtensionAPI)` and default export `register(pi: ExtensionAPI)`.
  - Registers tools, `/web` command, and session cleanup handlers.
- `README.md`:
  - Add `pi install npm:@pi-archimedes/web` to the "install selectively" code block.
  - Add `| **Web** | [\`@pi-archimedes/web\`](packages/web/README.md) | Web search, content fetching, and stored-content retrieval with multi-provider routing |` to the 3-column Components table (`Component | npm package | What it adds`).
  - Add `packages/web/` to the monorepo directory tree.
  - Add `## Web Access` feature section summarizing capabilities and tools.

**Steps:**
- [ ] Write unit tests for tool registrations and handlers in `packages/web/src/tools.test.ts`
- [ ] Write unit tests for slash command handler in `packages/web/src/command.test.ts`
- [ ] Implement `tools.ts`, `command.ts`, and wire into `index.ts`
- [ ] Update `README.md` (selective install line, table row, directory tree, feature section)
- [ ] Run `npx vitest run` across all tests in `packages/web`
  - Did all unit tests pass?
- [ ] Run `npx tsc --noEmit` across all workspace packages:
  - `packages/core`
  - `packages/ui`
  - `packages/sudo`
  - `packages/ask`
  - `packages/footer`
  - `packages/diff`
  - `packages/image-paste`
  - `packages/notify`
  - `packages/subagent`
  - `packages/todo`
  - `packages/session-name`
  - `packages/mcp`
  - `packages/web`
  - `meta`
- [ ] Commit with message: "feat(web): wire tools, slash command, and documentation"

**Acceptance criteria:**
- [ ] `web_search`, `fetch_content`, and `get_search_content` are registered and callable
- [ ] `/web` command reports provider availability and allows clearing cache
- [ ] All 14 packages pass `tsc --noEmit` cleanly
- [ ] README accurately documents package and settings
