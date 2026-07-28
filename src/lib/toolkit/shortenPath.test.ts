import { describe, expect, it } from "vitest";
import { shortenPath } from "./shortenPath";

describe("shortenPath", () => {
  it("collapses the home directory", () => {
    expect(shortenPath("/home/dev/project", { home: "/home/dev" })).toBe("~/project");
  });

  it("collapses exact home", () => {
    expect(shortenPath("/home/dev", { home: "/home/dev" })).toBe("~");
  });

  it("normalises backslashes", () => {
    expect(shortenPath("C:\\Users\\dev\\a", { home: "C:/Users/dev" })).toBe("~/a");
  });

  it("truncates long paths", () => {
    const out = shortenPath("/a/very/long/nested/path/file.ts", { maxLength: 15 });
    expect(out.length).toBe(15);
    expect(out).toContain("…");
  });
});
