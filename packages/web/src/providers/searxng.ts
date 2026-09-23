import { safeFetch } from '../network/fetch.js';
import type { SearchProvider, SearchOptions, WebConfig, SearchResultItem } from './types.js';

export const SearXNGProvider: SearchProvider = {
  id: 'searxng',
  name: 'SearXNG',
  isAvailable: (config) => !!config.searxngUrl,
  search: async (query, options, config) => {
    if (!config.searxngUrl) throw new Error('SearXNG URL not configured');

    const response = await safeFetch(`${config.searxngUrl}/search?format=json&q=${encodeURIComponent(query)}`, undefined, {
      allowPrivateOrigin: config.searxngUrl
    });

    if (!response.ok) {
      throw new Error(`[searxng] error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return (data.results ?? []).slice(0, options.numResults ?? 5).map((r: any) => ({
      url: r.url,
      title: r.title,
      snippet: r.content ?? r.engine
    }));
  }
};
