export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
}

export interface SearchOptions {
  numResults?: number;
  recencyFilter?: string;
  domainFilter?: string[];
  proxy?: string;
}

export interface WebConfig {
  braveApiKey?: string;
  tavilyApiKey?: string;
  openaiApiKey?: string;
  perplexityApiKey?: string;
  searxngUrl?: string;
}

export interface SearchProvider {
  id: string;
  name: string;
  isAvailable(config: WebConfig): boolean | Promise<boolean>;
  search(query: string, options: SearchOptions, config: WebConfig): Promise<SearchResultItem[]>;
}
