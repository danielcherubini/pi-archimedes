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
  braveApiKey?: string | undefined;
  tavilyApiKey?: string | undefined;
  openaiApiKey?: string | undefined;
  perplexityApiKey?: string | undefined;
  searxngUrl?: string | undefined;
  proxy?: string | undefined;
}

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

export interface SearchProvider {
  id: string;
  name: string;
  isAvailable(config: WebConfig): boolean | Promise<boolean>;
  search(query: string, options: SearchOptions, config: WebConfig): Promise<SearchResultItem[]>;
}
