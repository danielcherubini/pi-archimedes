import { safeFetch } from '../network/fetch.js';
import type { SearchProvider, SearchOptions, WebConfig, SearchResultItem } from './types.js';

export const TavilyProvider: SearchProvider = {
  id: 'tavily',
  name: 'Tavily',
  isAvailable: (config) => !!(config.tavilyApiKey || process.env.TAVILY_API_KEY),
  search: async (query, options, config) => {
    const apiKey = config.tavilyApiKey ?? process.env.TAVILY_API_KEY;
    if (!apiKey) throw new Error('Tavily API Key not configured');

    const response = await safeFetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: options.numResults ?? 5,
      }),
    });

    if (!response.ok) {
      throw new Error(`[tavily] error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return (data.results ?? []).map((r: any) => ({
      url: r.url,
      title: r.title,
      snippet: r.content
    }));
  }
};
