import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface WebConfig {
  braveApiKey?: string;
  tavilyApiKey?: string;
  openaiApiKey?: string;
  perplexityApiKey?: string;
  searxngUrl?: string;
  proxy?: string;
}

function isString(val: unknown): val is string {
  return typeof val === 'string';
}

export function loadConfig(): WebConfig {
  const configPath = join(homedir(), '.pi', 'agent', 'settings.json');
  let fileConfig: Record<string, unknown> = {};
  try {
    const data = readFileSync(configPath, 'utf-8');
    const allSettings = JSON.parse(data);
    if (typeof allSettings === 'object' && allSettings !== null && 'archimedes' in allSettings) {
      const archimedes = (allSettings as any).archimedes;
      if (typeof archimedes === 'object' && archimedes !== null && 'web' in archimedes) {
        fileConfig = archimedes.web as Record<string, unknown>;
      }
    }
  } catch {
    // Ignore missing config
  }

  return {
    braveApiKey: isString(process.env.BRAVE_API_KEY) ? process.env.BRAVE_API_KEY : isString(fileConfig.braveApiKey) ? fileConfig.braveApiKey : undefined,
    tavilyApiKey: isString(process.env.TAVILY_API_KEY) ? process.env.TAVILY_API_KEY : isString(fileConfig.tavilyApiKey) ? fileConfig.tavilyApiKey : undefined,
    openaiApiKey: isString(process.env.OPENAI_API_KEY) ? process.env.OPENAI_API_KEY : isString(fileConfig.openaiApiKey) ? fileConfig.openaiApiKey : undefined,
    perplexityApiKey: isString(process.env.PERPLEXITY_API_KEY) ? process.env.PERPLEXITY_API_KEY : isString(fileConfig.perplexityApiKey) ? fileConfig.perplexityApiKey : undefined,
    searxngUrl: isString(process.env.SEARXNG_URL) ? process.env.SEARXNG_URL : isString(fileConfig.searxngUrl) ? fileConfig.searxngUrl : undefined,
    proxy: isString(process.env.HTTP_PROXY) ? process.env.HTTP_PROXY : isString(process.env.HTTPS_PROXY) ? process.env.HTTPS_PROXY : isString(fileConfig.proxy) ? fileConfig.proxy : undefined,
  };
}
