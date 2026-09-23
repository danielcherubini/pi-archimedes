# @pi-archimedes/web

Web search and content extraction package for the Pi Archimedes agent.

## Tools

- `web_search`: Search the web using configured providers (Brave, Tavily, Perplexity, OpenAI, SearXNG, DuckDuckGo).
- `fetch_content`: Extract readable content from URLs, with specialized handlers for GitHub, YouTube, and PDFs.
- `get_search_content`: Retrieve and optionally search through cached search/fetch results.

## Configuration

Settings are read from `~/.pi/agent/settings.json` under the `archimedes.web` namespace, or via environment variables:

- `braveApiKey` / `BRAVE_API_KEY`
- `tavilyApiKey` / `TAVILY_API_KEY`
- `openaiApiKey` / `OPENAI_API_KEY`
- `perplexityApiKey` / `PERPLEXITY_API_KEY`
- `searxngUrl` / `SEARXNG_URL`
- `proxy` / `HTTP_PROXY` / `HTTPS_PROXY`

## Features

- Multi-provider search routing.
- Cached content retrieval.
- Intelligent content extraction.
- Dynamic TUI rendering.
