import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveToken } from "./auth.js";

describe("resolveToken", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers --token over environment and file", async () => {
    vi.stubEnv("EASEL_TOKEN", "env-token");
    const resolved = await resolveToken("flag-token");
    expect(resolved).toEqual({ token: "flag-token", source: "flag" });
  });

  it("uses EASEL_TOKEN when flag is absent", async () => {
    vi.stubEnv("EASEL_TOKEN", "env-token");
    const resolved = await resolveToken();
    expect(resolved).toEqual({ token: "env-token", source: "env" });
  });
});
