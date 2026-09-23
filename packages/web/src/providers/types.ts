import { WebConfig } from "../config.js";

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

export { WebConfig };

export interface SearchProvider {
  id: string;
  name: string;
  isAvailable(config: WebConfig): boolean | Promise<boolean>;
  search(query: string, options: SearchOptions, config: WebConfig): Promise<SearchResultItem[]>;
}
