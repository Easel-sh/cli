import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DeploymentInlineFile, DeploymentFileRef } from "@easel-sh/sdk";
import { uploadDeployment } from "./deploy.js";
import { createCliClient } from "../lib/client.js";
import { CLI_VERSION } from "../lib/version.js";

let fixtureRoot: string;

/** A tiny static site with a node_modules folder that must not be uploaded. */
beforeAll(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), "easel-deploy-fixture-"));
  await writeFile(join(fixtureRoot, "package.json"), `${JSON.stringify({ name: "fixture", private: true })}\n`);
  await mkdir(join(fixtureRoot, "public"), { recursive: true });
  await writeFile(join(fixtureRoot, "public", "index.html"), "<h1>Hello</h1>\n");
  await mkdir(join(fixtureRoot, "node_modules", "left-pad"), { recursive: true });
  await writeFile(join(fixtureRoot, "node_modules", "left-pad", "index.js"), "module.exports = 1;\n");
});

afterAll(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

const DEPLOYMENTS_PATH = "/api/v1/projects/prj_fixture/deployments";

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

interface Recorded {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage["headers"];
  body: Buffer;
}

/** A local stand-in for the Easel API: records every request, stores uploads by hash. */
function mockApi() {
  const requests: Recorded[] = [];
  const uploaded = new Set<string>();

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res);
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const body = await readBody(req);
    requests.push({ method: req.method ?? "", path: url.pathname, query: url.searchParams, headers: req.headers, body });
    const json = (status: number, value: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(value));
    };

    if (req.method === "POST" && url.pathname === "/api/v1/files/missing") {
      const { hashes } = JSON.parse(body.toString("utf8")) as { hashes: string[] };
      return json(200, { missing: hashes.filter((hash) => !uploaded.has(hash)) });
    }

    if (req.method === "POST" && url.pathname === "/api/v1/files") {
      const hex = String(req.headers["x-content-hash"] ?? "");
      if (createHash("sha256").update(body).digest("hex") !== hex) {
        return json(400, { error: "hash mismatch" });
      }
      uploaded.add(`sha256:${hex}`);
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method === "POST" && url.pathname === DEPLOYMENTS_PATH) {
      return json(202, {
        deployment: {
          id: "dpl_fixture",
          projectId: "prj_fixture",
          source: "CLI",
          target: "preview",
          status: "QUEUED",
          queuedAt: new Date().toISOString(),
          buildingAt: null,
          readyAt: null,
          errorAt: null,
          cancelledAt: null,
          primaryUrl: null,
          gitSource: null,
          meta: null,
          aliases: [],
        },
      });
    }

    json(404, { error: `unhandled ${req.method} ${url.pathname}` });
  }

  return {
    requests,
    uploaded,
    async start(): Promise<string> {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("failed to bind mock server");
      return `http://127.0.0.1:${address.port}`;
    },
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

describe("uploadDeployment (local mock API)", () => {
  let api: ReturnType<typeof mockApi>;
  let baseUrl: string;

  beforeEach(async () => {
    api = mockApi();
    baseUrl = await api.start();
  });

  afterEach(async () => {
    await api.close();
  });

  it("sends a small source tree inline in one request, as the CLI", async () => {
    const client = createCliClient("easel_test_token", baseUrl);
    const deployment = await uploadDeployment(client, {
      root: fixtureRoot,
      project: "prj_fixture",
      target: "preview",
      meta: { appVersion: "42" },
      gitMetadata: { branch: "main" },
    });

    expect(deployment.id).toBe("dpl_fixture");
    expect(api.requests.map((r) => `${r.method} ${r.path}`)).toEqual([`POST ${DEPLOYMENTS_PATH}`]);
    const [create] = api.requests;
    expect(create!.headers["user-agent"]).toBe(`easel-cli/${CLI_VERSION}`);
    expect(create!.headers.authorization).toBe("Bearer easel_test_token");
    expect(create!.headers["idempotency-key"]).toBeTruthy();

    const body = JSON.parse(create!.body.toString("utf8")) as {
      target: string;
      meta: Record<string, string>;
      gitMetadata: Record<string, string>;
      inlineFiles: DeploymentInlineFile[];
    };
    expect(body).toMatchObject({ target: "preview", meta: { appVersion: "42" }, gitMetadata: { branch: "main" } });
    const paths = body.inlineFiles.map((f) => f.file);
    expect(paths).toContain("package.json");
    expect(paths).toContain("public/index.html");
    expect(paths.some((p) => p.startsWith("node_modules"))).toBe(false);
  });

  it("uploads only missing files for a large tree, then creates from hashes", async () => {
    const root = await mkdtemp(join(tmpdir(), "easel-deploy-large-"));
    try {
      await writeFile(join(root, "big.bin"), randomBytes(3 * 1024 * 1024));
      await writeFile(join(root, "index.html"), "<h1>hi</h1>");
      const client = createCliClient("easel_test_token", baseUrl);
      await uploadDeployment(client, { root, project: "prj_fixture", target: "production" });

      expect(api.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
        "POST /api/v1/files/missing",
        "POST /api/v1/files",
        "POST /api/v1/files",
        `POST ${DEPLOYMENTS_PATH}`,
      ]);
      expect(api.uploaded.size).toBe(2);
      const body = JSON.parse(api.requests.at(-1)!.body.toString("utf8")) as {
        target: string;
        files: DeploymentFileRef[];
      };
      expect(body.target).toBe("production");
      expect(body.files.map((f) => f.file).sort()).toEqual(["big.bin", "index.html"]);
      expect(body.files.every((f) => api.uploaded.has(f.contentHash))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("sends --archive as one gzip tarball", async () => {
    const client = createCliClient("easel_test_token", baseUrl);
    await uploadDeployment(client, {
      root: fixtureRoot,
      project: "prj_fixture",
      target: "production",
      archive: true,
      meta: { appVersion: "42" },
    });

    expect(api.requests).toHaveLength(1);
    const [create] = api.requests;
    expect(create!.path).toBe(DEPLOYMENTS_PATH);
    expect(create!.query.get("target")).toBe("production");
    expect(create!.headers["content-type"]).toBe("application/gzip");
    expect(JSON.parse(String(create!.headers["x-easel-meta"]))).toEqual({ appVersion: "42" });
    const tar = gunzipSync(create!.body).toString("latin1");
    expect(tar).toContain("public/index.html");
    expect(tar).not.toContain("node_modules/");
  });
});
