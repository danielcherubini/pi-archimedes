import { Type } from "typebox";

// ── JSON Schema for tool parameters (TypeBox) ──────────────────────────────

export const TaskItem = Type.Object({
  agent: Type.Optional(Type.String({
    description: "Agent name for this task (optional). If omitted, runs config-less.",
  })),
  task: Type.String(),
  model: Type.Optional(Type.String()),
  cwd: Type.Optional(Type.String()),
});

export const SUBAGENT_PARAMS_SCHEMA = Type.Object({
  agent: Type.Optional(Type.String({
    description: "Agent name (optional). If omitted, the subagent runs config-less — parent's current model, all tools, no system-prompt override. Call list_agents to see available agents.",
  })),
  task: Type.Optional(Type.String({
    description: "Task description for the subagent. Required when not using 'tasks' array.",
  })),
  tasks: Type.Optional(Type.Array(TaskItem, {
    description: "Multiple tasks for parallel execution. Required when not using 'task'.",
  })),
  model: Type.Optional(Type.String({
    description: "Model override for the subagent",
  })),
  async: Type.Optional(Type.Boolean({
    description: "Run asynchronously (fire-and-forget)",
  })),
  cwd: Type.Optional(Type.String({
    description: "Working directory for the subagent",
  })),
});
