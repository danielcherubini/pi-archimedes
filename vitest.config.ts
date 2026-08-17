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
      "packages/image-paste",
      "packages/mcp",
    ],
    passWithNoTests: true,
  },
});

// Note: meta is excluded — it is the orchestrator (depends on all packages) and
// has no pure-logic functions to test in isolation.
