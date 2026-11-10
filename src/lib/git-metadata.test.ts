import { describe, expect, it } from "vitest";
import { parseRepository } from "./git-metadata.js";

describe("parseRepository", () => {
  it("reads owner/name from HTTPS and SSH remotes", () => {
    expect(parseRepository("https://github.com/acme/app.git")).toBe("acme/app");
    expect(parseRepository("https://github.com/acme/app")).toBe("acme/app");
    expect(parseRepository("git@github.com:acme/app.git")).toBe("acme/app");
    expect(parseRepository("ssh://git@gitlab.example.com/acme/app.git")).toBe("acme/app");
  });

  it("keeps dots in repository names", () => {
    expect(parseRepository("https://github.com/acme/next.js.git")).toBe("acme/next.js");
    expect(parseRepository("git@github.com:acme/next.js")).toBe("acme/next.js");
  });
});
