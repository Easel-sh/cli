import { readAuthConfig } from "./config.js";

export interface ResolvedCliCredentials {
  token: string;
  source: "flag" | "env" | "file";
}

export async function resolveToken(
  flagToken?: string,
): Promise<ResolvedCliCredentials | null> {
  const fromFlag = flagToken?.trim();
  if (fromFlag) {
    return { token: fromFlag, source: "flag" };
  }

  const fromEnv = process.env.EASEL_TOKEN?.trim();
  if (fromEnv) {
    return { token: fromEnv, source: "env" };
  }

  const auth = await readAuthConfig();
  const fromFile = auth?.token?.trim();
  if (fromFile) {
    return { token: fromFile, source: "file" };
  }

  return null;
}

export function requireTokenMessage(): string {
  return `Not authenticated. Run \`easel login\` or set EASEL_TOKEN.`;
}
