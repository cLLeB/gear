import { describe, expect, it } from "vitest";
import { expandBraces, GlobError, globToRegExp, matchGlob, parseGitignore } from "./glob";

describe("matchGlob", () => {
  it("matches * within a single path segment only", () => {
    expect(matchGlob("*.ts", "index.ts")).toBe(true);
    expect(matchGlob("*.ts", "src/index.ts")).toBe(false);
    expect(matchGlob("src/*.ts", "src/index.ts")).toBe(true);
  });

  it("matches ** across path segments", () => {
    expect(matchGlob("src/**/*.ts", "src/a/b/c.ts")).toBe(true);
    expect(matchGlob("**/*.test.ts", "deep/dir/foo.test.ts")).toBe(true);
    expect(matchGlob("src/**/*.ts", "src/index.ts")).toBe(true);
  });

  it("matches ? as a single non-separator character", () => {
    expect(matchGlob("file?.ts", "file1.ts")).toBe(true);
    expect(matchGlob("file?.ts", "file12.ts")).toBe(false);
  });

  it("supports character classes with negation", () => {
    expect(matchGlob("v[0-9].txt", "v3.txt")).toBe(true);
    expect(matchGlob("v[!0-9].txt", "va.txt")).toBe(true);
    expect(matchGlob("v[!0-9].txt", "v3.txt")).toBe(false);
  });

  it("expands brace alternation", () => {
    expect(matchGlob("*.{js,ts,tsx}", "app.tsx")).toBe(true);
    expect(matchGlob("*.{js,ts}", "app.py")).toBe(false);
  });
});

describe("expandBraces", () => {
  it("expands multiple and nested groups", () => {
    expect(expandBraces("a{1,2}b").sort()).toEqual(["a1b", "a2b"]);
    expect(expandBraces("{a,b}{1,2}").sort()).toEqual(["a1", "a2", "b1", "b2"]);
  });
});

describe("resource-exhaustion guards", () => {
  it("rejects a pattern with too many wildcards (ReDoS guard) quickly", () => {
    const evil = "**/".repeat(20) + "x";
    const start = Date.now();
    expect(() => globToRegExp(evil)).toThrow(GlobError);
    expect(Date.now() - start).toBeLessThan(200); // fails fast, does not hang
  });

  it("rejects a brace-expansion bomb", () => {
    const bomb = "{a,b,c,d,e,f,g,h,i,j}".repeat(8);
    expect(() => globToRegExp(bomb)).toThrow(GlobError);
  });

  it("skips a pathological .gitignore line instead of throwing", () => {
    const gi = parseGitignore(`*.log\n${"**/".repeat(40)}x\nbuild/\n`);
    expect(gi.ignores("app.log")).toBe(true); // good rules still apply
    expect(gi.ignores("build", true)).toBe(true);
  });
});

describe("parseGitignore", () => {
  it("ignores a basename anywhere in the tree", () => {
    const gi = parseGitignore("node_modules/\n*.log\n");
    expect(gi.ignores("node_modules", true)).toBe(true);
    expect(gi.ignores("packages/app/node_modules/react/index.js")).toBe(true);
    expect(gi.ignores("server.log")).toBe(true);
    expect(gi.ignores("src/index.ts")).toBe(false);
  });

  it("anchors a pattern with a leading slash to the root", () => {
    const gi = parseGitignore("/build\n");
    expect(gi.ignores("build/out.js")).toBe(true);
    expect(gi.ignores("src/build/out.js")).toBe(false);
  });

  it("restricts trailing-slash rules to directories", () => {
    const gi = parseGitignore("dist/\n");
    expect(gi.ignores("dist", true)).toBe(true);
    expect(gi.ignores("dist", false)).toBe(false); // a file literally named "dist"
    expect(gi.ignores("dist/bundle.js")).toBe(true);
  });

  it("lets a later negation re-include a path (last match wins)", () => {
    const gi = parseGitignore("*.log\n!important.log\n");
    expect(gi.ignores("debug.log")).toBe(true);
    expect(gi.ignores("important.log")).toBe(false);
  });

  it("skips blank lines and comments", () => {
    const gi = parseGitignore("# comment\n\n*.tmp\n");
    expect(gi.ignores("scratch.tmp")).toBe(true);
    expect(gi.ignores("comment")).toBe(false);
  });
});
