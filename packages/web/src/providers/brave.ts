import { safeFetch } from '../network/fetch.js';
import type { SearchProvider, SearchOptions, WebConfig, SearchResultItem } from './types.js';

export const BraveProvider: SearchProvider = {
  id: 'brave',
  name: 'Brave',
  isAvailable: (config) => !!(config.braveApiKey || process.env.BRAVE_API_KEY),
  search: async (query, options, config) => {
    const apiKey = config.braveApiKey ?? process.env.BRAVE_API_KEY;
    if (!apiKey) throw new Error('Brave API Key not configured');

    const response = await safeFetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${options.numResults ?? 5}`,
      {
        headers: {
          'X-Subscription-Token': apiKey,
          'Accept': 'application/json'
        }
      }
    );

    const data = await response.json();
    return (data.web?.results ?? []).map((r: any) => ({
      url: r.url,
      title: r.title,
      snippet: r.description
    }));
  }
};
