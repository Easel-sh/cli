import { access, chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, parse as parsePath } from "node:path";

const APP_NAME = "com.easel.cli";

export interface EaselAuthConfig {
  token: string;
  userId?: string;
  workspaceId?: string;
  workspaceSlug?: string;
}

export interface EaselProjectLink {
  projectId: string;
  workspaceId: string;
  workspaceSlug: string;
  projectSlug: string | null;
}

export interface EaselRepoProjectEntry {
  id: string;
  slug: string | null;
  /** Relative to the repo-link root; "" means the repo root. */
  directory: string;
}

export interface EaselRepoLink {
  workspaceId: string;
  workspaceSlug: string;
  projects: EaselRepoProjectEntry[];
}

export type FoundEaselLink =
  | {
      kind: "project";
      root: string;
      link: EaselProjectLink;
    }
  | {
      kind: "repo";
      root: string;
      link: EaselRepoLink;
    };

function dataHome(): string {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", APP_NAME);
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, "Easel", "cli");
  }
  const xdgDataHome = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(xdgDataHome, APP_NAME);
}

function getAuthConfigPath(): string {
  return join(dataHome(), "auth.json");
}

function getProjectLinkPath(cwd = process.cwd()): string {
  return join(cwd, ".easel", "project.json");
}

function getRepoLinkPath(cwd = process.cwd()): string {
  return join(cwd, ".easel", "repo.json");
}

/** Normalize a link directory: strip slashes; `.` / empty → `""`. */
export function normalizeLinkDirectory(
  directory: string | null | undefined,
): string {
  if (directory == null) return "";
  const trimmed = directory.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (trimmed === "." || trimmed === "./") return "";
  return trimmed;
}

async function ensurePrivateDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
  await ensurePrivateDir(join(path, ".."));
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(path, 0o600);
}

export async function readAuthConfig(): Promise<EaselAuthConfig | null> {
  try {
    const raw = await readFile(getAuthConfigPath(), "utf8");
    const parsed = JSON.parse(raw) as EaselAuthConfig;
    if (!parsed?.token || typeof parsed.token !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function writeAuthConfig(config: EaselAuthConfig): Promise<void> {
  await writePrivateJson(getAuthConfigPath(), config);
}

export async function clearAuthConfig(): Promise<void> {
  try {
    await unlink(getAuthConfigPath());
  } catch {
    // ignore missing file
  }
}

function parseProjectLink(raw: string): EaselProjectLink | null {
  try {
    const parsed = JSON.parse(raw) as EaselProjectLink;
    if (
      !parsed?.projectId ||
      !parsed?.workspaceId ||
      !parsed?.workspaceSlug
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function parseRepoLink(raw: string): EaselRepoLink | null {
  try {
    const parsed = JSON.parse(raw) as EaselRepoLink;
    if (
      !parsed?.workspaceId ||
      !parsed?.workspaceSlug ||
      !Array.isArray(parsed.projects)
    ) {
      return null;
    }
    const projects: EaselRepoProjectEntry[] = [];
    for (const entry of parsed.projects) {
      if (!entry?.id || typeof entry.id !== "string") continue;
      projects.push({
        id: entry.id,
        slug: entry.slug ?? null,
        directory: normalizeLinkDirectory(entry.directory),
      });
    }
    if (projects.length === 0) return null;
    return {
      workspaceId: parsed.workspaceId,
      workspaceSlug: parsed.workspaceSlug,
      projects,
    };
  } catch {
    return null;
  }
}

async function readProjectLink(
  cwd = process.cwd(),
): Promise<EaselProjectLink | null> {
  try {
    const raw = await readFile(getProjectLinkPath(cwd), "utf8");
    return parseProjectLink(raw);
  } catch {
    return null;
  }
}

export async function writeProjectLink(
  link: EaselProjectLink,
  cwd = process.cwd(),
): Promise<void> {
  const path = getProjectLinkPath(cwd);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(link, null, 2)}\n`, "utf8");
}

async function readRepoLink(
  cwd = process.cwd(),
): Promise<EaselRepoLink | null> {
  try {
    const raw = await readFile(getRepoLinkPath(cwd), "utf8");
    return parseRepoLink(raw);
  } catch {
    return null;
  }
}

export async function writeRepoLink(
  link: EaselRepoLink,
  cwd = process.cwd(),
): Promise<void> {
  const path = getRepoLinkPath(cwd);
  await mkdir(join(path, ".."), { recursive: true });
  const normalized: EaselRepoLink = {
    workspaceId: link.workspaceId,
    workspaceSlug: link.workspaceSlug,
    projects: link.projects.map((project) => ({
      id: project.id,
      slug: project.slug,
      directory: normalizeLinkDirectory(project.directory),
    })),
  };
  await writeFile(path, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

export async function removeProjectLink(cwd = process.cwd()): Promise<void> {
  try {
    await unlink(getProjectLinkPath(cwd));
  } catch {
    // ignore missing file
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Walk from cwd toward the filesystem root.
 * Nearest `.easel/project.json` wins; otherwise nearest `.easel/repo.json`.
 */
export async function findEaselLink(
  cwd = process.cwd(),
): Promise<FoundEaselLink | null> {
  let dir = cwd;
  for (;;) {
    const projectPath = getProjectLinkPath(dir);
    if (await pathExists(projectPath)) {
      const link = await readProjectLink(dir);
      if (link) {
        return { kind: "project", root: dir, link };
      }
    }

    const repoPath = getRepoLinkPath(dir);
    if (await pathExists(repoPath)) {
      const link = await readRepoLink(dir);
      if (link) {
        return { kind: "repo", root: dir, link };
      }
    }

    const parent = dirname(dir);
    if (parent === dir || parsePath(dir).root === dir) {
      return null;
    }
    dir = parent;
  }
}
