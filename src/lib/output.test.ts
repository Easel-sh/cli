import { describe, expect, it } from "vitest";
import { colorizeStatus, formatTable, stripAnsi } from "./output.js";

describe("formatTable", () => {
  const headers = ["ID", "STATUS", "URL"];

  it("pads columns to the widest cell", () => {
    expect(formatTable(headers, [["a", "READY", "https://a"], ["bbbb", "ERROR", "-"]])).toEqual([
      "ID    STATUS  URL",
      "a     READY   https://a",
      "bbbb  ERROR   -",
    ]);
  });

  it("aligns the same with and without color codes", () => {
    const plain = formatTable(headers, [["a", colorizeStatus("READY", false), "x"], ["b", colorizeStatus("BUILDING", false), "y"]]);
    const colored = formatTable(headers, [["a", colorizeStatus("READY", true), "x"], ["b", colorizeStatus("BUILDING", true), "y"]]);
    expect(colored.map(stripAnsi)).toEqual(plain);
  });
});
