import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/core",
      "packages/diff",
      "packages/footer",
      "packages/subagent",
      "packages/todo",
      "packages/notify",
      "packages/ask",
      "packages/sudo",
      "packages/session-name",
      "packages/image-paste",
      "packages/mcp",
      "packages/ui",
      "meta",
    ],
    passWithNoTests: true,
  },
});

// Note: meta is the orchestrator (depends on all packages).
