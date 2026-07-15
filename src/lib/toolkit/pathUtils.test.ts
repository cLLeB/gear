import { describe, expect, it } from "vitest";
import { basename, dirname, extname, joinPath } from "./pathUtils";

describe("pathUtils", () => {
  it("computes basename", () => {
    expect(basename("/usr/local/bin/node")).toBe("node");
    expect(basename("C:\\a\\b\\file.txt")).toBe("file.txt");
    expect(basename("file.test.ts", ".ts")).toBe("file.test");
  });

  it("computes dirname", () => {
    expect(dirname("/usr/local/bin")).toBe("/usr/local");
    expect(dirname("file.txt")).toBe(".");
    expect(dirname("/root")).toBe("/");
  });

  it("computes extname", () => {
    expect(extname("index.ts")).toBe(".ts");
    expect(extname(".bashrc")).toBe("");
    expect(extname("noext")).toBe("");
  });

  it("joins paths", () => {
    expect(joinPath("a", "b", "c")).toBe("a/b/c");
    expect(joinPath("a/", "/b/", "c")).toBe("a/b/c");
  });
});
