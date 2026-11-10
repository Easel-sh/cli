import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Project } from "@easel-sh/sdk";
import { beforeEach, describe, expect, it } from "vitest";
import {
  setupProject,
  type Prompter,
  type SetupApi,
} from "./setup-project.js";

const workspace = { id: "org_1", slug: "acme", name: "Acme" };

function project(fields: Pick<Project, "id" | "name" | "slug">): Project {
  return {
    organizationId: workspace.id,
    rootDirectory: null,
    framework: null,
    buildCommand: null,
    installCommand: null,
    outputDirectory: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    ...fields,
  };
}

function fakeApi(projects: Project[] = [], workspaces = [workspace]): SetupApi & { created: unknown[] } {
  const created: unknown[] = [];
  return {
    created,
    listWorkspaces: async () => workspaces,
    listProjects: async () => projects,
    detect: async () => ({
      framework: { slug: "nextjs", name: "Next.js" },
      buildCommand: "next build",
      installCommand: "pnpm install",
      outputDirectory: ".next",
    }),
    createProject: async (body) => {
      created.push(body);
      return project({ id: "prj_new", name: body.name, slug: body.name });
    },
  };
}

/** Answers prompts in order; fails the test on an unexpected prompt. */
function scriptedPrompter(answers: Array<boolean | string | number>): Prompter & { asked: string[] } {
  const asked: string[] = [];
  const next = (question: string) => {
    asked.push(question);
    if (answers.length === 0) throw new Error(`Unexpected prompt: ${question}`);
    return answers.shift()!;
  };
  return {
    asked,
    confirm: async (question) => next(question) as boolean,
    text: async (question) => next(question) as string,
    select: async (question) => next(question) as number,
  };
}

const noFiles = async () => ({ paths: ["package.json"], files: { "package.json": "{}" } });

let cwd: string;
beforeEach(async () => {
  cwd = join(await mkdtemp(join(tmpdir(), "easel-setup-")), "storefront");
  await mkdir(cwd);
});

async function readLink() {
  return JSON.parse(await readFile(join(cwd, ".easel", "project.json"), "utf8"));
}

describe("setupProject", () => {
  it("links the project matching the folder name", async () => {
    const api = fakeApi([project({ id: "prj_1", name: "storefront", slug: "storefront" })]);
    const prompter = scriptedPrompter([true]);
    const result = await setupProject({ cwd, api, prompter, yes: false, log: () => {}, collect: noFiles });

    expect(prompter.asked).toEqual(['Found project "acme/storefront". Link to it?']);
    expect(result.created).toBe(false);
    expect(await readLink()).toMatchObject({ projectId: "prj_1", workspaceSlug: "acme" });
  });

  it("links an existing project by name", async () => {
    const api = fakeApi([project({ id: "prj_2", name: "marketing", slug: "marketing" })]);
    const prompter = scriptedPrompter([true, "marketing"]);
    const result = await setupProject({ cwd, api, prompter, yes: false, log: () => {}, collect: noFiles });

    expect(prompter.asked).toEqual(["Link to existing project?", "Existing project name?"]);
    expect(result.link.projectId).toBe("prj_2");
  });

  it("creates a project with detected settings", async () => {
    const api = fakeApi();
    const lines: string[] = [];
    const prompter = scriptedPrompter(["shop", false]);
    const result = await setupProject({ cwd, api, prompter, yes: false, log: (l) => lines.push(l), collect: noFiles });

    expect(prompter.asked).toEqual(["Name?", "Customize settings?"]);
    expect(lines).toContain("Detected Next.js (Build Command: next build, Output Directory: .next)");
    expect(api.created).toEqual([
      {
        workspace: "org_1",
        name: "shop",
        framework: "nextjs",
        buildCommand: null,
        installCommand: null,
        outputDirectory: null,
      },
    ]);
    expect(result.created).toBe(true);
  });

  it("leaves the framework unset when nothing is detected, so builds detect it", async () => {
    const api = fakeApi();
    api.detect = async () => ({ framework: null, buildCommand: null, installCommand: null, outputDirectory: null });
    await setupProject({ cwd, api, prompter: scriptedPrompter([]), yes: true, log: () => {}, collect: noFiles });

    expect(api.created).toHaveLength(1);
    expect(api.created[0]).not.toHaveProperty("framework");
  });

  it("saves only the settings the user changes", async () => {
    const api = fakeApi();
    const prompter = scriptedPrompter(["shop", true, "next build", "out", ""]);
    await setupProject({ cwd, api, prompter, yes: false, log: () => {}, collect: noFiles });

    expect(prompter.asked).toEqual([
      "Name?",
      "Customize settings?",
      "Build Command?",
      "Output Directory?",
      "Install Command?",
    ]);
    expect(api.created).toEqual([
      expect.objectContaining({ buildCommand: null, outputDirectory: "out", installCommand: null }),
    ]);
  });

  it("accepts every default with --yes", async () => {
    const api = fakeApi([], [workspace, { id: "org_2", slug: "other", name: "Other" }]);
    const prompter = scriptedPrompter([]);
    const result = await setupProject({ cwd, api, prompter, yes: true, log: () => {}, collect: noFiles });

    expect(api.created).toEqual([expect.objectContaining({ name: "storefront", workspace: "org_1" })]);
    expect(result.created).toBe(true);
  });

  it("asks for the workspace only when there are several and none is hinted", async () => {
    const api = fakeApi([], [workspace, { id: "org_2", slug: "other", name: "Other" }]);
    const prompter = scriptedPrompter([1, "storefront", false]);
    const result = await setupProject({ cwd, api, prompter, yes: false, log: () => {}, collect: noFiles });

    expect(prompter.asked[0]).toBe("Which workspace?");
    expect(result.link.workspaceSlug).toBe("other");
  });

  it("fails clearly when the named project doesn't exist", async () => {
    const api = fakeApi([project({ id: "prj_2", name: "marketing", slug: "marketing" })]);
    const prompter = scriptedPrompter([true, "nope"]);
    await expect(
      setupProject({ cwd, api, prompter, yes: false, log: () => {}, collect: noFiles }),
    ).rejects.toThrow('No project named "nope" in acme');
  });
});
