import type { Argv } from "yargs";
import type { DeploymentTarget, EaselClient } from "@easel-sh/sdk";
import { resolveToken, requireTokenMessage } from "./lib/auth.js";
import { createCliClient } from "./lib/client.js";
import { defaultOutputFormat } from "./lib/output.js";
import { loginCommand } from "./commands/login.js";
import { logoutCommand } from "./commands/logout.js";
import { whoamiCommand } from "./commands/whoami.js";
import { linkCommand } from "./commands/link.js";
import { listDeploymentsCommand } from "./commands/list-deployments.js";
import { inspectDeploymentCommand } from "./commands/inspect-deployment.js";
import { logsCommand } from "./commands/logs.js";
import { deployCommand } from "./commands/deploy.js";

const WORKSPACE_OPTION = {
  alias: "W",
  type: "string",
  describe: "Workspace to use when signing in or creating a project",
} as const;

async function withAuthenticatedClient<T>(
  argv: { token?: string; workspace?: string },
  run: (client: EaselClient) => Promise<T>,
  options?: { loginIfNeeded?: boolean },
): Promise<T> {
  let credentials = await resolveToken(argv.token);
  if (!credentials && options?.loginIfNeeded && process.stdin.isTTY) {
    console.error("You're not signed in. Opening your browser to sign in…");
    await loginCommand({ workspace: argv.workspace });
    credentials = await resolveToken(argv.token);
  }
  if (!credentials) {
    throw new Error(requireTokenMessage());
  }
  return run(createCliClient(credentials.token));
}

export function registerCommands(yargs: Argv): Argv {
  return yargs
    .option("token", {
      alias: "t",
      type: "string",
      describe: "API token (overrides EASEL_TOKEN and saved credentials)",
      global: true,
    })
    .option("format", {
      alias: "F",
      type: "string",
      choices: ["human", "json"] as const,
      default: defaultOutputFormat(),
      defaultDescription: "human in a terminal",
      describe: "Output format",
      global: true,
    })
    // `--no-color` is yargs' negation of `--color`.
    .option("color", {
      type: "boolean",
      default: true,
      describe: "ANSI colors (--no-color to disable)",
      global: true,
    })
    .command(
      "login",
      "Sign in with your browser and save credentials for one workspace",
      (yargsBuilder) => yargsBuilder.option("workspace", WORKSPACE_OPTION),
      async (argv) => {
        await loginCommand({ workspace: argv.workspace });
      },
    )
    .command(
      "logout",
      "Remove the credentials saved on this machine",
      () => undefined,
      async () => {
        await logoutCommand();
      },
    )
    .command(
      "whoami",
      "Show the current user and active workspace",
      () => undefined,
      async (argv) => {
        await withAuthenticatedClient(argv, async (client) => {
          await whoamiCommand(client, {
            token: argv.token,
            format: argv.format as "human" | "json",
            noColor: !argv.color,
          });
        });
      },
    )
    .command(
      "link",
      "Link the current directory (or monorepo) to Easel project(s)",
      (yargsBuilder) =>
        yargsBuilder
          .option("workspace", WORKSPACE_OPTION)
          .option("project", {
            type: "string",
            array: true,
            describe:
              "Project slug or ID (repeatable with --repo for multiple projects)",
          })
          .option("repo", {
            type: "boolean",
            default: false,
            describe:
              "Link the monorepo root to multiple projects (.easel/repo.json)",
          })
          .option("yes", {
            alias: "y",
            type: "boolean",
            default: false,
            describe: "Accept the defaults when setting up a new project",
          }),
      async (argv) => {
        await withAuthenticatedClient(argv, async (client) => {
          const projectArg = argv.project as string[] | undefined;
          await linkCommand(client, {
            token: argv.token,
            workspace: argv.workspace,
            format: argv.format as "human" | "json",
            noColor: !argv.color,
            project:
              projectArg == null
                ? undefined
                : projectArg.length === 1
                  ? projectArg[0]
                  : projectArg,
            repo: argv.repo as boolean,
            yes: argv.yes as boolean,
          });
        }, { loginIfNeeded: true });
      },
    )
    .command(
      "deploy",
      "Upload the current directory and create a deployment",
      (yargsBuilder) =>
        yargsBuilder
          .option("workspace", WORKSPACE_OPTION)
          .option("project", {
            type: "string",
            describe: "Project slug or ID (defaults to linked project)",
          })
          .option("prod", {
            type: "boolean",
            default: false,
            describe:
              "Deploy to production (default is preview, except a new project's first deployment, which goes to production)",
          })
          .option("yes", {
            alias: "y",
            type: "boolean",
            default: false,
            describe: "Skip confirmation prompts and accept setup defaults",
          })
          .option("wait", {
            type: "boolean",
            default: false,
            describe: "Wait until the deployment reaches a terminal status",
          })
          .option("timeout", {
            type: "string",
            default: "10m",
            describe: "Timeout for --wait (e.g. 5m, 30s)",
          })
          .option("archive", {
            type: "string",
            describe: "Send the source as one gzip tarball (--archive or --archive=tgz)",
            coerce: (value: string | undefined) => {
              if (value === undefined) return false;
              if (value === "" || value === "tgz") return true;
              throw new Error(`Unsupported --archive format: ${value} (only tgz)`);
            },
          })
          .option("meta", {
            alias: "m",
            type: "string",
            array: true,
            describe: "Attach key=value metadata to the deployment (repeatable)",
          }),
      async (argv) => {
        await withAuthenticatedClient(argv, async (client) => {
          await deployCommand(client, {
            token: argv.token,
            workspace: argv.workspace,
            format: argv.format as "human" | "json",
            noColor: !argv.color,
            project: argv.project as string | undefined,
            prod: argv.prod as boolean,
            yes: argv.yes as boolean,
            wait: argv.wait as boolean,
            timeout: argv.timeout as string,
            archive: argv.archive as boolean,
            meta: argv.meta as string[] | undefined,
          });
        }, { loginIfNeeded: true });
      },
    )
    .command(
      ["list [project]", "ls [project]"],
      "List deployments for a linked or specified project",
      (yargsBuilder) =>
        yargsBuilder
          .positional("project", {
            type: "string",
            describe: "Project slug or ID",
          })
          .option("status", {
            type: "string",
            describe: "Comma-separated statuses (READY,BUILDING,…)",
          })
          .option("environment", {
            type: "string",
            choices: ["production", "preview"] as const,
            describe: "Filter by deployment target",
          })
          .option("prod", {
            type: "boolean",
            describe: "Shorthand for --environment production",
          })
          .option("limit", {
            type: "number",
            describe: "Maximum number of deployments to return",
          })
          .option("cursor", {
            type: "string",
            describe: "Pagination cursor",
          }),
      async (argv) => {
        await withAuthenticatedClient(argv, async (client) => {
          await listDeploymentsCommand(client, {
            token: argv.token,
            format: argv.format as "human" | "json",
            noColor: !argv.color,
            project: argv.project as string | undefined,
            status: argv.status as string | undefined,
            environment: argv.environment as DeploymentTarget | undefined,
            prod: argv.prod as boolean | undefined,
            limit: argv.limit as number | undefined,
            cursor: argv.cursor as string | undefined,
          });
        });
      },
    )
    .command(
      "inspect <reference>",
      "Inspect a deployment by ID or URL",
      (yargsBuilder) =>
        yargsBuilder
          .positional("reference", {
            type: "string",
            demandOption: true,
            describe: "Deployment ID or deployment URL",
          })
          .option("logs", {
            alias: "l",
            type: "boolean",
            default: false,
            describe: "Print build logs",
          })
          .option("wait", {
            type: "boolean",
            default: false,
            describe: "Wait until the deployment reaches a terminal status",
          })
          .option("timeout", {
            type: "string",
            default: "10m",
            describe: "Timeout for --wait (e.g. 5m, 30s)",
          }),
      async (argv) => {
        await withAuthenticatedClient(argv, async (client) => {
          await inspectDeploymentCommand(client, argv.reference as string, {
            token: argv.token,
            format: argv.format as "human" | "json",
            noColor: !argv.color,
            logs: argv.logs as boolean,
            wait: argv.wait as boolean,
            timeout: argv.timeout as string,
          });
        });
      },
    )
    .command(
      "logs [reference]",
      "Show request logs for a linked project or stream live runtime logs",
      (yargsBuilder) =>
        yargsBuilder
          .positional("reference", {
            type: "string",
            describe: "Optional deployment ID or URL to filter by",
          })
          .option("follow", {
            alias: "f",
            type: "boolean",
            default: false,
            describe: "Poll for new request logs (live follow)",
          })
          .option("expand", {
            alias: "x",
            type: "boolean",
            default: false,
            describe: "Print function log lines for each request",
          })
          .option("project", {
            type: "string",
            describe: "Project slug or ID (defaults to linked project)",
          })
          .option("deployment", {
            type: "string",
            describe: "Deployment ID or URL filter",
          })
          .option("environment", {
            alias: "e",
            type: "string",
            choices: ["production", "preview"] as const,
            describe: "Filter by environment",
          })
          .option("status-code", {
            type: "string",
            describe: "Filter by status code or family (e.g. 500, 5xx)",
          })
          .option("level", {
            type: "string",
            describe: "Filter by console log level (warning,error,fatal)",
          })
          .option("query", {
            alias: "q",
            type: "string",
            describe: 'Filter query (e.g. path:"/api" method:GET)',
          })
          .option("request-id", {
            type: "string",
            describe: "Show logs for a specific request id",
          })
          .option("since", {
            type: "string",
            describe: "Include logs after this time (e.g. 1h, 30m, ISO; a bare number is minutes)",
          })
          .option("until", {
            type: "string",
            describe: "Include logs until this time (e.g. 1h, ISO; a bare number is minutes)",
          })
          .option("limit", {
            type: "number",
            describe: "Maximum number of requests to return",
          })
          .option("timeout", {
            type: "string",
            default: "5m",
            describe: "How long --follow should run (e.g. 5m, 30s)",
          }),
      async (argv) => {
        await withAuthenticatedClient(argv, async (client) => {
          await logsCommand(client, {
            token: argv.token,
            format: argv.format as "human" | "json",
            noColor: !argv.color,
            project: argv.project as string | undefined,
            deployment: argv.deployment as string | undefined,
            reference: argv.reference as string | undefined,
            follow: argv.follow as boolean,
            expand: argv.expand as boolean,
            environment: argv.environment as string | undefined,
            statusCode: argv["status-code"] as string | undefined,
            level: argv.level as string | undefined,
            query: argv.query as string | undefined,
            requestId: argv["request-id"] as string | undefined,
            since: argv.since as string | undefined,
            until: argv.until as string | undefined,
            limit: argv.limit as number | undefined,
            timeout: argv.timeout as string | undefined,
          });
        });
      },
    );
}
