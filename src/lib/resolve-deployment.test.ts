import { describe, expect, it } from "vitest";
import { parseDeploymentReference } from "./resolve-deployment.js";

describe("parseDeploymentReference", () => {
  it("treats URLs as url references", () => {
    expect(
      parseDeploymentReference(
        "https://app.example.com",
      ),
    ).toEqual({
      kind: "url",
      value: "https://app.example.com",
    });
  });

  it("treats bare hostnames as url references", () => {
    expect(
      parseDeploymentReference("app.example.com"),
    ).toEqual({
      kind: "url",
      value: "app.example.com",
    });
  });

  it("treats deployment ids as id references", () => {
    expect(parseDeploymentReference("clxyz123deployment")).toEqual({
      kind: "id",
      value: "clxyz123deployment",
    });
  });
});
