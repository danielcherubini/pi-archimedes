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
  
  const modifiedQueries = queries.map(q => 
    options.domainFilter ? `${q} site:${options.domainFilter}` : q
  );

  const allResults = await Promise.all(
    modifiedQueries.map(q => limit(() => provider.search(q, options, config)))
  );
  
  let merged = allResults.flat();
  
  if (options.domainFilter) {
    merged = merged.filter(r => r.url.includes(options.domainFilter!));
  }

  const unique = Array.from(new Map(merged.map(r => [r.url, r])).values());
  
  return { provider: provider.id, results: unique };
};
