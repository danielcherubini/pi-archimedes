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

export function loadConfig(): WebConfig {
  const configPath = join(homedir(), '.pi', 'agent', 'settings.json');
  let fileConfig: any = {};
  try {
    const data = readFileSync(configPath, 'utf-8');
    const allSettings = JSON.parse(data);
    fileConfig = allSettings.archimedes?.web || {};
  } catch {
    // Ignore missing config
  }

  return {
    braveApiKey: process.env.BRAVE_API_KEY || fileConfig.braveApiKey,
    tavilyApiKey: process.env.TAVILY_API_KEY || fileConfig.tavilyApiKey,
    openaiApiKey: process.env.OPENAI_API_KEY || fileConfig.openaiApiKey,
    perplexityApiKey: process.env.PERPLEXITY_API_KEY || fileConfig.perplexityApiKey,
    searxngUrl: process.env.SEARXNG_URL || fileConfig.searxngUrl,
    proxy: process.env.HTTP_PROXY || process.env.HTTPS_PROXY || fileConfig.proxy,
  };
}
