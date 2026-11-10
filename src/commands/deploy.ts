import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline/promises";
import { stdin as input, stderr as output } from "node:process";
import {
  DeploymentWaitTimeoutError,
  type Deployment,
  type DeploymentGitMetadata,
  type DeploymentMeta,
  type DeploymentTarget,
  type EaselClient,
  type SourceFile,
} from "@easel-sh/sdk";
import { collectDeployFiles, createSourceArchiveTgz } from "@easel-sh/sdk/node";
import type { GlobalCliOptions } from "../lib/client.js";
import { findEaselLink, readAuthConfig } from "../lib/config.js";
import { parseDurationMs } from "../lib/duration.js";
import { readLocalGitMetadata } from "../lib/git-metadata.js";
import { printJson, useColor } from "../lib/output.js";
import { resolveProjectContext } from "../lib/resolve-link.js";
import {
  createSetupApi,
  createTerminalPrompter,
  setupProject,
} from "../lib/setup-project.js";

async function confirmProductionDeploy(skip: boolean): Promise<void> {
  if (skip) return;
  if (!process.stdin.isTTY) {
    throw new Error(
      "Pass --yes to deploy to production in non-interactive mode",
    );
  }
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(
      "Deploy to production? [y/N] ",
    );
    const normalized = answer.trim().toLowerCase();
    if (normalized !== "y" && normalized !== "yes") {
      throw new Error("Production deploy cancelled");
    }
  } finally {
    rl.close();
  }
}

/** `--meta key=value` pairs as deployment meta. Later keys win. */
export function parseMetaArgs(values: string[] | undefined): DeploymentMeta | undefined {
  if (!values || values.length === 0) return undefined;
  const meta: DeploymentMeta = {};
  for (const value of values) {
    const separator = value.indexOf("=");
    const key = separator === -1 ? "" : value.slice(0, separator).trim();
    if (!key) {
      throw new Error(`Invalid --meta "${value}": expected key=value`);
    }
    meta[key] = value.slice(separator + 1);
  }
  return meta;
}

export interface UploadDeploymentOptions {
  /** Directory whose files are deployed. */
  root: string;
  /** Project id or slug. */
  project: string;
  target: DeploymentTarget;
  /** Send one gzip tarball instead of a file list. */
  archive?: boolean;
  meta?: DeploymentMeta;
  gitMetadata?: DeploymentGitMetadata;
}

/** Collect `root` and create a deployment from it. Returns once it is queued. */
export async function uploadDeployment(
  client: EaselClient,
  options: UploadDeploymentOptions,
): Promise<Deployment> {
  const collected = await collectDeployFiles({ root: options.root });
  const common = {
    project: options.project,
    target: options.target,
    meta: options.meta,
    gitMetadata: options.gitMetadata,
  };

  if (options.archive) {
    const staging = await mkdtemp(join(tmpdir(), "easel-deploy-"));
    try {
      const archivePath = join(staging, "source.tgz");
      await createSourceArchiveTgz(collected, archivePath);
      return await client.deployments.create({
        ...common,
        archive: new Uint8Array(await readFile(archivePath)),
      });
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  // Directories carry no content hash; the file list only needs files.
  const files: SourceFile[] = await Promise.all(
    collected
      .filter((file) => file.contentHash)
      .map(async (file) => ({
        file: file.file,
        data: new Uint8Array(await readFile(file.absolutePath)),
        mode: file.mode & 0o777,
      })),
  );
  return client.deployments.create({ ...common, files });
}

function deploymentUrl(deployment: Deployment): string | null {
  return deployment.primaryUrl ?? deployment.aliases[0]?.url ?? null;
}

export async function deployCommand(
  client: EaselClient,
  options: GlobalCliOptions & {
    workspace?: string;
    project?: string;
    prod?: boolean;
    yes?: boolean;
    wait?: boolean;
    timeout?: string;
    archive?: boolean;
    meta?: string[];
  },
): Promise<void> {
  const meta = parseMetaArgs(options.meta);

  // Unlinked folder: set up (link or create) the project first.
  let createdProject = false;
  if (!options.project && !(await findEaselLink(process.cwd()))) {
    if (!process.stdin.isTTY && !options.yes) {
      throw new Error(
        `No linked project. Run \`easel deploy\` in a terminal to set one up, pass --project, or pass --yes to accept the defaults.`,
      );
    }
    const auth = await readAuthConfig();
    const setup = await setupProject({
      cwd: process.cwd(),
      api: createSetupApi(client),
      prompter: createTerminalPrompter(),
      yes: options.yes === true,
      workspaceHint: options.workspace ?? auth?.workspaceSlug ?? auth?.workspaceId,
    });
    createdProject = setup.created;
  }

  const ctx = await resolveProjectContext(client, options);
  // The first deploy of a new project goes to production.
  const target = options.prod || createdProject ? "production" : "preview";

  if (options.prod && !createdProject) {
    await confirmProductionDeploy(options.yes === true);
  }

  let deployment = await uploadDeployment(client, {
    root: ctx.uploadRoot,
    project: ctx.projectId,
    target,
    archive: options.archive === true,
    meta,
    gitMetadata: (await readLocalGitMetadata(ctx.uploadRoot)) ?? undefined,
  });

  if (options.wait) {
    try {
      deployment = await client.deployments.wait(deployment.id, {
        timeoutMs: parseDurationMs(options.timeout, 10 * 60 * 1000),
      });
    } catch (error) {
      if (error instanceof DeploymentWaitTimeoutError) {
        throw new Error(
          `Timed out waiting for deployment ${deployment.id} to finish (${options.timeout ?? "10m"})`,
          { cause: error },
        );
      }
      throw error;
    }
  }

  const url = deploymentUrl(deployment);
  if (options.format === "json") {
    printJson({ id: deployment.id, status: deployment.status, url, deployment });
  } else {
    const color = useColor(options.noColor);
    const heading = (label: string) =>
      color ? `\x1b[1m${label}\x1b[0m` : label;
    console.log(heading("Deployment"));
    console.log(`  ID:     ${deployment.id}`);
    console.log(`  Target: ${deployment.target}`);
    console.log(`  Status: ${deployment.status}`);
    if (url) {
      console.log(`  URL:    ${url}`);
    }
  }

  if (
    options.wait &&
    (deployment.status === "ERROR" || deployment.status === "CANCELLED")
  ) {
    process.exitCode = 1;
  }
}
