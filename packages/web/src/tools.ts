import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function registerTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description: "Search the web",
    parameters: Type.Object({
      query: Type.String(),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      // Logic for web search
      return {
        content: [{ type: "text", text: `Results for ${params.query}` }],
        details: { summary: `Results for ${params.query}` },
      };
    },
  });

  pi.registerTool({
    name: "fetch_content",
    label: "Fetch Content",
    description: "Fetch web content",
    parameters: Type.Object({
      url: Type.String(),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      // Logic for fetch content
      return {
        content: [{ type: "text", text: `Content from ${params.url}` }],
        details: { content: `Content from ${params.url}` },
      };
    },
  });

  pi.registerTool({
    name: "get_search_content",
    label: "Get Stored Content",
    description: "Get cached search content",
    parameters: Type.Object({
      responseId: Type.String(),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      // Logic for get search content
      return {
        content: [{ type: "text", text: `Stored content for ${params.responseId}` }],
        details: { content: `Stored content for ${params.responseId}` },
      };
    },
  });
}
