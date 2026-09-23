import { safeFetch } from '../network/fetch.js';
import type { SearchProvider, SearchOptions, WebConfig, SearchResultItem } from './types.js';

export const PerplexityProvider: SearchProvider = {
  id: 'perplexity',
  name: 'Perplexity',
  isAvailable: (config) => !!(config.perplexityApiKey || process.env.PERPLEXITY_API_KEY),
  search: async (query, options, config) => {
    const apiKey = config.perplexityApiKey ?? process.env.PERPLEXITY_API_KEY;
    if (!apiKey) throw new Error('Perplexity API Key not configured');

    const response = await safeFetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-sonar-small-128k-online',
        messages: [{ role: 'user', content: query }]
      })
    });
    
    const data = await response.json();
    return [{
      url: 'https://perplexity.ai',
      title: 'Perplexity Response',
      snippet: data.choices[0]?.message.content ?? ''
    }];
  }
};
