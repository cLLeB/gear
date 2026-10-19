import { describe, expect, it } from "vitest";
import { analyze, compilePattern, ownersOf, parseCodeowners, reviewersFor, unownedFolders } from "./model";

const m = (pattern: string, path: string) => compilePattern(pattern).test(path);

describe("CODEOWNERS", () => {
  it("matches patterns the way GitHub documents them", () => {
    expect(m("*", "a/b/c.txt")).toBe(true);
    expect(m("*.js", "src/deep/app.js")).toBe(true);
    expect(m("*.js", "src/app.ts")).toBe(false);
    expect(m("/build/logs/", "build/logs/x/y.log")).toBe(true);
    expect(m("/build/logs/", "app/build/logs/y.log")).toBe(false);
    expect(m("docs/*", "docs/getting-started.md")).toBe(true);
    expect(m("docs/*", "docs/build-app/troubleshooting.md")).toBe(false);
    expect(m("apps/", "x/apps/y/z.ts")).toBe(true);
    expect(m("apps/", "apps")).toBe(false);
    expect(m("/docs/", "docs/a.md")).toBe(true);
    expect(m("**/logs", "deep/logs/a.log")).toBe(true);
    expect(m("**/logs", "logs/a.log")).toBe(true);
    expect(m("/scripts/**", "scripts/a/b.sh")).toBe(true);
    expect(m("a/**/b", "a/x/y/b")).toBe(true);
    expect(m("a/**/b", "a/b")).toBe(true);
    expect(m("src/lib", "src/lib/util.ts")).toBe(true);
    expect(m("src/lib", "x/src/lib/util.ts")).toBe(false);
    expect(m("README.md", "pkg/README.md")).toBe(true);
    expect(m("file?.txt", "file1.txt")).toBe(true);
    expect(m("\\#notes.md", "#notes.md")).toBe(true);
  });

  it("parses rules, comments and problems", () => {
    const p = parseCodeowners(["# owners", "* @org/core", "*.js @alice # js", "!vendor/ @bob", "[abc].md @carol", "/docs/ alice@example.com not-an-owner", "/generated/"].join("\n"));
    expect(p.rules.map((r) => [r.line, r.pattern, r.owners])).toEqual([
      [2, "*", ["@org/core"]],
      [3, "*.js", ["@alice"]],
      [6, "/docs/", ["alice@example.com"]],
      [7, "/generated/", []],
    ]);
    expect(p.problems.map((x) => x.line)).toEqual([4, 5, 6]);
    expect(p.problems[0].message).toMatch(/^Negation \(!vendor\/\) is not supported/);
    expect(p.problems[1].message).toMatch(/^Character ranges/);
    expect(p.problems[2].message).toMatch(/^not-an-owner is not an owner/);
  });

  it("lets the last match win, and an owner-less rule leave files unowned", () => {
    const { rules } = parseCodeowners("* @core\n/src/ @web\n/src/vendor/\n");
    expect(ownersOf("README.md", rules).owners).toEqual(["@core"]);
    expect(ownersOf("src/app.ts", rules)).toMatchObject({ owners: ["@web"] });
    expect(ownersOf("src/vendor/x.js", rules).owners).toEqual([]);
    expect(ownersOf("src/vendor/x.js", rules).matches.map((r) => r.line)).toEqual([1, 2, 3]);
  });

  it("combines GitLab sections", () => {
    const { rules, sections } = parseCodeowners("[Backend] @backend\n*.go\n/internal/ @alice\n\n^[Docs][2] @writers\n*.md\n");
    expect(sections).toEqual(["Backend", "Docs"]);
    expect(ownersOf("internal/a.go", rules).owners).toEqual(["@alice"]);
    expect(ownersOf("cmd/README.md", rules).owners).toEqual(["@writers"]);
    expect(ownersOf("internal/README.md", rules).owners.sort()).toEqual(["@alice", "@writers"]);
  });

  it("finds unowned files, dead and shadowed rules, and owner counts", () => {
    const parsed = parseCodeowners(["/src/ @web", "*.ts @ts-team", "/src/legacy/ @old", "/nothing-here/ @ghost", "/src/legacy/ @new"].join("\n"));
    const a = analyze(["src/app.ts", "src/legacy/old.js", "README.md", "scripts/x.sh"], parsed);
    expect(a.owned).toBe(2);
    expect(a.unowned).toEqual(["README.md", "scripts/x.sh"]);
    expect(a.dead.map((r) => r.line)).toEqual([4]);
    expect(a.shadowed.map((s) => [s.rule.line, s.by.map((b) => b.line)])).toEqual([
      [1, [2, 5]],
      [3, [5]],
    ]);
    expect([...a.byOwner]).toEqual([
      ["@ts-team", 1],
      ["@new", 1],
    ]);
    expect(unownedFolders(["scripts/a/b.sh", "scripts/a/c.sh", "README.md", "x/y.txt"])).toEqual([
      { folder: "/scripts/a/", files: 2 },
      { folder: "/ (root files)", files: 1 },
      { folder: "/x/", files: 1 },
    ]);
  });

  it("lists the reviewers a change needs", () => {
    const { rules } = parseCodeowners("* @core\n/src/ @web @core\n/docs/ @writers\n/tmp/\n");
    expect(reviewersFor(["src/a.ts", "docs/b.md", "src/c.ts", "tmp/x"], rules)).toEqual({
      reviewers: [
        { owner: "@core", files: ["src/a.ts", "src/c.ts"] },
        { owner: "@web", files: ["src/a.ts", "src/c.ts"] },
        { owner: "@writers", files: ["docs/b.md"] },
      ],
      unowned: ["tmp/x"],
    });
  });
});
