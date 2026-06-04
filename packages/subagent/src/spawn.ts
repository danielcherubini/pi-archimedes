import { spawn, type ChildProcess } from "node:child_process";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

export interface SpawnOptions {
  task: string;
  model?: string;
  cwd?: string;
  context?: "fresh" | "fork";
  signal?: AbortSignal;
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
 * Spawn a child `pi` process in JSON mode.
 */
export function spawnSubagent(options: SpawnOptions): ChildProcess {
  const { command } = resolvePiCommand();
  const args: string[] = [
    "--mode", "json",
    "-p", options.task,
  ];

  if (options.model) {
    args.push("--model", options.model);
  }

  if (options.context === "fork") {
    args.push("--context", "fork");
  }

  const child = spawn(command, args, {
    cwd: options.cwd || process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  // Handle abort signal
  if (options.signal) {
    const cleanup = () => {
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
    options.signal.addEventListener("abort", cleanup, { once: true });
  }

  return child;
}
