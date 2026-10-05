// Test explorer model: static test discovery for Vitest / Jest, pytest, Go
// and Rust, the commands that run a file or a single test, and parsers for
// each framework's machine-readable results and for coverage (lcov, Go cover
// profiles).

export type Framework = "vitest" | "jest" | "pytest" | "go" | "cargo";

export interface TestNode {
  /** Unique within the file: the names from the outermost suite down, joined by " › ". */
  id: string;
  name: string;
  /** Suite names enclosing it (outermost first). */
  suites: string[];
  line: number;
  kind: "test" | "suite";
}

export type TestStatus = "passed" | "failed" | "skipped" | "running" | "unknown";

export interface TestResult {
  /** File path as reported (absolute or repo-relative). */
  file: string | null;
  /** Full name: suites and test joined by " › ". */
  id: string;
  status: TestStatus;
  durationMs?: number;
  message?: string;
  /** 1-based line of the failure, when the framework reports one. */
  failureLine?: number;
}

const join = (parts: string[]) => parts.join(" › ");

/** Which framework a test file belongs to (by name and the project's markers). */
export function frameworkFor(path: string, markers: { vitest?: boolean; jest?: boolean } = {}): Framework | null {
  const p = path.replace(/\\/g, "/");
  if (/(^|\/)(test_[^/]*|[^/]*_test)\.py$/.test(p) || /\/tests?\/[^/]*\.py$/.test(p)) return "pytest";
  if (/_test\.go$/.test(p)) return "go";
  if (/\.rs$/.test(p)) return "cargo";
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(p) || /\/__tests__\/[^/]+\.[cm]?[jt]sx?$/.test(p)) return markers.jest && !markers.vitest ? "jest" : "vitest";
  return null;
}

// ── discovery ─────────────────────────────────────────────────────────────

function unquote(s: string): string {
  return s.slice(1, -1).replace(/\\(["'`\\])/g, "$1");
}

/** describe / it / test blocks in a JS/TS test file, with nesting from brace depth. */
export function discoverJs(source: string): TestNode[] {
  const out: TestNode[] = [];
  const stack: { name: string; depth: number }[] = [];
  let depth = 0;
  let line = 1;
  let i = 0;
  const call = /\b(describe|suite|context|it|test|bench)(?:\.(?:only|skip|todo|concurrent|each\([^)]*\)|sequential|fails))*\s*\(\s*(["'`])((?:\\.|(?!\2).)*)\2/y;
  while (i < source.length) {
    const c = source[i];
    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    // Skip comments and strings so braces inside them don't count.
    if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      const chunk = source.slice(i, end < 0 ? source.length : end + 2);
      line += chunk.split("\n").length - 1;
      i += chunk.length;
      continue;
    }
    if (/[A-Za-z]/.test(c) && !/[\w$.]/.test(source[i - 1] ?? "")) {
      call.lastIndex = i;
      const m = call.exec(source);
      if (m) {
        const name = unquote(`${m[2]}${m[3]}${m[2]}`);
        const suites = stack.map((s) => s.name);
        const isSuite = m[1] === "describe" || m[1] === "suite" || m[1] === "context";
        out.push({ id: join([...suites, name]), name, suites, line, kind: isSuite ? "suite" : "test" });
        if (isSuite) stack.push({ name, depth: depth + 1 });
        i += m[0].length;
        continue;
      }
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== c) {
        if (source[j] === "\\") j++;
        else if (source[j] === "\n") line++;
        j++;
      }
      i = j + 1;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      while (stack.length && depth < stack[stack.length - 1].depth) stack.pop();
    }
    i++;
  }
  return out;
}

/** pytest functions and Test* classes (one level of nesting). */
export function discoverPytest(source: string): TestNode[] {
  const out: TestNode[] = [];
  let cls: { name: string; indent: number } | null = null;
  source.split(/\r?\n/).forEach((text, i) => {
    const indent = /^\s*/.exec(text)![0].length;
    if (cls && text.trim() && indent <= cls.indent) cls = null;
    const c = /^(\s*)class\s+(Test\w*)\s*[:(]/.exec(text);
    if (c) {
      cls = { name: c[2], indent: c[1].length };
      out.push({ id: c[2], name: c[2], suites: [], line: i + 1, kind: "suite" });
      return;
    }
    const f = /^(\s*)(?:async\s+)?def\s+(test\w*)\s*\(/.exec(text);
    if (f) {
      const suites: string[] = cls && f[1].length > cls.indent ? [cls.name] : [];
      out.push({ id: join([...suites, f[2]]), name: f[2], suites, line: i + 1, kind: "test" });
    }
  });
  return out;
}

/** Go TestXxx / BenchmarkXxx / ExampleXxx / FuzzXxx functions. */
export function discoverGo(source: string): TestNode[] {
  const out: TestNode[] = [];
  source.split(/\r?\n/).forEach((text, i) => {
    const m = /^func\s+((?:Test|Benchmark|Fuzz|Example)\w*)\s*\(/.exec(text);
    if (m) out.push({ id: m[1], name: m[1], suites: [], line: i + 1, kind: "test" });
  });
  return out;
}

/** Rust #[test] / #[tokio::test] functions, with their enclosing `mod`s. */
export function discoverRust(source: string): TestNode[] {
  const out: TestNode[] = [];
  const mods: { name: string; depth: number }[] = [];
  let depth = 0;
  let pendingAttr = false;
  source.split(/\r?\n/).forEach((text, i) => {
    const t = text.trim();
    const mod = /^(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*\{/.exec(t);
    if (/^#\[(?:[\w:]+::)?test\b/.test(t) || /^#\[rstest\b/.test(t)) pendingAttr = true;
    const fn = /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/.exec(t);
    if (fn && pendingAttr) {
      const suites = mods.map((m) => m.name);
      out.push({ id: [...suites, fn[1]].join("::"), name: fn[1], suites, line: i + 1, kind: "test" });
      pendingAttr = false;
    } else if (fn) pendingAttr = false;
    if (mod) mods.push({ name: mod[1], depth: depth + 1 });
    for (const ch of text.replace(/"(?:\\.|[^"\\])*"|\/\/.*$/g, "")) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        while (mods.length && depth < mods[mods.length - 1].depth) mods.pop();
      }
    }
  });
  return out;
}

export function discover(framework: Framework, source: string): TestNode[] {
  switch (framework) {
    case "vitest":
    case "jest":
      return discoverJs(source);
    case "pytest":
      return discoverPytest(source);
    case "go":
      return discoverGo(source);
    case "cargo":
      return discoverRust(source);
  }
}

// ── commands ──────────────────────────────────────────────────────────────

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface RunSpec {
  framework: Framework;
  /** Path relative to the project root (forward slashes). */
  relFile?: string;
  test?: TestNode;
  /** Go: package dir relative to the root ("./pkg/x"). */
  goPackage?: string;
  /** Where results are written (absolute). */
  reportPath: string;
  coverage?: boolean;
  coveragePath?: string;
}

export interface RunCommand {
  /** argv; the shell layer quotes it. */
  argv: string[];
  /** Results come on stdout instead of a report file. */
  resultsOnStdout: boolean;
}

export function runCommand(spec: RunSpec): RunCommand {
  const t = spec.test;
  switch (spec.framework) {
    case "vitest": {
      const argv = ["npx", "vitest", "run", ...(spec.relFile ? [spec.relFile] : []), "--reporter=json", `--outputFile=${spec.reportPath}`];
      if (t) argv.push("-t", `^${escRe(join([...t.suites, t.name]).replace(/ › /g, " "))}${t.kind === "suite" ? " " : "$"}`);
      if (spec.coverage) argv.push("--coverage.enabled", "--coverage.reporter=lcov", `--coverage.reportsDirectory=${spec.coveragePath ?? "coverage"}`);
      return { argv, resultsOnStdout: false };
    }
    case "jest": {
      const argv = ["npx", "jest", ...(spec.relFile ? [spec.relFile] : []), "--json", `--outputFile=${spec.reportPath}`, "--testLocationInResults"];
      if (t) argv.push("-t", `^${escRe(join([...t.suites, t.name]).replace(/ › /g, " "))}${t.kind === "suite" ? " " : "$"}`);
      if (spec.coverage) argv.push("--coverage", "--coverageReporters=lcov", `--coverageDirectory=${spec.coveragePath ?? "coverage"}`);
      return { argv, resultsOnStdout: false };
    }
    case "pytest": {
      const target = spec.relFile ? (t ? `${spec.relFile}::${[...t.suites, t.name].join("::")}` : spec.relFile) : "";
      const argv = ["python", "-m", "pytest", ...(target ? [target] : []), "-q", `--junitxml=${spec.reportPath}`, "-o", "junit_family=xunit2"];
      if (spec.coverage) argv.push("--cov", "--cov-report", `lcov:${spec.coveragePath ?? "coverage/lcov.info"}`);
      return { argv, resultsOnStdout: false };
    }
    case "go": {
      const argv = ["go", "test", "-json", spec.goPackage ?? "./..."];
      if (t) argv.push("-run", `^${t.name}$`);
      if (spec.coverage) argv.push(`-coverprofile=${spec.coveragePath ?? "coverage.out"}`);
      return { argv, resultsOnStdout: true };
    }
    case "cargo": {
      const argv = ["cargo", "test"];
      if (t) argv.push(t.id, "--", "--exact", "--nocapture");
      return { argv, resultsOnStdout: true };
    }
  }
}

// ── result parsers ────────────────────────────────────────────────────────

/** Vitest / Jest JSON reporter output. */
export function parseJestJson(json: string): TestResult[] {
  const r = JSON.parse(json) as {
    testResults?: { name?: string; assertionResults?: { ancestorTitles?: string[]; title: string; status: string; duration?: number | null; failureMessages?: string[]; location?: { line: number } | null }[]; message?: string; status?: string }[];
  };
  const out: TestResult[] = [];
  for (const f of r.testResults ?? []) {
    const file = f.name ?? null;
    for (const a of f.assertionResults ?? []) {
      const msg = (a.failureMessages ?? []).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
      out.push({
        file,
        id: join([...(a.ancestorTitles ?? []), a.title]),
        status: a.status === "passed" ? "passed" : a.status === "failed" ? "failed" : a.status === "pending" || a.status === "skipped" || a.status === "todo" || a.status === "disabled" ? "skipped" : "unknown",
        durationMs: a.duration ?? undefined,
        ...(msg ? { message: msg } : {}),
        ...(msg && file ? { failureLine: lineFromStack(msg, file) } : {}),
      });
    }
    // A file that failed to load (syntax error) has no assertions.
    if (!f.assertionResults?.length && f.status === "failed" && f.message) out.push({ file, id: "(file)", status: "failed", message: f.message.replace(/\x1b\[[0-9;]*m/g, "") });
  }
  return out;
}

/** The first stack-trace line that points into `file`. */
export function lineFromStack(message: string, file: string): number | undefined {
  const base = file.replace(/\\/g, "/").replace(/^.*\//, "");
  const re = new RegExp(`${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:(\\d+)(?::\\d+)?`);
  const m = re.exec(message.replace(/\\/g, "/"));
  return m ? Number(m[1]) : undefined;
}

/** pytest JUnit XML (--junitxml). */
export function parseJunit(xml: string): TestResult[] {
  const out: TestResult[] = [];
  const attr = (s: string, k: string) => {
    const m = new RegExp(`\\b${k}="([^"]*)"`).exec(s);
    return m ? decodeXml(m[1]) : undefined;
  };
  for (const m of xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const head = m[1];
    const body = m[3] ?? "";
    const classname = attr(head, "classname") ?? "";
    const name = attr(head, "name") ?? "";
    // classname is "pkg.module.TestClass" or "pkg.module"; keep a trailing Test* class as the suite.
    const cls = /(?:^|\.)(Test\w*)$/.exec(classname)?.[1];
    const modulePath = (cls ? classname.slice(0, -cls.length - 1) : classname).replace(/\./g, "/");
    const file = attr(head, "file") ?? (modulePath ? `${modulePath}.py` : null);
    const fail = /<(failure|error)\b([^>]*)>([\s\S]*?)<\/\1>|<(failure|error)\b([^>]*)\/>/.exec(body);
    const skip = /<skipped\b/.test(body);
    const message = fail ? decodeXml(`${attr(fail[2] ?? fail[5] ?? "", "message") ?? ""}\n${fail[3] ?? ""}`).trim() : undefined;
    out.push({
      file,
      id: cls ? join([cls, name]) : name,
      status: fail ? "failed" : skip ? "skipped" : "passed",
      durationMs: attr(head, "time") ? Math.round(Number(attr(head, "time")) * 1000) : undefined,
      ...(message ? { message } : {}),
      ...(message ? { failureLine: Number(/:(\d+): (?:in |AssertionError|\w*Error)/.exec(message)?.[1]) || undefined } : {}),
    });
  }
  return out;
}

function decodeXml(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#10;/g, "\n").replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");
}

/** `go test -json` event stream. */
export function parseGoJson(stream: string): TestResult[] {
  const out = new Map<string, TestResult>();
  const output = new Map<string, string[]>();
  for (const line of stream.split(/\r?\n/)) {
    if (!line.startsWith("{")) continue;
    let e: { Action: string; Package?: string; Test?: string; Elapsed?: number; Output?: string };
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!e.Test) continue;
    const key = `${e.Package}|${e.Test}`;
    if (e.Action === "output" && e.Output) output.set(key, [...(output.get(key) ?? []), e.Output]);
    if (e.Action === "pass" || e.Action === "fail" || e.Action === "skip") {
      const text = (output.get(key) ?? []).join("");
      const loc = /^\s+([\w.-]+_test\.go):(\d+):/m.exec(text);
      out.set(key, {
        file: loc ? loc[1] : null,
        id: e.Test.replace(/\//g, " › "),
        status: e.Action === "pass" ? "passed" : e.Action === "fail" ? "failed" : "skipped",
        durationMs: e.Elapsed !== undefined ? Math.round(e.Elapsed * 1000) : undefined,
        ...(e.Action === "fail" ? { message: text.split("\n").filter((l) => !/^(=== RUN|--- FAIL|=== (PAUSE|CONT))/.test(l)).join("\n").trim() } : {}),
        ...(e.Action === "fail" && loc ? { failureLine: Number(loc[2]) } : {}),
      });
    }
  }
  return [...out.values()];
}

/** `cargo test` human output. */
export function parseCargo(output: string): TestResult[] {
  const out = new Map<string, TestResult>();
  for (const m of output.matchAll(/^test (\S+) \.\.\. (ok|FAILED|ignored)/gm)) {
    out.set(m[1], { file: null, id: m[1], status: m[2] === "ok" ? "passed" : m[2] === "FAILED" ? "failed" : "skipped" });
  }
  // Failure details: "---- path::name stdout ----" blocks.
  for (const m of output.matchAll(/^---- (\S+) stdout ----\n([\s\S]*?)(?=^---- |\n\nfailures:|^failures:)/gm)) {
    const r = out.get(m[1]);
    if (!r) continue;
    r.message = m[2].trim();
    const loc = /panicked at ([^:\n]+):(\d+):\d+/.exec(m[2]);
    if (loc) {
      r.file = loc[1];
      r.failureLine = Number(loc[2]);
    }
  }
  return [...out.values()];
}

// ── coverage ──────────────────────────────────────────────────────────────

export interface FileCoverage {
  /** line → hit count */
  lines: Map<number, number>;
  found: number;
  hit: number;
}

/** lcov tracefile → per-file line hits (paths as written in SF:). */
export function parseLcov(text: string): Map<string, FileCoverage> {
  const out = new Map<string, FileCoverage>();
  let cur: FileCoverage | null = null;
  let file = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("SF:")) {
      file = line.slice(3).replace(/\\/g, "/");
      cur = out.get(file) ?? { lines: new Map(), found: 0, hit: 0 };
      out.set(file, cur);
    } else if (line.startsWith("DA:") && cur) {
      const [ln, hits] = line.slice(3).split(",");
      const n = Number(ln);
      cur.lines.set(n, Math.max(cur.lines.get(n) ?? 0, Number(hits)));
    } else if (line === "end_of_record" && cur) {
      cur.found = cur.lines.size;
      cur.hit = [...cur.lines.values()].filter((h) => h > 0).length;
      cur = null;
    }
  }
  for (const c of out.values()) {
    c.found = c.lines.size;
    c.hit = [...c.lines.values()].filter((h) => h > 0).length;
  }
  return out;
}

/** Go cover profile (`-coverprofile`) → per-file line hits; paths are import paths. */
export function parseGoCover(text: string): Map<string, FileCoverage> {
  const out = new Map<string, FileCoverage>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^(.+\.go):(\d+)\.\d+,(\d+)\.\d+ \d+ (\d+)$/.exec(line.trim());
    if (!m) continue;
    const f = out.get(m[1]) ?? { lines: new Map(), found: 0, hit: 0 };
    out.set(m[1], f);
    for (let l = Number(m[2]); l <= Number(m[3]); l++) f.lines.set(l, Math.max(f.lines.get(l) ?? 0, Number(m[4])));
  }
  for (const c of out.values()) {
    c.found = c.lines.size;
    c.hit = [...c.lines.values()].filter((h) => h > 0).length;
  }
  return out;
}

/** Match a result to a discovered test (ids are compared without spacing differences). */
export function sameTest(a: string, b: string): boolean {
  const n = (s: string) => s.replace(/\s*›\s*/g, " › ").replace(/::/g, " › ").trim();
  return n(a) === n(b);
}
