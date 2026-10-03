import { describe, expect, it } from "vitest";
import { findPathLinks, resolveLinkPath } from "./pathLinks";

const paths = (text: string) => findPathLinks(text).map((m) => [m.path, m.line, m.column]);

describe("findPathLinks", () => {
  it("finds path:line:col and path:line", () => {
    expect(paths("error at src/app.ts:12:5 and ./main.go:3")).toEqual([
      ["src/app.ts", 12, 5],
      ["./main.go", 3, null],
    ]);
  });

  it("finds tsc-style parenthesised locations", () => {
    expect(paths("src/a.ts(7,2): error TS1005")).toEqual([["src/a.ts", 7, 2]]);
  });

  it("finds absolute, home and windows paths", () => {
    expect(paths("see /etc/hosts or ~/notes.md or C:\\code\\x.rs:4")).toEqual([
      ["/etc/hosts", null, null],
      ["~/notes.md", null, null],
      ["C:\\code\\x.rs", 4, null],
    ]);
  });

  it("finds python traceback frames", () => {
    expect(paths('  File "pkg/core.py", line 41, in main')).toEqual([["pkg/core.py", 41, null]]);
  });

  it("trims sentence punctuation and keeps offsets right", () => {
    const text = "Edit README.md.";
    const [m] = findPathLinks(text);
    expect(m.path).toBe("README.md");
    expect(text.slice(m.start, m.end)).toBe("README.md");
  });

  it("ignores versions, urls, domains and plain words", () => {
    expect(paths("v1.2.3 1.2.3 https://x.dev/a.js example.com hello world")).toEqual([]);
  });

  it("covers the location suffix in the link range", () => {
    const text = "at lib/x.rs:10:2 end";
    const [m] = findPathLinks(text);
    expect(text.slice(m.start, m.end)).toBe("lib/x.rs:10:2");
  });
});

describe("resolveLinkPath", () => {
  it("resolves relative to cwd and expands ~", () => {
    expect(resolveLinkPath("./src/a.ts", "/repo/", "/home/me")).toBe("/repo/src/a.ts");
    expect(resolveLinkPath("~/x.md", "/repo", "/home/me")).toBe("/home/me/x.md");
    expect(resolveLinkPath("/abs", "/repo", null)).toBe("/abs");
    expect(resolveLinkPath("rel.ts", null, null)).toBeNull();
  });
});
