import { describe, expect, it } from "vitest";
import { parseBytes } from "./parseBytes";

describe("parseBytes", () => {
  it("parses decimal units", () => {
    expect(parseBytes("10MB")).toBe(10_000_000);
    expect(parseBytes("1.5 GB")).toBe(1_500_000_000);
  });

  it("parses binary units", () => {
    expect(parseBytes("1 KiB")).toBe(1024);
    expect(parseBytes("2MiB")).toBe(2_097_152);
  });

  it("treats bare numbers as bytes", () => {
    expect(parseBytes("512")).toBe(512);
  });

  it("rejects unknown units", () => {
    expect(parseBytes("5 furlongs")).toBeNull();
  });
});
