/** Parse `500ms`, `30s`, `5m`, `1h`, `7d` or a bare number of minutes. */
export function parseDurationMs(value: string | undefined, fallbackMs: number): number {
  if (!value) {
    return fallbackMs;
  }

  const match = /^(\d+)(ms|s|m|h|d)?$/.exec(value.trim().toLowerCase());
  if (!match) {
    throw new Error(`Invalid duration: ${value}`);
  }

  const amount = Number(match[1]);
  switch (match[2] ?? "m") {
    case "ms":
      return amount;
    case "s":
      return amount * 1000;
    case "h":
      return amount * 60 * 60 * 1000;
    case "d":
      return amount * 24 * 60 * 60 * 1000;
    default:
      return amount * 60 * 1000;
  }
}
