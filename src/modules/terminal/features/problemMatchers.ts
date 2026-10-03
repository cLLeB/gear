// Problem matchers: turn compiler, linter and test-runner output into a list
// of file locations — VS Code's task problem matchers, applied to whatever ran
// in the terminal. Each matcher recognises one tool's format; some are
// stateful (eslint prints the file once, then indented rows; rustc prints the
// message, then the location on a later `-->` line).

import { stripAnsi } from "@/lib/lang/ansi";

export type ProblemSeverity = "error" | "warning" | "info";

export interface Problem {
  file: string;
  line: number;
  column: number | null;
  severity: ProblemSeverity;
  message: string;
  /** Which matcher recognised it (tsc, rustc, gcc, …). */
  source: string;
}

const MAX_PROBLEMS = 500;

function sev(word: string | undefined): ProblemSeverity {
  const w = (word ?? "").toLowerCase();
  if (w.startsWith("warn")) return "warning";
  if (w === "note" || w === "info" || w === "hint") return "info";
  return "error";
}

const num = (s: string | undefined): number | null => {
  if (s === undefined) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
};

// A plausible source path: has an extension or a directory separator, and is
// not a URL. Keeps "Error: 12:30" style text from matching.
const PATH = String.raw`(?:[A-Za-z]:)?[^\s:()'"<>|*?]*[\w)\]-]\.[A-Za-z0-9]{1,10}`;

type LineMatcher = {
  source: string;
  re: RegExp;
  map: (m: RegExpMatchArray) => Omit<Problem, "source"> | null;
};

const LINE_MATCHERS: LineMatcher[] = [
  {
    // src/a.ts(12,5): error TS2322: Type 'x' is not assignable…
    source: "tsc",
    re: new RegExp(String.raw`^(${PATH})\((\d+),(\d+)\): (error|warning) (TS\d+: .*)$`),
    map: (m) => ({ file: m[1], line: +m[2], column: +m[3], severity: sev(m[4]), message: m[5] }),
  },
  {
    // src/a.ts:12:5 - error TS2322: … (tsc --pretty)
    source: "tsc",
    re: new RegExp(String.raw`^(${PATH}):(\d+):(\d+) - (error|warning) (TS\d+: .*)$`),
    map: (m) => ({ file: m[1], line: +m[2], column: +m[3], severity: sev(m[4]), message: m[5] }),
  },
  {
    // mypy: a.py:12: error: Incompatible types  [assignment]
    source: "mypy",
    re: /^([^\s:]+\.pyi?):(\d+): (error|warning|note): (.*)$/,
    map: (m) => ({ file: m[1], line: +m[2], column: null, severity: sev(m[3]), message: m[4] }),
  },
  {
    // gcc/clang/swift/go vet: file:12:5: error: msg   (also "fatal error")
    source: "gcc",
    re: new RegExp(String.raw`^(${PATH}):(\d+):(\d+): (?:fatal )?(error|warning|note): (.*)$`),
    map: (m) => ({ file: m[1], line: +m[2], column: +m[3], severity: sev(m[4]), message: m[5] }),
  },
  {
    // javac / kotlinc: Foo.java:12: error: msg
    source: "javac",
    re: new RegExp(String.raw`^(${PATH}):(\d+): (error|warning): (.*)$`),
    map: (m) => ({ file: m[1], line: +m[2], column: null, severity: sev(m[3]), message: m[4] }),
  },
  {
    // go build / go test: ./main.go:12:3: undefined: x
    source: "go",
    re: /^(\.{0,2}\/?[\w./-]+\.go):(\d+):(\d+): (.*)$/,
    map: (m) => ({ file: m[1], line: +m[2], column: +m[3], severity: "error", message: m[4] }),
  },
  {
    // pytest short tb: tests/test_x.py:12: AssertionError
    source: "pytest",
    re: /^([\w./\\-]+\.py):(\d+): (\w*(?:Error|Exception|Failed)\b.*)$/,
    map: (m) => ({ file: m[1], line: +m[2], column: null, severity: "error", message: m[3] }),
  },
  {
    // vitest / jest: "❯ src/a.test.ts:12:5" or " FAIL  src/a.test.ts > suite"
    source: "test",
    re: new RegExp(String.raw`^\s*(?:❯|›|>)\s+(${PATH}):(\d+):(\d+)\s*$`),
    map: (m) => ({ file: m[1], line: +m[2], column: +m[3], severity: "error", message: "Test failure" }),
  },
  {
    // Node / V8 stack frame inside the project: at fn (src/a.js:10:5)
    source: "stack",
    re: new RegExp(String.raw`^\s+at (?:.*? \()?(${PATH}):(\d+):(\d+)\)?$`),
    map: (m) =>
      m[1].includes("node_modules") || m[1].startsWith("node:") || m[1].startsWith("internal/")
        ? null
        : { file: m[1], line: +m[2], column: +m[3], severity: "error", message: "Stack frame" },
  },
];

/**
 * Extract problems from raw terminal output. ANSI styling is stripped first.
 * Results are de-duplicated by location+message and capped.
 */
export function matchProblems(output: string): Problem[] {
  const lines = stripAnsi(output).replace(/\r/g, "").split("\n");
  const out: Problem[] = [];
  const seen = new Set<string>();
  const push = (p: Problem) => {
    const key = `${p.file}:${p.line}:${p.column ?? ""}:${p.message}`;
    if (seen.has(key) || out.length >= MAX_PROBLEMS) return;
    seen.add(key);
    out.push(p);
  };

  let eslintFile: string | null = null;
  let rustPending: { severity: ProblemSeverity; message: string } | null = null;
  let pyFrame: { file: string; line: number } | null = null;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");

    // rustc / cargo: "error[E0308]: mismatched types" then "  --> src/main.rs:4:5"
    const rustHead = /^(error|warning)(?:\[(\w+)\])?: (.*)$/.exec(line);
    if (rustHead) {
      rustPending = {
        severity: sev(rustHead[1]),
        message: rustHead[2] ? `${rustHead[2]}: ${rustHead[3]}` : rustHead[3],
      };
      continue;
    }
    const rustLoc = /^\s*--> (.+?):(\d+):(\d+)$/.exec(line);
    if (rustLoc && rustPending) {
      push({ file: rustLoc[1], line: +rustLoc[2], column: +rustLoc[3], ...rustPending, source: "rustc" });
      rustPending = null;
      continue;
    }

    // Python traceback: remember the innermost frame, emit on the exception line.
    const pyLoc = /^\s*File "(.+?)", line (\d+)/.exec(line);
    if (pyLoc) {
      pyFrame = { file: pyLoc[1], line: +pyLoc[2] };
      continue;
    }
    if (pyFrame) {
      const exc = /^(\w+(?:\.\w+)*(?:Error|Exception|Exit|Interrupt|Warning)|\w+Error)(?::\s*(.*))?$/.exec(line);
      if (exc) {
        if (!pyFrame.file.startsWith("<")) {
          push({
            file: pyFrame.file,
            line: pyFrame.line,
            column: null,
            severity: "error",
            message: exc[2] ? `${exc[1]}: ${exc[2]}` : exc[1],
            source: "python",
          });
        }
        pyFrame = null;
        continue;
      }
    }

    // eslint stylish: a bare path line, then "  12:5  error  msg  rule"
    const eslintRow = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.*?)(?:\s{2,}([\w@/-]+))?$/.exec(line);
    if (eslintRow && eslintFile) {
      push({
        file: eslintFile,
        line: +eslintRow[1],
        column: +eslintRow[2],
        severity: sev(eslintRow[3]),
        message: eslintRow[5] ? `${eslintRow[4]} (${eslintRow[5]})` : eslintRow[4],
        source: "eslint",
      });
      continue;
    }
    if (new RegExp(String.raw`^(${PATH})$`).test(line) && !/^\s/.test(line)) {
      eslintFile = line;
      continue;
    }
    if (line.trim() === "") eslintFile = null;

    for (const m of LINE_MATCHERS) {
      const hit = m.re.exec(line);
      if (!hit) continue;
      const p = m.map(hit);
      if (p && num(String(p.line)) !== null) {
        push({ ...p, source: m.source });
        break;
      }
    }
  }
  return out;
}

/** Resolve a matched path against the directory the command ran in. */
export function resolveProblemPath(file: string, cwd: string | null): string {
  if (/^([A-Za-z]:[\\/]|\/|\\\\)/.test(file) || !cwd) return file;
  const sep = cwd.includes("\\") && !cwd.includes("/") ? "\\" : "/";
  const rel = file.replace(/^\.[\\/]/, "");
  return `${cwd.replace(/[\\/]+$/, "")}${sep}${rel}`;
}

export function summarizeProblems(problems: readonly Problem[]): string {
  const errors = problems.filter((p) => p.severity === "error").length;
  const warnings = problems.filter((p) => p.severity === "warning").length;
  const parts: string[] = [];
  if (errors) parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
  if (warnings) parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
  if (parts.length === 0) parts.push(`${problems.length} location${problems.length === 1 ? "" : "s"}`);
  return parts.join(", ");
}
