import type { Deployment, DeploymentResponse, EaselClient } from "@easel-sh/sdk";

function isDeploymentUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return true;
  }
  return trimmed.includes(".");
}

export function parseDeploymentReference(value: string): {
  kind: "id" | "url";
  value: string;
} {
  const trimmed = value.trim();
  if (isDeploymentUrl(trimmed)) {
    return { kind: "url", value: trimmed };
  }
  return { kind: "id", value: trimmed };
}

/** The deployment serving `url` (its own URL or one of its aliases). */
export async function fetchDeploymentByUrl(
  client: EaselClient,
  url: string,
): Promise<Deployment> {
  const data = await client.request<DeploymentResponse>("GET", "/v1/deployments/by-url", {
    query: { url },
  });
  return data.deployment;
}
