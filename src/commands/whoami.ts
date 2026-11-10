import type { EaselClient } from "@easel-sh/sdk";
import type { GlobalCliOptions } from "../lib/client.js";
import { printJson, useColor } from "../lib/output.js";

export async function whoamiCommand(
  client: EaselClient,
  options: GlobalCliOptions,
): Promise<void> {
  const data = await client.whoami();

  if (options.format === "json") {
    printJson(data);
    return;
  }

  const color = useColor(options.noColor);
  console.log(color ? `\x1b[1mUser\x1b[0m` : "User");
  console.log(`  Email: ${data.user.email}`);
  console.log(`  Name:  ${data.user.name}`);
  console.log(`  ID:    ${data.user.id}`);

  console.log(color ? `\x1b[1mWorkspace\x1b[0m` : "Workspace");
  console.log(`  Name: ${data.workspace.name}`);
  console.log(`  Slug: ${data.workspace.slug ?? "(none)"}`);
  console.log(`  ID:   ${data.workspace.id}`);
}
