import { spawn, type ChildProcess } from "node:child_process";
import { execSync } from "node:child_process";
import { existsSync, writeFileSync, unlinkSync, mkdtempSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentConfig } from "./agents.js";

export interface SpawnOptions {
  task: string;
  model: string | undefined;
  cwd: string | undefined;
  signal: AbortSignal | undefined;
  agent: AgentConfig | undefined;
}

/**
 * Resolve the `pi` command — finds it on PATH.
 */
export function resolvePiCommand(): { command: string; args: string[] } {
  let piPath: string;
  try {
    piPath = execSync(process.platform === "win32" ? 'where pi' : 'which pi', {
      encoding: "utf-8",
    }).trim();
  } catch {
    throw new Error("pi command not found on PATH. Is pi installed?");
  }

  // On Windows, the CLI might be a .cmd script
  if (process.platform === "win32" && !piPath.endsWith(".cmd") && !piPath.endsWith(".exe")) {
    const cmdPath = piPath + ".cmd";
    if (existsSync(cmdPath)) {
      return { command: "cmd", args: ["/c", cmdPath] };
    }
  }
  return { command: piPath, args: [] };
}

/**
 * Write system prompt to a temp file for --append-system-prompt.
 */
function writePromptToFile(agentName: string, prompt: string): { dir: string; filePath: string } {
  const safeName = agentName.replace(/[^\w.-]+/g, "_");
  const tmpDir = mkdtempSync(join(tmpdir(), "pi-subagent-"));
  const filePath = join(tmpDir, `prompt-${safeName}.md`);
  writeFileSync(filePath, prompt, { encoding: "utf-8" });
  return { dir: tmpDir, filePath };
}

/**
 * Clean up temp prompt file and directory.
 */
function cleanupTempFiles(dir: string | null, filePath: string | null): void {
  if (filePath) {
    try { unlinkSync(filePath); } catch { /* ignore */ }
  }
  if (dir) {
    try { rmdirSync(dir); } catch { /* ignore */ }
  }
}

/**
 * Spawn a child `pi` process in JSON mode.
 */
export function spawnSubagent(options: SpawnOptions): ChildProcess {
  const { command, args: baseArgs } = resolvePiCommand();
  const args: string[] = [
    ...baseArgs,
    "--mode", "json",
    "-p",
    "--no-session",
  ];

  // Use agent config from frontmatter if available
  if (options.agent) {
    const agent = options.agent;
    // Agent's model takes precedence; tool-call model as fallback
    const modelToUse = agent.model ?? options.model;
    if (modelToUse) {
      args.push("--model", modelToUse);
    }
    if (agent.thinking) {
      args.push("--thinking", agent.thinking);
    }
    if (agent.tools && agent.tools.length > 0) {
      args.push("--tools", agent.tools.join(","));
    }
  } else if (options.model) {
    // Fallback: use model from tool call params (legacy)
    args.push("--model", options.model);
  }

  // Temp files for system prompt
  let tmpDir: string | null = null;
  let tmpPath: string | null = null;

  if (options.agent && options.agent.systemPrompt.trim()) {
    const tmp = writePromptToFile(options.agent.name, options.agent.systemPrompt);
    tmpDir = tmp.dir;
    tmpPath = tmp.filePath;
    args.push("--append-system-prompt", tmpPath);
  }

  args.push(options.task);

  const child = spawn(command, args, {
    cwd: options.cwd || process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  // Handle abort signal
  let abortHandler: (() => void) | undefined;
  if (options.signal) {
    abortHandler = () => {
      if (child.pid && !child.killed) {
        child.kill("SIGTERM");
        const forceKill = setTimeout(() => {
          if (!child.killed) {
            child.kill("SIGKILL");
          }
        }, 3000);
        forceKill.unref();
      }
    };
    options.signal.addEventListener("abort", abortHandler, { once: true });
  }

  // Clean up temp files and listeners on exit
  const exitCleanup = (): void => {
    child.removeListener("exit", exitCleanup);
    child.removeListener("error", exitCleanup);
    if (abortHandler && options.signal) {
      options.signal.removeEventListener("abort", abortHandler);
    }
    cleanupTempFiles(tmpDir, tmpPath);
  };
  child.on("exit", exitCleanup);
  child.on("error", exitCleanup);

  return child;
}
