import { loadConfig as loadSettings } from "@pi-archimedes/core/settings-io";

export interface WebConfig {
  braveApiKey?: string;
  tavilyApiKey?: string;
  openaiApiKey?: string;
  perplexityApiKey?: string;
  searxngUrl?: string;
  proxy?: string;
  defaultProvider?: string;
}

export function loadConfig(): WebConfig {
  const fileConfig = loadSettings("archimedes.web", {}) as Record<string, any>;
  
  return {
    braveApiKey: process.env.BRAVE_API_KEY || fileConfig.braveApiKey,
    tavilyApiKey: process.env.TAVILY_API_KEY || fileConfig.tavilyApiKey,
    openaiApiKey: process.env.OPENAI_API_KEY || fileConfig.openaiApiKey,
    perplexityApiKey: process.env.PERPLEXITY_API_KEY || fileConfig.perplexityApiKey,
    searxngUrl: process.env.SEARXNG_URL || fileConfig.searxngUrl,
    proxy: process.env.HTTP_PROXY || process.env.HTTPS_PROXY || fileConfig.proxy,
    defaultProvider: fileConfig.defaultProvider,
  };
}