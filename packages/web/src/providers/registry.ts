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
  
  // Custom logic: skip OpenAI in auto-detection unless explicitly requested or configured
  const autoDetectOrder = ALL_PROVIDERS.filter(p => p.id !== 'openai');
  
  if (config.defaultProvider === 'openai') {
    const provider = ALL_PROVIDERS.find(p => p.id === 'openai');
    if (provider && provider.isAvailable(config)) return provider;
  }

  for (const provider of autoDetectOrder) {
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
  
  const results = await Promise.all(queries.map(q => limit(async () => provider.search(q, options, config))));
  let merged = results.flat();

  
  if (options.domainFilter && options.domainFilter.length > 0) {
    merged = merged.filter((r) => {
      try {
        const h = new URL(r.url).hostname;
        return options.domainFilter!.some((d) => h === d || h.endsWith('.' + d));
      } catch {
        return false;
      }
    });
  }

  const unique = Array.from(new Map(merged.map(r => [r.url, r])).values());
  
  return { provider: provider.id, results: unique };
};
