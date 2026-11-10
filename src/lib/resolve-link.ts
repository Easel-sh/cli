import { createInterface } from "node:readline/promises";
import { stdin as input, stderr as output } from "node:process";
import { relative, resolve, sep } from "node:path";
import type { EaselClient } from "@easel-sh/sdk";
import {
  findEaselLink,
  normalizeLinkDirectory,
  type EaselRepoLink,
  type EaselRepoProjectEntry,
} from "./config.js";

export type RepoProjectMatch =
  | { status: "matched"; project: EaselRepoProjectEntry }
  | { status: "ambiguous"; candidates: EaselRepoProjectEntry[] }
  | { status: "none"; candidates: EaselRepoProjectEntry[] };

export interface ProjectContext {
  projectId: string;
  projectSlug: string | null;
  /** Directory to upload (repo root or project-link root). */
  uploadRoot: string;
  /** Directory containing the link file used (project or repo). */
  linkRoot: string | null;
  kind: "flag" | "project" | "repo";
}

function pathIsInsideOrEqual(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
}

/**
 * Pick the deepest configured directory that contains cwd (relative to repoRoot).
 * If none match, return all projects as candidates for prompting.
 */
export function matchRepoProject(
  repoRoot: string,
  link: EaselRepoLink,
  cwd: string,
): RepoProjectMatch {
  const absCwd = resolve(cwd);
  const absRoot = resolve(repoRoot);
  if (!pathIsInsideOrEqual(absCwd, absRoot)) {
    return { status: "none", candidates: link.projects };
  }

  const rel =
    absCwd === absRoot
      ? ""
      : relative(absRoot, absCwd).split(sep).join("/");

  const matches: EaselRepoProjectEntry[] = [];
  for (const project of link.projects) {
    const dir = normalizeLinkDirectory(project.directory);
    if (dir === "") {
      matches.push({ ...project, directory: "" });
      continue;
    }
    if (rel === dir || rel.startsWith(`${dir}/`)) {
      matches.push({ ...project, directory: dir });
    }
  }

  if (matches.length === 0) {
    return { status: "none", candidates: link.projects };
  }

  matches.sort(
    (a, b) =>
      normalizeLinkDirectory(b.directory).length -
      normalizeLinkDirectory(a.directory).length,
  );

  const deepest = normalizeLinkDirectory(matches[0]!.directory);
  const tied = matches.filter(
    (m) => normalizeLinkDirectory(m.directory) === deepest,
  );
  if (tied.length > 1) {
    return { status: "ambiguous", candidates: tied };
  }
  return { status: "matched", project: tied[0]! };
}

async function promptAmongProjects(
  candidates: EaselRepoProjectEntry[],
): Promise<EaselRepoProjectEntry> {
  if (!process.stdin.isTTY) {
    throw new Error(
      `Multiple projects in the linked repo. Pass --project <slug>.`,
    );
  }

  console.error("Select a project:");
  candidates.forEach((project, index) => {
    const dir = normalizeLinkDirectory(project.directory) || ".";
    const label = project.slug ?? project.id;
    console.error(`  ${index + 1}. ${label} (${dir})`);
  });

  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question("> ");
    const index = Number.parseInt(answer.trim(), 10) - 1;
    const selected = candidates[index];
    if (!selected) {
      throw new Error("Invalid selection");
    }
    return selected;
  } finally {
    rl.close();
  }
}

/**
 * Resolve which project to use and where to upload from for deploy/logs/list.
 */
export async function resolveProjectContext(
  client: EaselClient,
  options: { project?: string },
  cwd = process.cwd(),
): Promise<ProjectContext> {
  const found = await findEaselLink(cwd);

  if (options.project) {
    const match = await client.projects.get(options.project);

    // A linked folder (project or repo) is uploaded from its link root.
    return {
      projectId: match.id,
      projectSlug: match.slug,
      uploadRoot: found?.root ?? cwd,
      linkRoot: found?.root ?? null,
      kind: "flag",
    };
  }

  if (found?.kind === "project") {
    return {
      projectId: found.link.projectId,
      projectSlug: found.link.projectSlug,
      uploadRoot: found.root,
      linkRoot: found.root,
      kind: "project",
    };
  }

  if (found?.kind === "repo") {
    const match = matchRepoProject(found.root, found.link, cwd);
    let entry: EaselRepoProjectEntry;
    if (match.status === "matched") {
      entry = match.project;
    } else if (match.candidates.length === 1) {
      entry = match.candidates[0]!;
    } else {
      entry = await promptAmongProjects(match.candidates);
    }

    return {
      projectId: entry.id,
      projectSlug: entry.slug,
      uploadRoot: found.root,
      linkRoot: found.root,
      kind: "repo",
    };
  }

  throw new Error(
    `No linked project. Run \`easel link\` or \`easel link --repo\`, or pass --project.`,
  );
}

export async function resolveProjectId(
  client: EaselClient,
  options: { project?: string },
  cwd = process.cwd(),
): Promise<string> {
  const ctx = await resolveProjectContext(client, options, cwd);
  return ctx.projectId;
}
