import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { createInterface } from "node:readline/promises";
import { stdin as input, stderr as output } from "node:process";
import type { EaselClient, Project } from "@easel-sh/sdk";
import type { GlobalCliOptions } from "../lib/client.js";
import {
  normalizeLinkDirectory,
  readAuthConfig,
  removeProjectLink,
  writeProjectLink,
  writeRepoLink,
  type EaselRepoProjectEntry,
} from "../lib/config.js";
import {
  createSetupApi,
  createTerminalPrompter,
  setupProject,
} from "../lib/setup-project.js";

const execFileAsync = promisify(execFile);

function normalizeProjectArgs(
  project: string | string[] | undefined,
): string[] {
  if (project == null) return [];
  if (Array.isArray(project)) {
    return project.flatMap((p) =>
      String(p)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
  return String(project)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function findProject(
  projects: Project[],
  needle: string,
): Project | undefined {
  return (
    projects.find((project) => project.id === needle) ??
    projects.find((project) => project.slug === needle) ??
    projects.find((project) => project.name === needle)
  );
}

async function resolveGitRepoRoot(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--show-toplevel"],
      { cwd },
    );
    const root = stdout.trim();
    return root.length > 0 ? root : null;
  } catch {
    return null;
  }
}

async function linkSingleProject(
  client: EaselClient,
  options: GlobalCliOptions & { workspace?: string; project?: string | string[]; yes?: boolean },
): Promise<void> {
  const auth = await readAuthConfig();
  const workspace = options.workspace ?? auth?.workspaceSlug ?? auth?.workspaceId;
  const projectArgs = normalizeProjectArgs(options.project);

  if (!projectArgs[0]) {
    if (!process.stdin.isTTY && !options.yes) {
      throw new Error(
        "Pass --project <slug> to link an existing project, or --yes to set one up with defaults.",
      );
    }
    await setupProject({
      cwd: process.cwd(),
      api: createSetupApi(client),
      prompter: createTerminalPrompter(),
      yes: options.yes === true,
      workspaceHint: workspace,
    });
    return;
  }

  const projects = await client.projects.list();

  const selected = findProject(projects, projectArgs[0]);
  if (!selected) {
    throw new Error(`Project not found: ${projectArgs[0]}`);
  }

  const { workspace: workspaceRecord } = await client.whoami();

  await writeProjectLink({
    projectId: selected.id,
    projectSlug: selected.slug,
    workspaceId: workspaceRecord.id,
    workspaceSlug: workspaceRecord.slug ?? workspaceRecord.id,
  });

  console.error(
    `Linked ${workspaceRecord.slug ?? workspaceRecord.id}/${selected.slug ?? selected.id} (saved to .easel/project.json)`,
  );
}

async function selectProjectsInteractive(
  projects: Project[],
): Promise<Project[]> {
  console.error("Select projects to link (comma-separated numbers, or 'all'):");
  projects.forEach((project, index) => {
    const dir = project.rootDirectory ?? ".";
    console.error(
      `  ${index + 1}. ${project.name} (${project.slug ?? project.id}) → ${dir}`,
    );
  });

  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question("> ");
    const trimmed = answer.trim().toLowerCase();
    if (trimmed === "all" || trimmed === "*") {
      return projects;
    }
    const indices = trimmed
      .split(/[,\s]+/)
      .map((part) => Number.parseInt(part, 10) - 1)
      .filter((n) => Number.isFinite(n));
    const selected = [...new Set(indices)]
      .map((i) => projects[i])
      .filter((p): p is Project => p != null);
    if (selected.length === 0) {
      throw new Error("Invalid selection");
    }
    return selected;
  } finally {
    rl.close();
  }
}

async function linkRepo(
  client: EaselClient,
  options: GlobalCliOptions & { project?: string | string[] },
): Promise<void> {
  const cwd = process.cwd();
  const gitRoot = await resolveGitRepoRoot(cwd);
  const repoRoot = gitRoot ?? cwd;
  if (!gitRoot) {
    console.error(
      "Warning: not inside a git repository; writing .easel/repo.json to the current directory.",
    );
  } else if (gitRoot !== cwd) {
    console.error(`Linking monorepo at ${gitRoot}`);
  }

  const projects = await client.projects.list();

  if (projects.length === 0) {
    throw new Error("No projects found in the active workspace.");
  }

  const projectArgs = normalizeProjectArgs(options.project);
  let selected: Project[];

  if (projectArgs.length > 0) {
    selected = [];
    for (const arg of projectArgs) {
      const match = findProject(projects, arg);
      if (!match) {
        throw new Error(`Project not found: ${arg}`);
      }
      selected.push(match);
    }
  } else if (!process.stdin.isTTY) {
    throw new Error(
      "Pass one or more --project <slug> values in non-interactive mode.",
    );
  } else {
    selected = await selectProjectsInteractive(projects);
  }

  const { workspace: workspaceRecord } = await client.whoami();

  const entries: EaselRepoProjectEntry[] = selected.map((project) => ({
    id: project.id,
    slug: project.slug,
    directory: normalizeLinkDirectory(project.rootDirectory),
  }));

  await writeRepoLink(
    {
      workspaceId: workspaceRecord.id,
      workspaceSlug: workspaceRecord.slug ?? workspaceRecord.id,
      projects: entries,
    },
    repoRoot,
  );

  await removeProjectLink(repoRoot);

  console.error(
    `Linked ${entries.length} project(s) in workspace ${workspaceRecord.slug ?? workspaceRecord.id}:`,
  );
  for (const entry of entries) {
    const dir = entry.directory || ".";
    console.error(`  ${entry.slug ?? entry.id} → ${dir}`);
  }
  console.error(`Saved to ${join(repoRoot, ".easel", "repo.json")}`);
}

export async function linkCommand(
  client: EaselClient,
  options: GlobalCliOptions & {
    workspace?: string;
    project?: string | string[];
    repo?: boolean;
    yes?: boolean;
  },
): Promise<void> {
  if (options.repo) {
    await linkRepo(client, options);
    return;
  }
  await linkSingleProject(client, options);
}
