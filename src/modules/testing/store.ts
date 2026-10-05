// Test explorer state and runner: discovers tests in the workspace, runs a
// test / file / everything with the framework's machine-readable reporter,
// maps results back onto discovered tests, debugs a test with the debugger,
// and loads coverage for the editor gutter.

import { invoke } from "@tauri-apps/api/core";
import { appCacheDir } from "@tauri-apps/api/path";
import { toast } from "sonner";
import { create } from "zustand";
import { app } from "@/app/appBridge";
import { IS_WINDOWS } from "@/lib/platform";
import { quoteShellArg } from "@/lib/shellQuote";
import { native } from "@/modules/ai/lib/native";
import { pythonFor, resolveForWorkspace, startDebugging } from "@/modules/debug/store";
import { currentWorkspaceEnv } from "@/modules/workspace/env";
import {
  discover,
  frameworkFor,
  parseCargo,
  parseGoCover,
  parseGoJson,
  parseJestJson,
  parseJunit,
  parseLcov,
  runCommand,
  sameTest,
  type FileCoverage,
  type Framework,
  type TestNode,
  type TestResult,
  type TestStatus,
} from "./model";

export interface TestFile {
  path: string;
  rel: string;
  framework: Framework;
  root: string;
  tests: TestNode[];
}

export interface TestState {
  status: TestStatus;
  durationMs?: number;
  message?: string;
  failureLine?: number;
}

interface TestingStore {
  files: TestFile[];
  /** `${path}#${test.id}` → result */
  results: Record<string, TestState>;
  /** absolute path → coverage */
  coverage: Record<string, { lines: Record<number, number>; pct: number }>;
  showCoverage: boolean;
  discovering: boolean;
  running: string | null;
  lastOutput: string;
  filter: "all" | "failed";
}

export const useTestingStore = create<TestingStore>(() => ({
  files: [],
  results: {},
  coverage: {},
  showCoverage: true,
  discovering: false,
  running: null,
  lastOutput: "",
  filter: "all",
}));

const norm = (p: string) => p.replace(/\\/g, "/");
export const resultKey = (path: string, id: string) => `${norm(path)}#${id}`;

function exists(path: string): Promise<boolean> {
  return invoke("fs_stat", { path, workspace: currentWorkspaceEnv() }).then(
    () => true,
    () => false,
  );
}

/** Nearest ancestor of `file` (up to `stop`) containing one of `markers`. */
async function rootFor(file: string, markers: string[], stop: string): Promise<string> {
  let dir = norm(file).replace(/\/[^/]*$/, "");
  const top = norm(stop);
  for (;;) {
    for (const m of markers) if (await exists(`${dir}/${m}`)) return dir;
    if (dir === top || !dir.includes("/") || dir.length <= top.length) return top;
    dir = dir.replace(/\/[^/]*$/, "");
  }
}

const MARKERS: Record<Framework, string[]> = {
  vitest: ["vitest.config.ts", "vitest.config.mts", "vitest.config.js", "vite.config.ts", "vite.config.js", "package.json"],
  jest: ["jest.config.js", "jest.config.ts", "package.json"],
  pytest: ["pytest.ini", "pyproject.toml", "setup.cfg", "tox.ini", "conftest.py"],
  go: ["go.mod"],
  cargo: ["Cargo.toml"],
};

const GLOB = "**/{*.test.*,*.spec.*,__tests__/*.*,test_*.py,*_test.py,*_test.go,*.rs}";
const IGNORE = /(^|\/)(node_modules|dist|build|target|\.venv|venv|vendor|\.git|coverage)\//;

/** Scan the workspace for test files and their tests. */
export async function discoverTests(): Promise<void> {
  const root = app().workspaceRoot()?.replace(/[\\/]+$/, "");
  if (!root) return;
  useTestingStore.setState({ discovering: true });
  try {
    const pkg = await native.readFile(`${root}/package.json`).catch(() => null);
    const pkgText = pkg?.kind === "text" ? pkg.content : "";
    const markers = { vitest: /"vitest"/.test(pkgText), jest: /"jest"/.test(pkgText) };
    const g = await native.glob({ pattern: GLOB, root, maxResults: 5000 }).catch(() => null);
    const files: TestFile[] = [];
    const hits = (g?.hits ?? []).filter((h) => !IGNORE.test(norm(h.rel)) && /\.(test|spec)\.[cm]?[jt]sx?$|__tests__\/|test_[^/]*\.py$|_test\.py$|_test\.go$|\.rs$/.test(norm(h.rel)));
    for (let i = 0; i < hits.length; i += 32) {
      const batch = hits.slice(i, i + 32);
      const texts = await Promise.all(batch.map((h) => native.readFile(h.path).catch(() => null)));
      for (let k = 0; k < batch.length; k++) {
        const t = texts[k];
        if (t?.kind !== "text") continue;
        const fw = frameworkFor(batch[k].rel, markers);
        if (!fw) continue;
        if (fw === "cargo" && !/#\[(?:[\w:]+::)?test\b/.test(t.content)) continue;
        const tests = discover(fw, t.content);
        if (!tests.length) continue;
        files.push({ path: norm(batch[k].path), rel: norm(batch[k].rel), framework: fw, root, tests });
      }
    }
    // Per-file project roots (monorepos) are resolved lazily at run time.
    files.sort((a, b) => a.rel.localeCompare(b.rel));
    useTestingStore.setState({ files });
  } finally {
    useTestingStore.setState({ discovering: false });
  }
}

/** Re-discover one file after it's saved / edited. */
export function rediscoverFile(path: string, source: string): void {
  const p = norm(path);
  const s = useTestingStore.getState();
  const existing = s.files.find((f) => f.path === p);
  const fw = existing?.framework ?? frameworkFor(p);
  if (!fw) return;
  const tests = discover(fw, source);
  const root = existing?.root ?? app().workspaceRoot()?.replace(/[\\/]+$/, "") ?? "";
  const rest = s.files.filter((f) => f.path !== p);
  useTestingStore.setState({ files: tests.length ? [...rest, { path: p, rel: existing?.rel ?? p.slice(root.length + 1), framework: fw, root, tests }].sort((a, b) => a.rel.localeCompare(b.rel)) : rest });
}

function shellLine(argv: string[]): string {
  const [exe, ...rest] = argv;
  const head = /^[\w.-]+$/.test(exe) ? exe : `${IS_WINDOWS ? "& " : ""}${quoteShellArg(exe)}`;
  return [head, ...rest.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : quoteShellArg(a)))].join(" ");
}

function applyResults(file: TestFile | null, framework: Framework, root: string, results: TestResult[], scope: TestFile[]): number {
  const updates: Record<string, TestState> = {};
  let matched = 0;
  for (const r of results) {
    // Match a result to a discovered file: reported path, else the only file in scope with that test id.
    const rp = r.file ? norm(r.file) : null;
    const candidates = scope.filter((f) => f.framework === framework && (!rp || f.path === rp || f.path.endsWith(`/${rp.replace(/^\.\//, "")}`) || norm(`${root}/${rp}`) === f.path));
    for (const f of candidates.length ? candidates : file ? [file] : []) {
      const t = f.tests.find((x) => sameTest(x.id, r.id) || (framework === "cargo" && r.id.endsWith(`::${x.name}`) && sameTest(r.id.split("::").slice(-1 - x.suites.length).join("::"), x.id)));
      if (!t) continue;
      updates[resultKey(f.path, t.id)] = { status: r.status, durationMs: r.durationMs, message: r.message, failureLine: r.failureLine };
      matched++;
      break;
    }
  }
  // Suites take the worst status of their children.
  for (const f of scope) {
    for (const s of f.tests.filter((t) => t.kind === "suite")) {
      const kids = f.tests.filter((t) => t.kind === "test" && t.id.startsWith(`${s.id} › `)).map((t) => updates[resultKey(f.path, t.id)]?.status).filter(Boolean);
      if (kids.length) updates[resultKey(f.path, s.id)] = { status: kids.includes("failed") ? "failed" : kids.every((k) => k === "skipped") ? "skipped" : "passed" };
    }
  }
  useTestingStore.setState((st) => ({ results: { ...st.results, ...updates } }));
  return matched;
}

function markRunning(files: TestFile[], test?: TestNode): void {
  const updates: Record<string, TestState> = {};
  for (const f of files) for (const t of f.tests) if (!test || t.id === test.id || t.id.startsWith(`${test.id} › `)) updates[resultKey(f.path, t.id)] = { status: "running" };
  useTestingStore.setState((st) => ({ results: { ...st.results, ...updates } }));
}

/** Run one test, one file, or every discovered test of a framework. */
export async function runTests(target: { file?: TestFile; test?: TestNode; framework?: Framework; coverage?: boolean }): Promise<void> {
  const st = useTestingStore.getState();
  if (st.running) return void toast.info("Tests are already running");
  const file = target.file ?? null;
  const framework = file?.framework ?? target.framework;
  if (!framework) return;
  const ws = app().workspaceRoot()?.replace(/[\\/]+$/, "") ?? "";
  const root = await rootFor(file?.path ?? `${ws}/x`, MARKERS[framework], ws);
  const scope = file ? [file] : st.files.filter((f) => f.framework === framework);
  const label = target.test ? target.test.name : file ? file.rel : `all ${framework} tests`;
  useTestingStore.setState({ running: label });
  markRunning(scope, target.test);
  const cache = norm(await appCacheDir().catch(() => `${root}/.gear`));
  const stamp = Date.now();
  const reportPath = `${cache}/test-reports/${stamp}.${framework === "pytest" ? "xml" : "json"}`;
  const coveragePath = framework === "pytest" ? `${cache}/test-reports/${stamp}.lcov` : framework === "go" ? `${cache}/test-reports/${stamp}.cover` : `${cache}/test-reports/cov-${stamp}`;
  await native.createDir(`${cache}/test-reports`).catch(() => {});
  const relFile = file ? (file.path.startsWith(`${root}/`) ? file.path.slice(root.length + 1) : file.path) : undefined;
  const goPackage = file && framework === "go" ? `./${(relFile ?? "").replace(/\/?[^/]*$/, "") || "."}`.replace(/^\.\/\.$/, ".") : undefined;
  const cmd = runCommand({ framework, relFile: framework === "go" ? undefined : relFile, test: target.test, goPackage, reportPath, coverage: target.coverage, coveragePath });
  if (framework === "pytest") {
    const py = await pythonFor(root);
    if (py) cmd.argv[0] = py;
  }
  const line = shellLine(cmd.argv);
  try {
    const out = await native.runCommand(line, root, 1800);
    const text = `$ ${line}\n${out.stdout}${out.stderr ? `\n${out.stderr}` : ""}`;
    useTestingStore.setState({ lastOutput: text });
    let results: TestResult[] = [];
    if (cmd.resultsOnStdout) results = framework === "go" ? parseGoJson(out.stdout) : parseCargo(`${out.stdout}\n${out.stderr}`);
    else {
      const r = await native.readFile(reportPath).catch(() => null);
      if (r?.kind === "text") results = framework === "pytest" ? parseJunit(r.content) : parseJestJson(r.content);
    }
    // A single-test run reports the rest of the file as skipped; keep their previous status.
    if (target.test) {
      const id = target.test.id;
      results = results.filter((r) => sameTest(r.id, id) || r.id.replace(/::/g, " › ").startsWith(`${id} › `) || (framework === "cargo" && r.id.endsWith(`::${target.test!.name}`)));
    }
    const matched = applyResults(file, framework, root, results, scope);
    // Anything still "running" didn't report — show it as unknown.
    useTestingStore.setState((s) => ({ results: Object.fromEntries(Object.entries(s.results).map(([k, v]) => [k, v.status === "running" ? { status: "unknown" as TestStatus } : v])) }));
    const failed = results.filter((r) => r.status === "failed").length;
    const passed = results.filter((r) => r.status === "passed").length;
    if (!results.length) toast.error(`No test results from ${framework}`, { description: (out.stderr || out.stdout).trim().split("\n").slice(-6).join("\n").slice(0, 500) });
    else if (failed) toast.error(`${failed} failed, ${passed} passed`, { description: label });
    else toast.success(`${passed} passed`, { description: label });
    if (matched < results.length && results.length) console.info(`[gear] ${results.length - matched} test result(s) didn't match discovered tests`);
    if (target.coverage) await loadCoverage(framework, root, coveragePath);
  } catch (e) {
    toast.error("Couldn't run tests", { description: String(e) });
    useTestingStore.setState((s) => ({ results: Object.fromEntries(Object.entries(s.results).map(([k, v]) => [k, v.status === "running" ? { status: "unknown" as TestStatus } : v])) }));
  } finally {
    useTestingStore.setState({ running: null });
  }
}

async function loadCoverage(framework: Framework, root: string, path: string): Promise<void> {
  let raw: Map<string, FileCoverage> | null = null;
  if (framework === "go") {
    const r = await native.readFile(path).catch(() => null);
    if (r?.kind === "text") {
      // Profile paths are import paths: map the module prefix back to the root.
      const mod = await native.readFile(`${root}/go.mod`).catch(() => null);
      const name = mod?.kind === "text" ? /^module\s+(\S+)/m.exec(mod.content)?.[1] : null;
      raw = new Map([...parseGoCover(r.content)].map(([f, c]) => [name && f.startsWith(`${name}/`) ? `${root}/${f.slice(name.length + 1)}` : f, c]));
    }
  } else {
    const lcovPath = framework === "pytest" ? path : `${path}/lcov.info`;
    const r = await native.readFile(lcovPath).catch(() => null);
    if (r?.kind === "text") raw = new Map([...parseLcov(r.content)].map(([f, c]) => [/^([a-zA-Z]:)?\//.test(f) ? norm(f) : `${root}/${f}`, c]));
  }
  if (!raw?.size) return void toast.info("No coverage data was produced", { description: framework === "pytest" ? "Install pytest-cov (pip install pytest-cov)" : framework === "vitest" ? "Install @vitest/coverage-v8" : framework === "cargo" ? "Rust coverage needs cargo-llvm-cov" : undefined });
  const coverage: TestingStore["coverage"] = {};
  for (const [f, c] of raw) coverage[norm(f)] = { lines: Object.fromEntries(c.lines), pct: c.found ? Math.round((c.hit / c.found) * 1000) / 10 : 0 };
  useTestingStore.setState({ coverage, showCoverage: true });
  const total = [...raw.values()].reduce((a, c) => ({ f: a.f + c.found, h: a.h + c.hit }), { f: 0, h: 0 });
  toast.success(`Coverage ${total.f ? ((total.h / total.f) * 100).toFixed(1) : 0}% of ${total.f} lines`);
}

/** Debug a single test with the debugger. */
export async function debugTest(file: TestFile, test: TestNode): Promise<void> {
  const ws = app().workspaceRoot()?.replace(/[\\/]+$/, "") ?? "";
  const root = await rootFor(file.path, MARKERS[file.framework], ws);
  const rel = file.path.startsWith(`${root}/`) ? file.path.slice(root.length + 1) : file.path;
  const full = [...test.suites, test.name];
  let cfg: Record<string, unknown> & { name: string; type: string; request: "launch" };
  switch (file.framework) {
    case "pytest":
      cfg = { name: `Debug ${test.name}`, type: "python", request: "launch", module: "pytest", args: [`${rel}::${full.join("::")}`, "-q", "-s"], cwd: root, justMyCode: false };
      break;
    case "vitest":
      cfg = { name: `Debug ${test.name}`, type: "node", request: "launch", program: `${root}/node_modules/vitest/vitest.mjs`, args: ["run", rel, "-t", full.join(" "), "--no-file-parallelism", "--testTimeout=0"], cwd: root, autoAttachChildProcesses: true, skipFiles: ["<node_internals>/**", "**/node_modules/**"] };
      break;
    case "jest":
      cfg = { name: `Debug ${test.name}`, type: "node", request: "launch", program: `${root}/node_modules/jest/bin/jest.js`, args: [rel, "-t", full.join(" "), "--runInBand"], cwd: root, skipFiles: ["<node_internals>/**", "**/node_modules/**"] };
      break;
    case "go":
      cfg = { name: `Debug ${test.name}`, type: "go", request: "launch", mode: "test", program: file.path.replace(/\/[^/]*$/, ""), args: ["-test.run", `^${test.name}$`] };
      break;
    default:
      return void toast.info("Debugging Rust tests: build with `cargo test --no-run` and debug the test binary from launch.json");
  }
  try {
    await startDebugging(await resolveForWorkspace(cfg));
  } catch (e) {
    toast.error(String(e instanceof Error ? e.message : e));
  }
}

export function clearCoverage(): void {
  useTestingStore.setState({ coverage: {} });
}
