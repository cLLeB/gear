import { describe, expect, it } from "vitest";
import { matchProblems, resolveProblemPath, summarizeProblems } from "./problemMatchers";

describe("matchProblems", () => {
  it("parses tsc (plain and pretty)", () => {
    const out = matchProblems(
      [
        "src/app.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.",
        "\x1b[96msrc/b.ts\x1b[0m:3:1 - \x1b[91merror\x1b[0m TS1005: ';' expected.",
      ].join("\n"),
    );
    expect(out).toEqual([
      expect.objectContaining({ file: "src/app.ts", line: 12, column: 5, severity: "error", source: "tsc" }),
      expect.objectContaining({ file: "src/b.ts", line: 3, column: 1, source: "tsc" }),
    ]);
  });

  it("parses rustc's two-line format", () => {
    const out = matchProblems(
      [
        "error[E0308]: mismatched types",
        " --> src/main.rs:4:18",
        "  |",
        "warning: unused variable: `x`",
        "  --> src/lib.rs:10:9",
      ].join("\n"),
    );
    expect(out).toEqual([
      expect.objectContaining({ file: "src/main.rs", line: 4, column: 18, message: "E0308: mismatched types", severity: "error" }),
      expect.objectContaining({ file: "src/lib.rs", line: 10, severity: "warning" }),
    ]);
  });

  it("parses gcc/clang and go", () => {
    const out = matchProblems(
      ["main.c:7:3: error: use of undeclared identifier 'y'", "./cmd/main.go:12:2: undefined: foo"].join("\n"),
    );
    expect(out.map((p) => [p.file, p.line, p.source])).toEqual([
      ["main.c", 7, "gcc"],
      ["./cmd/main.go", 12, "go"],
    ]);
  });

  it("parses eslint stylish output", () => {
    const out = matchProblems(
      [
        "/repo/src/a.js",
        "   3:10  error    'x' is defined but never used  no-unused-vars",
        "  12:1   warning  Unexpected console statement   no-console",
        "",
        "✖ 2 problems",
      ].join("\n"),
    );
    expect(out).toEqual([
      expect.objectContaining({ file: "/repo/src/a.js", line: 3, column: 10, message: "'x' is defined but never used (no-unused-vars)" }),
      expect.objectContaining({ line: 12, severity: "warning", source: "eslint" }),
    ]);
  });

  it("reports the innermost frame of a Python traceback", () => {
    const out = matchProblems(
      [
        "Traceback (most recent call last):",
        '  File "app.py", line 3, in <module>',
        "    main()",
        '  File "pkg/core.py", line 41, in main',
        "    raise ValueError('bad')",
        "ValueError: bad",
      ].join("\n"),
    );
    expect(out).toEqual([
      expect.objectContaining({ file: "pkg/core.py", line: 41, message: "ValueError: bad", source: "python" }),
    ]);
  });

  it("parses mypy and javac", () => {
    const out = matchProblems(
      ["a.py:12: error: Incompatible return value  [return-value]", "Foo.java:5: error: ';' expected"].join("\n"),
    );
    expect(out.map((p) => p.source)).toEqual(["mypy", "javac"]);
    expect(out[1].file).toBe("Foo.java");
  });

  it("keeps project stack frames and skips node_modules", () => {
    const out = matchProblems(
      [
        "TypeError: x is not a function",
        "    at run (/repo/src/run.js:10:5)",
        "    at Module._compile (node:internal/modules/cjs/loader:1256:14)",
        "    at lib (/repo/node_modules/lib/index.js:1:1)",
      ].join("\n"),
    );
    expect(out).toEqual([expect.objectContaining({ file: "/repo/src/run.js", line: 10, source: "stack" })]);
  });

  it("de-duplicates and ignores prose", () => {
    const line = "main.c:7:3: error: boom";
    expect(matchProblems(`${line}\n${line}\nBuild failed at 12:30: error count 1`)).toHaveLength(1);
  });
});

describe("resolveProblemPath", () => {
  it("joins relative paths onto the cwd", () => {
    expect(resolveProblemPath("./src/a.ts", "/repo/")).toBe("/repo/src/a.ts");
    expect(resolveProblemPath("src\\a.ts", "C:\\repo")).toBe("C:\\repo\\src\\a.ts");
  });
  it("leaves absolute paths alone", () => {
    expect(resolveProblemPath("/abs/a.ts", "/repo")).toBe("/abs/a.ts");
    expect(resolveProblemPath("C:/x/a.ts", "/repo")).toBe("C:/x/a.ts");
  });
});

describe("summarizeProblems", () => {
  it("counts by severity", () => {
    const p = (severity: "error" | "warning") => ({ file: "a", line: 1, column: null, severity, message: "", source: "x" });
    expect(summarizeProblems([p("error"), p("error"), p("warning")])).toBe("2 errors, 1 warning");
  });
});
