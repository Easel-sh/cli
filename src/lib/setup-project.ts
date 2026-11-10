import { homedir } from "node:os";
import { basename } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stderr as output } from "node:process";
import type {
  CreateProjectRequest,
  DetectFrameworkResponse,
  EaselClient,
  Project,
  Workspace,
} from "@easel-sh/sdk";
import { collectDetectionInput } from "@easel-sh/sdk/node";
import { writeProjectLink, type EaselProjectLink } from "./config.js";

/**
 * First run of `deploy` / `link` in a folder that isn't linked yet: pick a
 * workspace, link a matching or existing project, or create one with detected
 * settings, then write `.easel/project.json`.
 */

export interface SetupApi {
  listWorkspaces(): Promise<Workspace[]>;
  listProjects(): Promise<Project[]>;
  detect(paths: string[], files: Record<string, string>): Promise<DetectFrameworkResponse>;
  createProject(body: CreateProjectRequest): Promise<Project>;
}

export interface Prompter {
  confirm(question: string, defaultYes: boolean): Promise<boolean>;
  text(question: string, defaultValue?: string): Promise<string>;
  select(question: string, choices: string[]): Promise<number>;
}

export interface SetupResult {
  link: EaselProjectLink;
  /** True when a new project was created (its first deploy goes to production). */
  created: boolean;
}

function slugifyProjectName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function displayPath(cwd: string): string {
  const home = homedir();
  return cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
}

function describeDetected(settings: DetectFrameworkResponse): string {
  if (!settings.framework) return "No framework detected; Easel will use the build script in package.json";
  const details = [
    `Build Command: ${settings.buildCommand ?? "framework default"}`,
    `Output Directory: ${settings.outputDirectory ?? `${settings.framework.name} default`}`,
  ];
  return `Detected ${settings.framework.name} (${details.join(", ")})`;
}

export async function setupProject(options: {
  cwd: string;
  api: SetupApi;
  prompter: Prompter;
  /** Accept every default without asking (`--yes`). */
  yes: boolean;
  /** `--workspace`, or the workspace saved at login. */
  workspaceHint?: string;
  log?: (line: string) => void;
  /** Detection input; defaults to scanning `cwd`. */
  collect?: (root: string) => Promise<{ paths: string[]; files: Record<string, string> }>;
}): Promise<SetupResult> {
  const { cwd, api, prompter, yes } = options;
  const log = options.log ?? ((line: string) => console.error(line));
  const collect = options.collect ?? collectDetectionInput;

  log(`Set up "${displayPath(cwd)}"`);

  const workspaces = await api.listWorkspaces();
  if (workspaces.length === 0) {
    throw new Error("You're not in any workspace yet. Create one at easel.sh, then run this again.");
  }
  const hinted = workspaces.find((w) => w.id === options.workspaceHint || w.slug === options.workspaceHint);
  let workspace = hinted ?? workspaces[0]!;
  if (!hinted && workspaces.length > 1 && !yes) {
    const index = await prompter.select(
      "Which workspace?",
      workspaces.map((w) => `${w.name} (${w.slug ?? w.id})`),
    );
    workspace = workspaces[index]!;
  }
  const workspaceSlug = workspace.slug ?? workspace.id;

  const linkTo = async (project: Project, created: boolean): Promise<SetupResult> => {
    const link: EaselProjectLink = {
      projectId: project.id,
      projectSlug: project.slug,
      workspaceId: workspace.id,
      workspaceSlug,
    };
    await writeProjectLink(link, cwd);
    log(`Linked ${workspaceSlug}/${project.slug ?? project.id} (saved to .easel/project.json)`);
    return { link, created };
  };

  const projects = await api.listProjects();
  const dirName = basename(cwd);
  const match = projects.find((p) => p.slug === slugifyProjectName(dirName) || p.name === dirName);
  if (match) {
    const useMatch = yes || (await prompter.confirm(`Found project "${workspaceSlug}/${match.slug ?? match.name}". Link to it?`, true));
    if (useMatch) return linkTo(match, false);
  }

  if (!yes && projects.length > 0 && (await prompter.confirm("Link to existing project?", false))) {
    const wanted = (await prompter.text("Existing project name?")).trim();
    const existing = projects.find((p) => p.slug === wanted || p.name === wanted || p.id === wanted);
    if (!existing) throw new Error(`No project named "${wanted}" in ${workspaceSlug}`);
    return linkTo(existing, false);
  }

  const name = yes ? dirName : (await prompter.text("Name?", dirName)).trim() || dirName;
  const { paths, files } = await collect(cwd);
  const detected = await api.detect(paths, files);
  log(describeDetected(detected));

  // Detected commands are framework defaults resolved at build time
  // (the app's own `build` script wins); only values the user changes are saved.
  let buildCommand: string | null = null;
  let installCommand: string | null = null;
  let outputDirectory: string | null = null;
  if (!yes && (await prompter.confirm("Customize settings?", false))) {
    const override = async (question: string, detectedValue: string | null) => {
      const answer = (await prompter.text(question, detectedValue ?? "")).trim();
      return answer && answer !== detectedValue ? answer : null;
    };
    buildCommand = await override("Build Command?", detected.buildCommand);
    outputDirectory = await override("Output Directory?", detected.outputDirectory);
    installCommand = await override("Install Command?", detected.installCommand);
  }

  const project = await api.createProject({
    workspace: workspace.id,
    name,
    // Nothing detected leaves the framework unset, so each build detects it
    // again (`null` would mean the user chose "Other").
    ...(detected.framework ? { framework: detected.framework.slug } : {}),
    buildCommand,
    installCommand,
    outputDirectory,
  });
  return linkTo(project, true);
}

/** Readline prompts on stderr so stdout stays the deployment URL. */
export function createTerminalPrompter(): Prompter {
  async function ask(question: string): Promise<string> {
    const rl = createInterface({ input, output });
    try {
      return await rl.question(question);
    } finally {
      rl.close();
    }
  }

  return {
    async confirm(question, defaultYes) {
      const answer = (await ask(`? ${question} ${defaultYes ? "[Y/n]" : "[y/N]"} `)).trim().toLowerCase();
      if (!answer) return defaultYes;
      return answer === "y" || answer === "yes";
    },
    async text(question, defaultValue) {
      const answer = await ask(`? ${question}${defaultValue ? ` (${defaultValue})` : ""} `);
      return answer.trim() || defaultValue || "";
    },
    async select(question, choices) {
      output.write(`? ${question}\n`);
      choices.forEach((choice, index) => output.write(`  ${index + 1}. ${choice}\n`));
      const answer = Number.parseInt((await ask("> ")).trim(), 10) - 1;
      if (!Number.isInteger(answer) || answer < 0 || answer >= choices.length) {
        throw new Error("Invalid selection");
      }
      return answer;
    },
  };
}

export function createSetupApi(client: EaselClient): SetupApi {
  return {
    async listWorkspaces() {
      const { workspaces } = await client.request<{ workspaces: Workspace[] }>("GET", "/v1/workspaces");
      return workspaces;
    },
    listProjects: () => client.projects.list(),
    detect: (paths, files) =>
      client.request<DetectFrameworkResponse>("POST", "/v1/frameworks/detect", { json: { paths, files } }),
    createProject: (body) => client.projects.create(body),
  };
}
