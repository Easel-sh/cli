import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import open from "open";
import { writeAuthConfig } from "../lib/config.js";
import { createCliClient, getApiBaseUrl } from "../lib/client.js";

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

function generateState(): string {
  return randomBytes(24).toString("base64url");
}

function shutdownServer(server: Server, timeout: NodeJS.Timeout): void {
  clearTimeout(timeout);
  server.closeAllConnections();
  server.close();
}

/**
 * Opens the browser to create an API key scoped to one workspace. Without
 * `workspace`, the browser asks which workspace to use.
 */
export async function loginCommand(options?: { workspace?: string }): Promise<void> {
  const state = generateState();

  const token = await new Promise<string>((resolve, reject) => {
    let settled = false;
    const server = createServer((req, res) => {
      if (!req.url?.startsWith("/callback")) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      const url = new URL(req.url, "http://127.0.0.1");
      const receivedState = url.searchParams.get("state");
      const receivedToken = url.searchParams.get("token");

      if (!receivedState || receivedState !== state) {
        res.statusCode = 400;
        res.end("Invalid state");
        if (!settled) {
          settled = true;
          shutdownServer(server, timeout);
          reject(new Error("Login failed: invalid state"));
        }
        return;
      }

      if (!receivedToken) {
        res.statusCode = 400;
        res.end("Missing token");
        if (!settled) {
          settled = true;
          shutdownServer(server, timeout);
          reject(new Error("Login failed: missing token"));
        }
        return;
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Connection", "close");
      res.end(
        "Login successful. You can close this tab and return to the terminal.",
        () => {
          if (!settled) {
            settled = true;
            shutdownServer(server, timeout);
            resolve(receivedToken);
          }
        },
      );
    });

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        shutdownServer(server, timeout);
        reject(new Error("Login timed out after 5 minutes"));
      }
    }, LOGIN_TIMEOUT_MS);
    timeout.unref();

    server.on("error", (error) => {
      if (!settled) {
        settled = true;
        shutdownServer(server, timeout);
        reject(error);
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        if (!settled) {
          settled = true;
          shutdownServer(server, timeout);
          reject(new Error("Failed to start local callback server"));
        }
        return;
      }

      const loginUrl = new URL("/cli/login", getApiBaseUrl());
      loginUrl.searchParams.set("port", String(address.port));
      loginUrl.searchParams.set("state", state);
      loginUrl.searchParams.set("hostname", hostname());
      if (options?.workspace) {
        loginUrl.searchParams.set("workspace", options.workspace);
      }

      console.error("Opening your browser to sign in…");
      console.error(`If the browser does not open, visit:\n${loginUrl.toString()}`);

      void open(loginUrl.toString()).then((subprocess) => {
        subprocess?.unref?.();
      });
    });
  });

  await writeAuthConfig({ token });

  try {
    const whoami = await createCliClient(token).whoami();

    await writeAuthConfig({
      token,
      userId: whoami.user.id,
      workspaceId: whoami.workspace.id,
      workspaceSlug: whoami.workspace.slug ?? undefined,
    });

    console.error(`Logged in as ${whoami.user.email}`);
    console.error(
      `Workspace: ${whoami.workspace.name} (${whoami.workspace.slug ?? whoami.workspace.id})`,
    );
  } catch {
    console.error("Logged in successfully.");
  }
}
