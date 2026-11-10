import type { EaselClient, RuntimeLogRecord, RuntimeLogsResponse } from "@easel-sh/sdk";
import type { GlobalCliOptions } from "../lib/client.js";
import { parseDurationMs } from "../lib/duration.js";
import { printJson, useColor } from "../lib/output.js";
import { fetchDeploymentByUrl, parseDeploymentReference } from "../lib/resolve-deployment.js";
import { resolveProjectId } from "../lib/resolve-link.js";

export type LogsCommandOptions = GlobalCliOptions & {
  project?: string;
  deployment?: string;
  reference?: string;
  follow?: boolean;
  expand?: boolean;
  environment?: string;
  statusCode?: string;
  level?: string;
  query?: string;
  requestId?: string;
  since?: string;
  until?: string;
  limit?: number;
  timeout?: string;
};

/** One event recorded while serving a request, such as a function log line. */
interface RequestEvent {
  id: string;
  kind: string;
  ts: string;
  message: string | null;
  level: string | null;
  fields: Record<string, unknown> | null;
}

const FOLLOW_POLL_MS = 10_000;
const DEFAULT_FOLLOW_TIMEOUT_MS = 5 * 60 * 1000;
const RESET = "\x1b[0m";

/**
 * Parse a CLI time bound (`1h`, `30m`, a bare number of minutes, or ISO 8601)
 * into an absolute ISO timestamp. Relative values mean "that long ago" from `now`.
 */
export function parseTimeBound(
  value: string | undefined,
  now = new Date(),
): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  const trimmed = value.trim();
  if (/^\d+(ms|s|m|h|d)?$/i.test(trimmed)) {
    const ms = parseDurationMs(trimmed, 0);
    return new Date(now.getTime() - ms).toISOString();
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid time value: ${value}`);
  }
  return date.toISOString();
}

function buildFilterQuery(options: LogsCommandOptions): string {
  const parts: string[] = [];

  if (options.query?.trim()) {
    parts.push(options.query.trim());
  }
  if (options.environment) {
    parts.push(`environment:${options.environment}`);
  }
  if (options.statusCode) {
    parts.push(`status:${options.statusCode}`);
  }
  if (options.requestId) {
    parts.push(`requestId:${options.requestId}`);
  }

  return parts.join(" ");
}

async function resolveDeploymentId(
  client: EaselClient,
  reference: string | undefined,
  explicitDeployment: string | undefined,
): Promise<string | undefined> {
  const value = explicitDeployment ?? reference;
  if (!value) {
    return undefined;
  }

  const parsed = parseDeploymentReference(value);
  if (parsed.kind === "id") {
    return parsed.value;
  }

  return (await fetchDeploymentByUrl(client, parsed.value)).id;
}

async function fetchRecords(
  client: EaselClient,
  projectId: string,
  deploymentId: string | undefined,
  options: LogsCommandOptions,
  extras?: { after?: string; since?: string; limit?: number },
): Promise<RuntimeLogRecord[]> {
  const data = await client.request<RuntimeLogsResponse>(
    "GET",
    `/v1/projects/${encodeURIComponent(projectId)}/requests`,
    {
      query: {
        deploymentId,
        q: buildFilterQuery(options) || undefined,
        levels: options.level,
        since: extras?.since ?? parseTimeBound(options.since),
        after: extras?.after,
        period:
          extras?.since || extras?.after || options.since ? undefined : "24h",
        limit: extras?.limit ?? options.limit ?? 50,
      },
    },
  );
  return data.records;
}

async function fetchEvents(
  client: EaselClient,
  projectId: string,
  requestId: string,
): Promise<RequestEvent[]> {
  const data = await client.request<{ events: RequestEvent[] }>(
    "GET",
    `/v1/requests/${encodeURIComponent(requestId)}/events`,
    { query: { projectId } },
  );
  return data.events;
}

function colorStatus(status: number | null, enabled: boolean): string {
  const text = status == null ? "-" : String(status);
  if (!enabled || status == null) {
    return text;
  }
  if (status >= 500) return `\x1b[31m${text}${RESET}`;
  if (status >= 400) return `\x1b[33m${text}${RESET}`;
  if (status >= 300) return `\x1b[36m${text}${RESET}`;
  if (status >= 200) return `\x1b[32m${text}${RESET}`;
  return text;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "Z");
}

function formatRequestLine(
  record: RuntimeLogRecord,
  color: boolean,
): string {
  const method = (record.method ?? "-").padEnd(6);
  const status = colorStatus(record.statusCode, color);
  const duration =
    record.durationMs == null ? "-" : `${record.durationMs}ms`;
  const path = record.path ?? "/";
  const line = `${formatTimestamp(record.lastEventAt)}  ${method} ${status}  ${duration}  ${path}  ${record.requestId}`;

  if (record.firstLogMessage) {
    const msg =
      record.firstLogMessage.length > 120
        ? `${record.firstLogMessage.slice(0, 119)}…`
        : record.firstLogMessage;
    return `${line}\n  ${msg}`;
  }
  return line;
}

async function printExpandedLogs(
  client: EaselClient,
  projectId: string,
  record: RuntimeLogRecord,
  color: boolean,
): Promise<void> {
  const method = (record.method ?? "-").padEnd(6);
  const status = colorStatus(record.statusCode, color);
  const duration =
    record.durationMs == null ? "-" : `${record.durationMs}ms`;
  console.log(
    `${formatTimestamp(record.lastEventAt)}  ${method} ${status}  ${duration}  ${record.path ?? "/"}  ${record.requestId}`,
  );

  const events = await fetchEvents(
    client,
    projectId,
    record.requestId,
  );
  for (const log of events.filter((event) => event.kind === "function_log")) {
    const level = (log.level ?? "info").toUpperCase();
    console.log(`  [${level}] ${log.message ?? ""}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function applyUntilFilter(
  records: RuntimeLogRecord[],
  until: string | undefined,
): RuntimeLogRecord[] {
  const untilIso = parseTimeBound(until);
  if (!untilIso) {
    return records;
  }
  const untilMs = new Date(untilIso).getTime();
  return records.filter(
    (record) => new Date(record.lastEventAt).getTime() <= untilMs,
  );
}

export async function logsCommand(
  client: EaselClient,
  options: LogsCommandOptions,
): Promise<void> {
  const projectId = await resolveProjectId(client, options);
  const deploymentId = await resolveDeploymentId(
    client,
    options.reference,
    options.deployment,
  );
  const color = useColor(options.noColor);

  if (options.requestId && !options.follow) {
    const events = await fetchEvents(
      client,
      projectId,
      options.requestId,
    );
    const records = await fetchRecords(
      client,
      projectId,
      deploymentId,
      options,
      {
        limit: 1,
        since: parseTimeBound(options.since) ?? parseTimeBound("7d"),
      },
    );
    const record = records[0];

    if (options.format === "json") {
      printJson({ record: record ?? null, events });
      return;
    }

    if (record) {
      await printExpandedLogs(client, projectId, record, color);
      return;
    }

    for (const event of events.filter((e) => e.kind === "function_log")) {
      console.log(
        `${formatTimestamp(event.ts)}  [${(event.level ?? "info").toUpperCase()}] ${event.message ?? ""}`,
      );
    }
    return;
  }

  if (options.follow) {
    const timeoutMs = parseDurationMs(
      options.timeout,
      DEFAULT_FOLLOW_TIMEOUT_MS,
    );
    const startedAt = Date.now();
    const seen = new Set<string>();

    const initial = await fetchRecords(
      client,
      projectId,
      deploymentId,
      options,
      {
        since: parseTimeBound(options.since) ?? parseTimeBound("30m"),
        limit: options.limit ?? 20,
      },
    );

    const chronological = [...initial].reverse();
    for (const record of chronological) {
      seen.add(record.requestId);
      if (options.format === "json") {
        console.log(JSON.stringify(record));
      } else if (options.expand) {
        await printExpandedLogs(client, projectId, record, color);
      } else {
        console.log(formatRequestLine(record, color));
      }
    }

    let after =
      chronological.at(-1)?.lastEventAt ?? new Date().toISOString();

    while (Date.now() - startedAt < timeoutMs) {
      await sleep(FOLLOW_POLL_MS);
      const newer = await fetchRecords(
        client,
        projectId,
        deploymentId,
        options,
        {
          after,
          limit: options.limit ?? 50,
        },
      );
      const ordered = [...newer].reverse();
      for (const record of ordered) {
        if (seen.has(record.requestId)) {
          continue;
        }
        seen.add(record.requestId);
        if (record.lastEventAt > after) {
          after = record.lastEventAt;
        }
        if (options.format === "json") {
          console.log(JSON.stringify(record));
        } else if (options.expand) {
          await printExpandedLogs(client, projectId, record, color);
        } else {
          console.log(formatRequestLine(record, color));
        }
      }
    }

    if (options.format !== "json") {
      console.error(
        `\nStopped following after ${options.timeout ?? "5m"} (use --timeout to extend).`,
      );
    }
    return;
  }

  const records = applyUntilFilter(
    await fetchRecords(client, projectId, deploymentId, options),
    options.until,
  );

  if (options.format === "json") {
    printJson({ records });
    return;
  }

  if (records.length === 0) {
    console.log("No request logs found.");
    return;
  }

  for (const record of records) {
    if (options.expand) {
      await printExpandedLogs(client, projectId, record, color);
    } else {
      console.log(formatRequestLine(record, color));
    }
  }
}
