import { safeFetch } from '../network/fetch.js';
import type { SearchProvider, SearchOptions, WebConfig, SearchResultItem } from './types.js';

export const OpenAIProvider: SearchProvider = {
  id: 'openai',
  name: 'OpenAI',
  isAvailable: (config) => !!(config.openaiApiKey || process.env.OPENAI_API_KEY),
  search: async (query, options, config) => {
    const apiKey = config.openaiApiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OpenAI API Key not configured');

    const response = await safeFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: `Search for: ${query}` }]
      })
    });
    
    // Simplification for now, assuming standard provider interface expects SearchResultItem[]
    // Note: OpenAI isn't a search provider in the same sense, but here we fulfill the interface
    const data = await response.json();
    return [{
      url: 'https://openai.com',
      title: 'OpenAI Response',
      snippet: data.choices[0]?.message.content ?? ''
    }];
  }
};
