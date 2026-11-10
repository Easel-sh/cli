import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DeploymentGitMetadata } from "@easel-sh/sdk";

const execFileAsync = promisify(execFile);

/** The commit checked out in `cwd`, or null outside a git repository. */
export async function readLocalGitMetadata(cwd: string): Promise<DeploymentGitMetadata | null> {
  async function git(args: string[]): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync("git", args, { cwd });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  const commitHash = await git(["rev-parse", "HEAD"]);
  if (!commitHash) return null;

  const commitMessage = (await git(["log", "-1", "--pretty=%s"])) ?? undefined;
  // `symbolic-ref` fails on a detached HEAD, which has no branch to report.
  const branch = (await git(["symbolic-ref", "--quiet", "--short", "HEAD"])) ?? undefined;
  const remote = await git(["config", "--get", "remote.origin.url"]);
  const repository = remote ? parseRepository(remote) : undefined;

  return { commitHash, commitMessage, branch, repository };
}

/** `owner/name` from a git remote URL (HTTPS or SSH); names may contain dots. */
export function parseRepository(remote: string): string | undefined {
  return /[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/i.exec(remote.trim())?.[1];
}
