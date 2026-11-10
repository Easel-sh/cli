import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findEaselLink,
  normalizeLinkDirectory,
  writeProjectLink,
  writeRepoLink,
  type EaselRepoLink,
} from "./config.js";
import { matchRepoProject } from "./resolve-link.js";

describe("normalizeLinkDirectory", () => {
  it("normalizes empty and dot paths to empty string", () => {
    expect(normalizeLinkDirectory(null)).toBe("");
    expect(normalizeLinkDirectory(undefined)).toBe("");
    expect(normalizeLinkDirectory(".")).toBe("");
    expect(normalizeLinkDirectory("./")).toBe("");
    expect(normalizeLinkDirectory(" /apps/web/ ")).toBe("apps/web");
  });
});

describe("matchRepoProject", () => {
  const link: EaselRepoLink = {
    workspaceId: "ws_1",
    workspaceSlug: "acme",
    projects: [
      { id: "prj_front", slug: "front", directory: "apps/front" },
      { id: "prj_web", slug: "web", directory: "apps/web" },
      { id: "prj_apps", slug: "apps-meta", directory: "apps" },
    ],
  };

  it("picks the deepest matching directory", () => {
    const match = matchRepoProject("/repo", link, "/repo/apps/web/src");
    expect(match.status).toBe("matched");
    if (match.status === "matched") {
      expect(match.project.id).toBe("prj_web");
    }
  });

  it("matches apps/front over apps", () => {
    const match = matchRepoProject("/repo", link, "/repo/apps/front");
    expect(match.status).toBe("matched");
    if (match.status === "matched") {
      expect(match.project.id).toBe("prj_front");
    }
  });

  it("returns none at repo root when all projects are nested", () => {
    const match = matchRepoProject("/repo", link, "/repo");
    expect(match.status).toBe("none");
    if (match.status === "none") {
      expect(match.candidates).toHaveLength(3);
    }
  });

  it("matches a root project when directory is empty", () => {
    const withRoot: EaselRepoLink = {
      ...link,
      projects: [
        { id: "prj_root", slug: "root", directory: "" },
        { id: "prj_web", slug: "web", directory: "apps/web" },
      ],
    };
    const atRoot = matchRepoProject("/repo", withRoot, "/repo");
    expect(atRoot.status).toBe("matched");
    if (atRoot.status === "matched") {
      expect(atRoot.project.id).toBe("prj_root");
    }

    const inWeb = matchRepoProject("/repo", withRoot, "/repo/apps/web");
    expect(inWeb.status).toBe("matched");
    if (inWeb.status === "matched") {
      expect(inWeb.project.id).toBe("prj_web");
    }
  });

  it("reports ambiguous when two projects share the same deepest directory", () => {
    const dup: EaselRepoLink = {
      workspaceId: "ws_1",
      workspaceSlug: "acme",
      projects: [
        { id: "prj_a", slug: "a", directory: "apps/web" },
        { id: "prj_b", slug: "b", directory: "apps/web" },
      ],
    };
    const match = matchRepoProject("/repo", dup, "/repo/apps/web");
    expect(match.status).toBe("ambiguous");
    if (match.status === "ambiguous") {
      expect(match.candidates.map((c) => c.id).sort()).toEqual([
        "prj_a",
        "prj_b",
      ]);
    }
  });
});

describe("findEaselLink", () => {
  it("prefers nearest project.json over a parent repo.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "easel-link-"));
    const appDir = join(root, "apps", "web");
    await mkdir(appDir, { recursive: true });

    await writeRepoLink(
      {
        workspaceId: "ws_1",
        workspaceSlug: "acme",
        projects: [
          { id: "prj_web", slug: "web", directory: "apps/web" },
          { id: "prj_front", slug: "front", directory: "apps/front" },
        ],
      },
      root,
    );

    await writeProjectLink(
      {
        projectId: "prj_override",
        projectSlug: "override",
        workspaceId: "ws_1",
        workspaceSlug: "acme",
      },
      appDir,
    );

    const fromApp = await findEaselLink(appDir);
    expect(fromApp?.kind).toBe("project");
    if (fromApp?.kind === "project") {
      expect(fromApp.link.projectId).toBe("prj_override");
      expect(fromApp.root).toBe(appDir);
    }

    const fromRoot = await findEaselLink(root);
    expect(fromRoot?.kind).toBe("repo");
    if (fromRoot?.kind === "repo") {
      expect(fromRoot.link.projects).toHaveLength(2);
      expect(fromRoot.root).toBe(root);
    }
  });

  it("walks up to find repo.json from a nested cwd", async () => {
    const root = await mkdtemp(join(tmpdir(), "easel-repo-"));
    const nested = join(root, "apps", "front", "src");
    await mkdir(nested, { recursive: true });
    await writeRepoLink(
      {
        workspaceId: "ws_1",
        workspaceSlug: "acme",
        projects: [{ id: "prj_front", slug: "front", directory: "apps/front" }],
      },
      root,
    );

    const found = await findEaselLink(nested);
    expect(found?.kind).toBe("repo");
    if (found?.kind === "repo") {
      expect(found.root).toBe(root);
    }
  });

  it("returns null when no link files exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "easel-empty-"));
    await writeFile(join(root, "readme.txt"), "x");
    expect(await findEaselLink(root)).toBeNull();
  });
});
