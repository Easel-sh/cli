import type { OutputFormat } from "./client.js";

const STATUS_COLORS: Record<string, string> = {
  READY: "\x1b[32m",
  ERROR: "\x1b[31m",
  BUILDING: "\x1b[33m",
  QUEUED: "\x1b[36m",
  PROVISIONING: "\x1b[35m",
  ASSIGNING_DOMAINS: "\x1b[33m",
  CANCELLED: "\x1b[90m",
  SKIPPED: "\x1b[90m",
  SUPERSEDED: "\x1b[90m",
  SPUN_DOWN: "\x1b[90m",
};

const RESET = "\x1b[0m";

export function defaultOutputFormat(): OutputFormat {
  return process.stdout.isTTY ? "human" : "json";
}

export function useColor(noColor: boolean): boolean {
  if (noColor || process.env.NO_COLOR) {
    return false;
  }
  return Boolean(process.stdout.isTTY);
}

export function colorizeStatus(status: string, enabled: boolean): string {
  if (!enabled) {
    return status;
  }
  const color = STATUS_COLORS[status] ?? "";
  return `${color}${status}${RESET}`;
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

export function formatRelativeTime(iso: string | null): string {
  if (!iso) {
    return "-";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  const deltaMs = Date.now() - date.getTime();
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

/** `text` without ANSI color codes. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

/** Format rows as aligned columns, measuring width without color codes. */
export function formatTable(headers: string[], rows: string[][]): string[] {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => stripAnsi(row[index] ?? "").length)),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, index) =>
        index === cells.length - 1 ? cell : cell + " ".repeat((widths[index] ?? 0) - stripAnsi(cell).length),
      )
      .join("  ");
  return [line(headers), ...rows.map(line)];
}

/** Print rows as a table, or `emptyMessage` when there are none. */
export function printTable(headers: string[], rows: string[][], emptyMessage: string): void {
  if (rows.length === 0) {
    console.log(emptyMessage);
    return;
  }
  for (const line of formatTable(headers, rows)) console.log(line);
}
