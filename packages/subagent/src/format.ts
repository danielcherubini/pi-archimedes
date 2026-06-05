import { clampLine } from "@pi-archimedes/core/text";

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return Math.round(n / 1_000) + "k";
  return String(n);
}

export function formatDuration(ms: number): string {
  if (ms < 100) return "<0.1s";
  if (ms < 1000) return (ms / 1000).toFixed(1) + "s";
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

export interface StatsData {
  turns: number | undefined;
  toolCount: number | undefined;
  tokens: number | undefined;
  durationMs: number | undefined;
  cost: number | undefined;
}

export interface StatsTheme {
  fg: (token: string, text: string) => string;
}

export function buildStatsLine(
  data: StatsData,
  theme: StatsTheme,
): string {
  const parts: string[] = [];
  const turns = data.turns ?? 0;
  const tools = data.toolCount ?? 0;
  const tokens = data.tokens ?? 0;
  const duration = data.durationMs ?? 0;
  const cost = data.cost ?? 0;

  if (turns > 0) parts.push("⟳ " + turns);
  if (tools > 0) parts.push(tools + " tool" + (tools !== 1 ? "s" : ""));
  if (tokens > 0) parts.push(formatTokens(tokens) + " tok");
  if (duration > 0) parts.push(formatDuration(duration));
  if (cost > 0) parts.push(formatCost(cost));

  return parts.map(p => theme.fg("dim", "· " + p)).join(" ");
}
