import type { WebConfig } from "../config.js";

export type { WebConfig };

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
  provider?: string;
  signal?: AbortSignal | undefined;
}

export interface SearchProvider {
  id: string;
  name: string;
  isAvailable(config: WebConfig): boolean | Promise<boolean>;
  search(query: string, options: SearchOptions, config: WebConfig): Promise<SearchResultItem[]>;
}
