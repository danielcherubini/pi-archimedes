import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.js";
import { executeSearch } from "./providers/registry.js";
import { extractContent } from "./extractors/pipeline.js";
import { storeResponse, getResponse } from "./storage/cache.js";
import { findPassages } from "./storage/find.js";
import {
  renderWebSearchCall, renderWebSearchResult,
  renderFetchContentCall, renderFetchContentResult,
  renderGetSearchContentCall, renderGetSearchContentResult
} from "./renderer.js";

export function registerTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description: "Search the web",
    parameters: Type.Object({
      query: Type.Optional(Type.String()),
      queries: Type.Optional(Type.Array(Type.String())),
      numResults: Type.Optional(Type.Number()),
      recencyFilter: Type.Optional(Type.String()),
      domainFilter: Type.Optional(Type.Array(Type.String())),
      proxy: Type.Optional(Type.String()),
    }),
    renderCall: renderWebSearchCall,
    renderResult: renderWebSearchResult,
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      const config = loadConfig();
      const queries = params.queries ?? (params.query ? [params.query] : []);
      const { provider, results } = await executeSearch(queries, {
        ...(params.numResults !== undefined && { numResults: params.numResults }),
        ...(params.recencyFilter !== undefined && { recencyFilter: params.recencyFilter }),
        ...(params.domainFilter !== undefined && { domainFilter: params.domainFilter }),
        ...(params.proxy !== undefined && { proxy: params.proxy }),
      }, config);
      
      const summary = results.map(r => `[${r.title}](${r.url})`).join('\n');
      const responseId = storeResponse({
        type: "search",
        content: summary,
        metadata: { provider, results },
      });
      
      return { 
        content: [{ type: "text", text: summary }], 
        details: { responseId, provider, resultCount: results.length, results } 
      };
    },
  });

  pi.registerTool({
    name: "fetch_content",
    label: "Fetch Content",
    description: "Fetch web content",
    parameters: Type.Object({
      url: Type.String(),
      mode: Type.Optional(Type.Union([Type.Literal("readable"), Type.Literal("raw"), Type.Literal("answer")])),
      prompt: Type.Optional(Type.String()),
      proxy: Type.Optional(Type.String()),
    }),
    renderCall: renderFetchContentCall,
    renderResult: renderFetchContentResult,
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      const doc = await extractContent(params.url, params.mode ?? "readable", { 
        ...(params.prompt !== undefined && { prompt: params.prompt }),
        ...(params.proxy !== undefined && { proxy: params.proxy })
      });
      const responseId = storeResponse({
        type: "fetch",
        content: doc.markdown,
        metadata: { url: doc.url, title: doc.title, wordCount: doc.wordCount, status: doc.status, extractor: doc.extractor },
      });
      
      return { 
        content: [{ type: "text", text: doc.markdown }], 
        details: { responseId, url: doc.url, title: doc.title, wordCount: doc.wordCount, status: doc.status, extractor: doc.extractor, snippet: doc.markdown.slice(0, 500) } 
      };
    },
  });

  pi.registerTool({
    name: "get_search_content",
    label: "Get Stored Content",
    description: "Get cached search content",
    parameters: Type.Object({
      responseId: Type.String(),
      findText: Type.Optional(Type.String()),
      offset: Type.Optional(Type.Number()),
      limit: Type.Optional(Type.Number()),
    }),
    renderCall: renderGetSearchContentCall,
    renderResult: renderGetSearchContentResult,
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      const item = getResponse(params.responseId);
      if (!item) throw new Error("Response not found");
      
      if (params.findText) {
        const matches = findPassages(item.content, [params.findText]);
        return { content: [{ type: "text", text: JSON.stringify(matches) }], details: { matches } };
      }
      
      const content = item.content.slice(params.offset ?? 0, params.limit ? (params.offset ?? 0) + params.limit : undefined);
      return { content: [{ type: "text", text: content }], details: { content } };
    },
  });
}
