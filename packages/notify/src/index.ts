import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SettingItem } from "@earendil-works/pi-tui";
import { loadConfig, saveConfig } from "@pi-archimedes/core/settings-io";
import { execFile } from "node:child_process";

// ── Config ──────────────────────────────────────────────────────────────────

export interface NotifyConfig {
  enabled: boolean;
  notifyOnAgentEnd: boolean;
  notifyOnQuestion: boolean;
  delayMs: number;
}

export const DEFAULT_NOTIFY_CONFIG: NotifyConfig = {
  enabled: true,
  notifyOnAgentEnd: true,
  notifyOnQuestion: true,
  delayMs: 60_000,
};

const NAMESPACE = "archimedes.notify";

export function loadNotifyConfig(): NotifyConfig {
  return loadConfig(NAMESPACE, DEFAULT_NOTIFY_CONFIG);
}

export function saveNotifyConfig(config: NotifyConfig): void {
  saveConfig(NAMESPACE, config);
}

// ── Terminal detection helpers ──────────────────────────────────────────────

/** Wrap an OSC sequence for tmux passthrough. */
export function wrapForTmux(sequence: string): string {
  if (!process.env.TMUX) {
    return sequence;
  }
  // Escape inner ESC characters so tmux doesn't interpret them
  const escaped = sequence.replace(/\x1b/g, "\x1b\x1b");
  return `\x1bPtmux;${escaped}\x1b\\`;
}

// ── OSC notification dispatchers ────────────────────────────────────────────

/** OSC 777 — generic notify (used as fallback) */
export function notifyOSC777(title: string, body: string): void {
  const seq = `\x1b]777;notify;${title};${body}\x07`;
  process.stderr.write(wrapForTmux(seq));
}

/** OSC 9 — Konsole / generic terminal */
export function notifyOSC9(message: string): void {
  const seq = `\x1b]9;${message}\x07`;
  process.stderr.write(wrapForTmux(seq));
}

/** OSC 99 — Kitty terminal */
export function notifyOSC99(title: string, body: string): void {
  const seq1 = `\x1b]99;i=1:d=0;${title}\x1b\\`;
  const seq2 = `\x1b]99;i=1:p=${body}\x1b\\`;
  process.stderr.write(wrapForTmux(seq1));
  process.stderr.write(wrapForTmux(seq2));
}

/** Windows Terminal — PowerShell toast notification */
export function notifyWindows(title: string, body: string): void {
  const script = windowsToastScript(title, body);
  execFile(
    "powershell.exe",
    ["-NoProfile", "-Command", script],
    { shell: false },
    () => {
      /* ignore */
    },
  );
}

/** Generate a self-contained PowerShell script for toast notifications */
export function windowsToastScript(title: string, body: string): string {
  // Escape single quotes for PowerShell string interpolation
  const escapedTitle = title.replace(/'/g, "''");
  const escapedBody = body.replace(/'/g, "''");

  return [
    "Add-Type -AssemblyName System.Runtime.WindowsRuntime",
    "Add-Type -AssemblyName System.Runtime.InteropServices.WindowsRuntime",
    '$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)',
    '$textNodes = $xml.GetElementsByTagName("text")',
    "$textNodes.Item(0).InnerText = '" + escapedTitle + "'",
    "$textNodes.Item(1).InnerText = '" + escapedBody + "'",
    '$toast = New-Object Windows.UI.Notifications.ToastNotification $xml',
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Pi').Show($toast)",
  ].join(";");
}

// ── Main notify dispatcher ──────────────────────────────────────────────────

/** Dispatch a notification to the appropriate terminal handler. */
export function notify(title: string, body: string): void {
  // 1. Windows Terminal
  if (process.env.WT_SESSION) {
    notifyWindows(title, body);
    return;
  }

  // 2. Kitty
  if (process.env.KITTY_WINDOW_ID) {
    notifyOSC99(title, body);
    return;
  }

  // 3. iTerm2
  if (process.env.TERM_PROGRAM === "iTerm.app" || process.env.ITERM_SESSION_ID) {
    notifyOSC9(body);
    return;
  }

  // 4. Fallback — OSC 777
  notifyOSC777(title, body);
}

// ── Circuit breaker state ───────────────────────────────────────────────────

let notifyTimer: ReturnType<typeof setTimeout> | null = null;
let pendingTrigger: "agent_end" | "ask_request" | null = null;

// ── Circuit breaker logic ───────────────────────────────────────────────────

/** Cancel any pending notification timer. */
export function cancelPending(): void {
  if (notifyTimer) {
    clearTimeout(notifyTimer);
    notifyTimer = null;
  }
  pendingTrigger = null;
}

/** Schedule a delayed notification (circuit breaker). */
export function scheduleNotify(trigger: "agent_end" | "ask_request"): void {
  // Cancel any existing timer first
  cancelPending();

  // Load config fresh on each trigger
  const config = loadNotifyConfig();

  if (!config.enabled) {
    return;
  }

  if (trigger === "agent_end" && !config.notifyOnAgentEnd) {
    return;
  }

  if (trigger === "ask_request" && !config.notifyOnQuestion) {
    return;
  }

  pendingTrigger = trigger;
  notifyTimer = setTimeout(() => {
    fireNotification(pendingTrigger);
    notifyTimer = null;
    pendingTrigger = null;
  }, config.delayMs);

  // Don't block process exit
  notifyTimer.unref();
}

/** Fire the actual notification based on the pending trigger. */
function fireNotification(trigger: "agent_end" | "ask_request" | null): void {
  if (trigger === "agent_end") {
    notify("Pi", "Task complete — waiting for input");
  } else {
    notify("Pi", "A question needs your answer");
  }
}

// ── Registration ────────────────────────────────────────────────────────────

/** Register the notify extension with the Pi agent. */
export function registerNotify(pi: ExtensionAPI): void {
  pi.on("agent_end", () => scheduleNotify("agent_end"));
  pi.on("input", () => cancelPending());
  pi.on("before_agent_start", () => cancelPending());
  pi.on("agent_start", () => cancelPending());

  // Listen for raw terminal keystrokes — cancel on any key press
  let unsubTerminalInput: (() => void) | null = null;
  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    unsubTerminalInput = ctx.ui.onTerminalInput((_data) => {
      cancelPending();
    });
  });

  pi.on("session_shutdown", () => {
    cancelPending();
    unsubTerminalInput?.();
  });
}

// ── Settings UI ─────────────────────────────────────────────────────────────

/** Build settings UI items for the notify package. */
export function getNotifySettingsItems(config: NotifyConfig): SettingItem[] {
  return [
    {
      id: "enabled",
      label: "Notifications",
      description: "Enable desktop notifications",
      currentValue: config.enabled ? "On" : "Off",
      values: ["On", "Off"],
    },
    {
      id: "notifyOnAgentEnd",
      label: "Notify on task complete",
      description: "Notify when agent finishes a task",
      currentValue: config.notifyOnAgentEnd ? "On" : "Off",
      values: ["On", "Off"],
    },
    {
      id: "notifyOnQuestion",
      label: "Notify on question",
      description: "Notify when a question needs your answer",
      currentValue: config.notifyOnQuestion ? "On" : "Off",
      values: ["On", "Off"],
    },
    {
      id: "delayMs",
      label: "Delay before notify",
      description: "Seconds to wait before sending notification",
      currentValue: String(config.delayMs / 1000) + "s",
    },
  ];
}
