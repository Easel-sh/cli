import type { DeploymentStatus, DeploymentTarget, EaselClient } from "@easel-sh/sdk";
import type { GlobalCliOptions } from "../lib/client.js";
import { resolveProjectId } from "../lib/resolve-link.js";
import {
  colorizeStatus,
  formatRelativeTime,
  printJson,
  printTable,
  useColor,
} from "../lib/output.js";

export async function listDeploymentsCommand(
  client: EaselClient,
  options: GlobalCliOptions & {
    project?: string;
    status?: string;
    environment?: DeploymentTarget;
    prod?: boolean;
    limit?: number;
    cursor?: string;
  },
): Promise<void> {
  const projectId = await resolveProjectId(client, options);

  const data = await client.deployments.list({
    project: projectId,
    target: options.environment ?? (options.prod ? "production" : undefined),
    status: options.status
      ?.split(",")
      .map((status) => status.trim().toUpperCase())
      .filter(Boolean) as DeploymentStatus[] | undefined,
    limit: options.limit,
    cursor: options.cursor,
  });

  if (options.format === "json") {
    printJson(data);
    return;
  }

  const color = useColor(options.noColor);
  const rows = data.deployments.map((deployment) => [
    deployment.id.slice(0, 12),
    colorizeStatus(deployment.status, color),
    deployment.target,
    deployment.gitSource?.branch ?? "-",
    formatRelativeTime(deployment.queuedAt),
    deployment.primaryUrl ?? "-",
  ]);

  printTable(["ID", "STATUS", "ENV", "BRANCH", "AGE", "URL"], rows, "No deployments found.");

  if (data.pagination.nextCursor) {
    console.error(
      `\nMore deployments available. Use --cursor ${data.pagination.nextCursor}`,
    );
  }
}
