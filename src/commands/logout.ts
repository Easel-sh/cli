import { clearAuthConfig } from "../lib/config.js";

export async function logoutCommand(): Promise<void> {
  await clearAuthConfig();
  console.error("Removed the credentials saved on this machine.");
  console.error("The token still works until you revoke it under Settings → Access Tokens.");
}
