import { describe, expect, it } from "vitest";
import { matchGlob } from "./glob";

describe("glob", () => {
  it("matches single-star within a segment", () => {
    expect(matchGlob("*.ts", "index.ts")).toBe(true);
    expect(matchGlob("*.ts", "src/index.ts")).toBe(false);
  });

  it("matches double-star across segments", () => {
    expect(matchGlob("src/**/*.ts", "src/a/b/index.ts")).toBe(true);
    expect(matchGlob("**/*.test.ts", "a/b/x.test.ts")).toBe(true);
  });

  it("matches ? as a single char", () => {
    expect(matchGlob("file?.txt", "file1.txt")).toBe(true);
    expect(matchGlob("file?.txt", "file10.txt")).toBe(false);
  });

  it("supports char classes and negation", () => {
    expect(matchGlob("[abc].js", "a.js")).toBe(true);
    expect(matchGlob("[!abc].js", "d.js")).toBe(true);
  });

  it("honours nocase", () => {
    expect(matchGlob("*.TS", "index.ts", { nocase: true })).toBe(true);
  });
});
