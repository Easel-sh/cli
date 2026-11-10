import {
  DeploymentWaitTimeoutError,
  type Deployment,
  type EaselClient,
} from "@easel-sh/sdk";
import type { GlobalCliOptions } from "../lib/client.js";
import { parseDurationMs } from "../lib/duration.js";
import { fetchDeploymentByUrl, parseDeploymentReference } from "../lib/resolve-deployment.js";
import { printJson, useColor } from "../lib/output.js";

async function fetchDeployment(
  client: EaselClient,
  reference: string,
): Promise<Deployment> {
  const parsed = parseDeploymentReference(reference);
  return parsed.kind === "id"
    ? client.deployments.get(parsed.value)
    : fetchDeploymentByUrl(client, parsed.value);
}

function printHumanDeployment(deployment: Deployment, color: boolean): void {
  const heading = (label: string) =>
    color ? `\x1b[1m${label}\x1b[0m` : label;

  console.log(heading("Deployment"));
  console.log(`  ID:       ${deployment.id}`);
  console.log(`  Project:  ${deployment.projectId}`);
  console.log(`  Status:   ${deployment.status}`);
  console.log(`  Target:   ${deployment.target}`);
  console.log(`  Source:   ${deployment.source}`);

  if (deployment.primaryUrl) {
    console.log(`  URL:      ${deployment.primaryUrl}`);
  }

  if (deployment.gitSource) {
    console.log(heading("Git"));
    if (deployment.gitSource.repository) {
      console.log(`  Repository: ${deployment.gitSource.repository}`);
    }
    if (deployment.gitSource.branch) {
      console.log(`  Branch:     ${deployment.gitSource.branch}`);
    }
    if (deployment.gitSource.commitHash) {
      console.log(`  Commit:     ${deployment.gitSource.commitHash}`);
    }
    if (deployment.gitSource.commitMessage) {
      console.log(`  Message:    ${deployment.gitSource.commitMessage}`);
    }
    if (deployment.gitSource.pusher) {
      console.log(`  Pusher:     ${deployment.gitSource.pusher}`);
    }
  }

  if (deployment.aliases.length > 0) {
    console.log(heading("Aliases"));
    for (const alias of deployment.aliases) {
      console.log(`  ${alias.url}`);
    }
  }

  console.log(heading("Timestamps"));
  console.log(`  Queued:    ${deployment.queuedAt ?? "-"}`);
  console.log(`  Building:  ${deployment.buildingAt ?? "-"}`);
  console.log(`  Ready:     ${deployment.readyAt ?? "-"}`);
  console.log(`  Error:     ${deployment.errorAt ?? "-"}`);
  console.log(`  Cancelled: ${deployment.cancelledAt ?? "-"}`);
}

async function printLogs(
  client: EaselClient,
  deploymentId: string,
): Promise<void> {
  for (const log of await client.deployments.logs(deploymentId)) {
    process.stdout.write(`${log.message}\n`);
  }
}

export async function inspectDeploymentCommand(
  client: EaselClient,
  reference: string,
  options: GlobalCliOptions & {
    logs?: boolean;
    wait?: boolean;
    timeout?: string;
  },
): Promise<void> {
  let deployment = await fetchDeployment(client, reference);

  if (options.wait) {
    try {
      deployment = await client.deployments.wait(deployment.id, {
        timeoutMs: parseDurationMs(options.timeout, 10 * 60 * 1000),
      });
    } catch (error) {
      if (error instanceof DeploymentWaitTimeoutError) {
        throw new Error(
          `Timed out waiting for deployment to finish (${options.timeout ?? "10m"})`,
          { cause: error },
        );
      }
      throw error;
    }
  }

  if (options.logs) {
    await printLogs(client, deployment.id);
    return;
  }

  if (options.format === "json") {
    printJson({ deployment });
    return;
  }

  printHumanDeployment(deployment, useColor(options.noColor));
}
