import { createClient, DEFAULT_BASE_URL, type EaselClient } from "@easel-sh/sdk";
import { CLI_VERSION } from "./version.js";

export type OutputFormat = "human" | "json";

export interface GlobalCliOptions {
  token?: string;
  format: OutputFormat;
  noColor: boolean;
}

/** `EASEL_API_URL`, or the hosted Easel app. */
export function getApiBaseUrl(): string {
  return (process.env.EASEL_API_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

/** The SDK client the CLI talks to Easel with. The `easel-cli/` user agent identifies CLI requests. */
export function createCliClient(token: string, baseUrl = getApiBaseUrl()): EaselClient {
  return createClient({ token, baseUrl, userAgent: `easel-cli/${CLI_VERSION}` });
}
