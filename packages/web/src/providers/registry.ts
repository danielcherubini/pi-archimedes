import type { WebConfig, SearchProvider, SearchOptions, SearchResultItem } from './types.js';
import { DuckDuckGoProvider } from './duckduckgo';
import { BraveProvider } from './brave';
import { TavilyProvider } from './tavily';
import { OpenAIProvider } from './openai';
import { PerplexityProvider } from './perplexity';
import { SearXNGProvider } from './searxng';
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
  const provider = resolveProvider(undefined, config);
  const limit = pLimit(3);
  
  const allResults = await Promise.all(
    queries.map(q => limit(() => provider.search(q, options, config)))
  );
  
  const merged = allResults.flat();
  const unique = Array.from(new Map(merged.map(r => [r.url, r])).values());
  
  return { provider: provider.id, results: unique };
};
