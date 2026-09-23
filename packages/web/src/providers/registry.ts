import type { WebConfig, SearchProvider, SearchOptions, SearchResultItem } from './types.js';
import { DuckDuckGoProvider } from './duckduckgo.js';
import { BraveProvider } from './brave.js';
import { TavilyProvider } from './tavily.js';
import { OpenAIProvider } from './openai.js';
import { PerplexityProvider } from './perplexity.js';
import { SearXNGProvider } from './searxng.js';
import pLimit from 'p-limit';

const ALL_PROVIDERS: SearchProvider[] = [
  BraveProvider,
  TavilyProvider,
  PerplexityProvider,
  OpenAIProvider,
  SearXNGProvider,
  DuckDuckGoProvider
];

export const resolveProvider = (requested: string | undefined, config: WebConfig): SearchProvider => {
  if (requested) {
    const provider = ALL_PROVIDERS.find(p => p.id === requested);
    if (provider) return provider;
  }
  
  for (const provider of ALL_PROVIDERS) {
    if (provider.isAvailable(config)) return provider;
  }
  
  return DuckDuckGoProvider;
};

export const executeSearch = async (
  queries: string[],
  options: SearchOptions,
  config: WebConfig
): Promise<{ provider: string; results: SearchResultItem[] }> => {
  if (queries.length === 0) {
    throw new Error('Queries array is empty');
  }

  const provider = resolveProvider(options.provider, config);
  const limit = pLimit(3);
  
  const modifiedQuery = options.domainFilter ? `${queries[0] ?? ''} ${options.domainFilter.map(d => `site:${d}`).join(' ')}` : (queries[0] ?? '');

  const results = await provider.search(modifiedQuery, options, config);
  
  let merged = results;
  
  if (options.domainFilter) {
    merged = merged.filter(r => r.url.includes(options.domainFilter!.join(" ")));
  }

  const unique = Array.from(new Map(merged.map(r => [r.url, r])).values());
  
  return { provider: provider.id, results: unique };
};
