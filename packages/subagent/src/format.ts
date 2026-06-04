import { clampLine } from "@pi-archimedes/core/text";

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return Math.round(n / 1_000) + "k";
  return String(n);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return "0s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return seconds + "s";
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return minutes + "m" + (remaining > 0 ? remaining + "s" : "");
}

export function formatCost(cost: number): string {
  if (cost === 0) return "";
  if (cost < 0.01) return "$" + cost.toFixed(4);
  return "$" + cost.toFixed(2);
}

export function truncLine(text: string, width: number): string {
  return clampLine(text, width);
}
