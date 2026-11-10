import { describe, expect, it } from "vitest";
import { parseMetaArgs } from "./deploy.js";

describe("parseMetaArgs", () => {
  it("is undefined without --meta", () => {
    expect(parseMetaArgs(undefined)).toBeUndefined();
    expect(parseMetaArgs([])).toBeUndefined();
  });

  it("maps key=value pairs, keeping = in values", () => {
    expect(parseMetaArgs(["appVersion=42", "query=a=b", "empty="])).toEqual({
      appVersion: "42",
      query: "a=b",
      empty: "",
    });
  });

  it("rejects pairs without a key", () => {
    expect(() => parseMetaArgs(["novalue"])).toThrow(/expected key=value/);
    expect(() => parseMetaArgs(["=x"])).toThrow(/expected key=value/);
  });
});
