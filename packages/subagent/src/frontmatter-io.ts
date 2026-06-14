/**
 * Frontmatter serialization and validation for agent config files.
 */

import type { AgentConfig } from "./agents.js";

/**
 * Regex for valid agentspec names: lowercase alphanumeric + hyphens, 3-50 chars.
 * Alphanumeric start/end. Also allows single-char names.
 */
export const AGENT_NAME_REGEX = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

const SINGLE_CHAR_NAME_REGEX = /^[a-z0-9]$/;

/**
 * Validate an agent name against agentspec format rules.
 * Returns an error message string if invalid, null if valid.
 */
export function validateAgentName(name: string): string | null {
  if (!name || name.length === 0) {
    return "Name is required";
  }
  if (SINGLE_CHAR_NAME_REGEX.test(name)) {
    return null;
  }
  if (AGENT_NAME_REGEX.test(name)) {
    return null;
  }
  return "Name must be 3-50 lowercase alphanumeric characters or hyphens, starting and ending with alphanumeric";
}

function needsYamlQuoting(value: string): boolean {
  if (value === "") return true;
  // Special YAML characters at start
  if (/^["'#\{\[\|>&!*%?@`-]/.test(value)) return true;
  // Contains colon (could be mistaken for mapping)
  if (value.includes(":")) return true;
  // Contains # (inline comment marker) anywhere
  if (value.includes("#")) return true;
  // Contains newline
  if (value.includes("\n")) return true;
  // Leading/trailing whitespace
  if (value !== value.trim()) return true;
  // YAML booleans/nulls
  if (/^(true|false|yes|no|on|off|null|True|False|Yes|No|On|Off|NULL|Null)$/i.test(value)) return true;
  return false;
}

function quoteYamlValue(value: string): string {
  if (!needsYamlQuoting(value)) return value;
  // Escape backslashes and double quotes, wrap in double quotes
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Serialize an AgentConfig back to a valid .md file with frontmatter.
 * Produces output that parseFrontmatter can re-parse faithfully.
 */
export function serializeAgent(config: AgentConfig): string {
  const lines: string[] = ["---"];

  // Required fields
  lines.push(`name: ${quoteYamlValue(config.name)}`);
  lines.push(`description: ${quoteYamlValue(config.description)}`);

  // Optional known fields
  if (config.tools && config.tools.length > 0) {
    lines.push(`tools: ${quoteYamlValue(config.tools.join(", "))}`);
  }
  if (config.model) {
    lines.push(`model: ${quoteYamlValue(config.model)}`);
  }
  if (config.thinking) {
    lines.push(`thinking: ${quoteYamlValue(config.thinking)}`);
  }

  // Extra fields (sorted alphabetically)
  if (config.extraFields) {
    for (const key of Object.keys(config.extraFields).sort()) {
      const value = config.extraFields[key]!;
      if (typeof value === "string") {
        lines.push(`${key}: ${quoteYamlValue(value)}`);
      } else if (Array.isArray(value)) {
        // Serialize array as YAML block sequence
        lines.push(`${key}:`);
        for (const item of value) {
          lines.push(`  - ${quoteYamlValue(String(item))}`);
        }
      } else {
        // Fallback: JSON stringify for objects
        lines.push(`${key}: ${JSON.stringify(value)}`);
      }
    }
  }

  lines.push("---");
  lines.push("");
  lines.push(config.systemPrompt);
  lines.push("");

  return lines.join("\n");
}
