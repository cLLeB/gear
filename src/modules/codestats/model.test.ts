import { describe, expect, it } from "vitest";
import { busFactor, byLanguage, churn, contributors, countLines, coupling, hotspots, isCounted, languageOf, LOG_MARK, logArgs, parseLog, weeklyActivity, type FileStat } from "./model";

const lang = (p: string) => {
  const l = languageOf(p);
  if (!l) throw new Error(p);
  return l;
};

describe("code stats", () => {
  it("knows languages by extension and file name", () => {
    expect(languageOf("src/a.tsx")?.name).toBe("TSX");
    expect(languageOf("Dockerfile")?.name).toBe("Dockerfile");
    expect(languageOf("x/Dockerfile.prod")?.name).toBe("Dockerfile");
    expect(languageOf("Makefile")?.name).toBe("Makefile");
    expect(languageOf("a.unknownext")).toBeNull();
    expect(languageOf("README")).toBeNull();
  });

  it("counts code, comment and blank lines", () => {
    const ts = ["// header", "", "const a = 1; // trailing", "/* block", "", " still */ const b = 2;", "/** doc */", "  ", "let c;"].join("\n");
    expect(countLines(ts, lang("a.ts"))).toEqual({ code: 3, comment: 4, blank: 2 });
    const py = ['"""Module doc.', "", 'More."""', "# comment", "x = 1", "", "def f():", "    return x  # inline"].join("\r\n");
    expect(countLines(py, lang("a.py"))).toEqual({ code: 3, comment: 4, blank: 1 });
    expect(countLines("<!-- a -->\n<div></div>\n<!--\nb\n-->", lang("a.html"))).toEqual({ code: 1, comment: 4, blank: 0 });
    expect(countLines("", lang("a.rs"))).toEqual({ code: 0, comment: 0, blank: 1 });
    expect(countLines("/* a */ /* b */\nx /* c */ y", lang("a.c"))).toEqual({ code: 1, comment: 1, blank: 0 });
  });

  it("sums by language", () => {
    const files: FileStat[] = [
      { path: "a.ts", language: "TypeScript", bytes: 10, code: 10, comment: 2, blank: 1 },
      { path: "b.ts", language: "TypeScript", bytes: 10, code: 5, comment: 0, blank: 0 },
      { path: "c.rs", language: "Rust", bytes: 10, code: 20, comment: 1, blank: 3 },
    ];
    expect(byLanguage(files)).toEqual([
      { language: "Rust", files: 1, code: 20, comment: 1, blank: 3 },
      { language: "TypeScript", files: 2, code: 15, comment: 2, blank: 1 },
    ]);
  });

  const log = [
    `${LOG_MARK}aaa\tAda\tADA@x.io\t1700000000`,
    "",
    "10\t2\tsrc/core.ts",
    "3\t1\tsrc/util.ts",
    "-\t-\tlogo.png",
    `${LOG_MARK}bbb\tBob\tbob@x.io\t1700086400`,
    "",
    "5\t5\tsrc/core.ts",
    "1\t0\tsrc/util.ts",
    `${LOG_MARK}ccc\tAda\tada@x.io\t1700172800`,
    "",
    "7\t0\tsrc/core.ts",
    "2\t2\tsrc/util.ts",
    "1\t1\tdocs/old.md",
    `${LOG_MARK}ddd\tAda\tada@x.io\t1700259200`,
    "",
    "1\t0\tsrc/core.ts",
  ].join("\n");

  it("reads git log --numstat", () => {
    expect(logArgs(90, 500)).toContain("--since=90.days");
    const commits = parseLog(log);
    expect(commits).toHaveLength(4);
    expect(commits[0]).toMatchObject({ sha: "aaa", author: "Ada", email: "ada@x.io", time: 1700000000000 });
    expect(commits[0].files).toEqual([
      { path: "src/core.ts", added: 10, deleted: 2 },
      { path: "src/util.ts", added: 3, deleted: 1 },
      { path: "logo.png", added: 0, deleted: 0 },
    ]);
  });

  it("measures churn, hotspots and ownership", () => {
    const commits = parseLog(log);
    const ch = churn(commits, (p) => p !== "docs/old.md");
    expect(ch.map((c) => [c.path, c.commits])).toEqual([
      ["src/core.ts", 4],
      ["src/util.ts", 3],
      ["logo.png", 1],
    ]);
    expect(ch[0]).toMatchObject({ added: 23, deleted: 7, lastChange: 1700259200000, authors: [{ name: "Ada", commits: 3 }, { name: "Bob", commits: 1 }] });
    const files = new Map<string, FileStat>([
      ["src/core.ts", { path: "src/core.ts", language: "TypeScript", bytes: 0, code: 400, comment: 0, blank: 0 }],
      ["src/util.ts", { path: "src/util.ts", language: "TypeScript", bytes: 0, code: 20, comment: 0, blank: 0 }],
    ]);
    const hs = hotspots(ch, files);
    expect(hs.map((h) => [h.path, h.score])).toEqual([
      ["src/core.ts", 100],
      ["src/util.ts", 38],
    ]);
    expect(hs[0]).toMatchObject({ ownership: 0.75, mainAuthor: "Ada", authors: 2, code: 400 });
    expect(busFactor(ch)).toBe(1);
  });

  it("finds files that change together", () => {
    const commits = parseLog(log);
    expect(coupling(commits, { minTogether: 3 })).toEqual([{ a: "src/core.ts", b: "src/util.ts", together: 3, degree: 1 }]);
    expect(coupling(commits, { minTogether: 3, maxFilesPerCommit: 2 })).toEqual([]);
    expect(coupling(commits, { minTogether: 1 }).find((c) => c.b === "src/util.ts" && c.a === "logo.png")).toMatchObject({ together: 1, degree: 1 });
  });

  it("lists contributors and weekly activity", () => {
    const commits = parseLog(log);
    expect(contributors(commits).map((c) => [c.name, c.commits, c.files])).toEqual([
      ["Ada", 3, 4],
      ["Bob", 1, 2],
    ]);
    const weeks = weeklyActivity(commits, 1700259200000 + 14 * 86400000);
    expect(weeks.reduce((a, w) => a + w.commits, 0)).toBe(4);
    expect(weeks.length).toBeGreaterThanOrEqual(3);
    for (const w of weeks) expect(new Date(w.week).getDay()).toBe(1);
    expect(weeklyActivity([])).toEqual([]);
  });

  it("skips generated and vendored files", () => {
    expect(isCounted("src/a.ts")).toBe(true);
    expect(isCounted("node_modules/x/a.js")).toBe(false);
    expect(isCounted("dist/app.min.js")).toBe(false);
    expect(isCounted("pnpm-lock.yaml")).toBe(false);
    expect(isCounted("types/global.d.ts")).toBe(false);
    expect(isCounted("logo.png")).toBe(false);
  });
});
