// The Testing sidebar view: every discovered test grouped by file and suite,
// with status, durations, run / debug buttons, failure details, a failed-only
// filter, coverage percentages and the last run's output.

import { useEffect, useMemo, useState } from "react";
import { app } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import { openTextViewer } from "@/modules/compare/CompareDialog";
import type { Framework, TestNode } from "./model";
import { clearCoverage, debugTest, discoverTests, resultKey, runTests, useTestingStore, type TestFile, type TestState } from "./store";

const ICON: Record<string, string> = { passed: "✓", failed: "✗", running: "◌", skipped: "○", unknown: "?" };
const COLOR: Record<string, string> = { passed: "text-green-600 dark:text-green-400", failed: "text-red-600 dark:text-red-400", running: "text-amber-500 animate-pulse", skipped: "text-muted-foreground", unknown: "text-muted-foreground" };

function fileStatus(f: TestFile, results: Record<string, TestState>): string | null {
  const st = f.tests.filter((t) => t.kind === "test").map((t) => results[resultKey(f.path, t.id)]?.status).filter(Boolean);
  if (!st.length) return null;
  if (st.includes("running")) return "running";
  if (st.includes("failed")) return "failed";
  return st.every((s) => s === "skipped") ? "skipped" : "passed";
}

function TestRow({ file, test, state }: { file: TestFile; test: TestNode; state?: TestState }) {
  const [open, setOpen] = useState(false);
  const running = useTestingStore((s) => !!s.running);
  return (
    <>
      <div className="group flex items-center gap-1.5 py-px pr-2 text-[11.5px] hover:bg-muted/50" style={{ paddingLeft: 22 + test.suites.length * 12 }}>
        <span className={cn("w-3 shrink-0 text-center text-[10px]", COLOR[state?.status ?? ""] ?? "text-muted-foreground/50")}>{state ? ICON[state.status] : "·"}</span>
        <button
          type="button"
          className={cn("min-w-0 flex-1 truncate text-left", test.kind === "suite" && "font-medium")}
          title={`${test.id}\nline ${test.line}`}
          onClick={() => (state?.status === "failed" && test.kind === "test" ? setOpen((o) => !o) : app().openFile(file.path, test.line))}
          onDoubleClick={() => app().openFile(file.path, state?.failureLine ?? test.line)}
        >
          {test.name}
        </button>
        {state?.durationMs !== undefined && test.kind === "test" ? <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{state.durationMs} ms</span> : null}
        <span className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100">
          <button type="button" title="Run" disabled={running} className="px-0.5 text-green-600 disabled:opacity-40 dark:text-green-400" onClick={() => void runTests({ file, test })}>
            ▶
          </button>
          <button type="button" title="Debug" className="px-0.5" onClick={() => void debugTest(file, test)}>
            🐞
          </button>
          <button type="button" title="Go to test" className="px-0.5" onClick={() => app().openFile(file.path, test.line)}>
            ↗
          </button>
        </span>
      </div>
      {open && state?.message ? (
        <pre className="mx-2 my-0.5 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-red-500/10 p-1.5 font-mono text-[10.5px] text-red-700 dark:text-red-300" style={{ marginLeft: 28 + test.suites.length * 12 }}>
          {state.message}
        </pre>
      ) : null}
    </>
  );
}

function FileGroup({ file, failedOnly }: { file: TestFile; failedOnly: boolean }) {
  const results = useTestingStore((s) => s.results);
  const cov = useTestingStore((s) => s.coverage);
  const [open, setOpen] = useState(true);
  const status = fileStatus(file, results);
  const tests = failedOnly ? file.tests.filter((t) => results[resultKey(file.path, t.id)]?.status === "failed") : file.tests;
  if (failedOnly && !tests.length) return null;
  const counts = file.tests.filter((t) => t.kind === "test");
  const pct = cov[file.path.replace(/\.(test|spec)(\.[^.]+)$/, "$2")]?.pct;
  return (
    <div>
      <div className="group flex items-center gap-1.5 px-2 py-0.5 text-[11.5px] hover:bg-muted/50">
        <button type="button" className="w-3 text-[9px] text-muted-foreground" onClick={() => setOpen((o) => !o)}>
          {open ? "▾" : "▸"}
        </button>
        <span className={cn("w-3 text-center text-[10px]", COLOR[status ?? ""] ?? "text-muted-foreground/50")}>{status ? ICON[status] : "·"}</span>
        <button type="button" className="min-w-0 flex-1 truncate text-left" title={file.rel} onClick={() => app().openFile(file.path)}>
          <span className="font-medium">{file.rel.replace(/^.*\//, "")}</span>
          <span className="ml-1 text-[10px] text-muted-foreground">{file.rel.replace(/\/?[^/]*$/, "")}</span>
        </button>
        {pct !== undefined ? <span className="text-[10px] text-muted-foreground" title="Line coverage of the code under test">{pct}%</span> : null}
        <span className="text-[10px] text-muted-foreground">{counts.length}</span>
        <button type="button" title="Run file" className="text-green-600 opacity-0 group-hover:opacity-100 dark:text-green-400" onClick={() => void runTests({ file })}>
          ▶
        </button>
      </div>
      {open ? tests.map((t) => <TestRow key={t.id} file={file} test={t} state={results[resultKey(file.path, t.id)]} />) : null}
    </div>
  );
}

export function TestPanel() {
  const files = useTestingStore((s) => s.files);
  const discovering = useTestingStore((s) => s.discovering);
  const running = useTestingStore((s) => s.running);
  const results = useTestingStore((s) => s.results);
  const coverage = useTestingStore((s) => s.coverage);
  const showCoverage = useTestingStore((s) => s.showCoverage);
  const [failedOnly, setFailedOnly] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!useTestingStore.getState().files.length) void discoverTests();
  }, []);

  const frameworks = useMemo(() => [...new Set(files.map((f) => f.framework))] as Framework[], [files]);
  const totals = useMemo(() => {
    const all = Object.entries(results).filter(([k]) => files.some((f) => k.startsWith(`${f.path}#`) && f.tests.find((t) => k === resultKey(f.path, t.id))?.kind === "test"));
    return { passed: all.filter(([, v]) => v.status === "passed").length, failed: all.filter(([, v]) => v.status === "failed").length, tests: files.reduce((n, f) => n + f.tests.filter((t) => t.kind === "test").length, 0) };
  }, [files, results]);
  const shown = query ? files.filter((f) => f.rel.toLowerCase().includes(query.toLowerCase()) || f.tests.some((t) => t.id.toLowerCase().includes(query.toLowerCase()))) : files;
  const btn = "rounded px-1.5 py-0.5 text-[11px] hover:bg-muted disabled:opacity-40";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/40 px-2">
        <span className="mr-1 text-[11.5px] font-semibold">Testing</span>
        {frameworks.map((fw) => (
          <button key={fw} type="button" className={cn(btn, "text-green-600 dark:text-green-400")} disabled={!!running} onClick={() => void runTests({ framework: fw })} title={`Run all ${fw} tests`}>
            ▶ {frameworks.length > 1 ? fw : "All"}
          </button>
        ))}
        <button type="button" className={btn} disabled={!!running || !frameworks.length} onClick={() => frameworks.forEach((fw) => void runTests({ framework: fw, coverage: true }))} title="Run with coverage">
          ☂ Coverage
        </button>
        <button type="button" className={btn} disabled={discovering} onClick={() => void discoverTests()} title="Rescan the workspace for tests">
          ⟳
        </button>
      </div>
      <div className="flex shrink-0 items-center gap-2 px-2 py-1 text-[11px]">
        <input className="min-w-0 flex-1 rounded border border-border/50 bg-transparent px-1.5 py-0.5" placeholder="Filter tests…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="flex items-center gap-1 text-muted-foreground">
          <input type="checkbox" checked={failedOnly} onChange={(e) => setFailedOnly(e.target.checked)} />
          failed
        </label>
      </div>
      <div className="flex shrink-0 items-center gap-2 px-3 pb-1 text-[10.5px] text-muted-foreground">
        {running ? <span className="text-amber-600 dark:text-amber-400">Running {running}…</span> : discovering ? <span>Discovering…</span> : <span>{totals.tests} tests in {files.length} files</span>}
        {totals.passed ? <span className="text-green-600 dark:text-green-400">✓ {totals.passed}</span> : null}
        {totals.failed ? <span className="text-red-600 dark:text-red-400">✗ {totals.failed}</span> : null}
        <span className="ml-auto flex gap-2">
          {Object.keys(coverage).length ? (
            <>
              <button type="button" className="hover:underline" onClick={() => useTestingStore.setState({ showCoverage: !showCoverage })}>
                {showCoverage ? "Hide" : "Show"} coverage
              </button>
              <button type="button" className="hover:underline" onClick={clearCoverage}>
                Clear
              </button>
            </>
          ) : null}
          <button type="button" className="hover:underline" onClick={() => openTextViewer("Test output", useTestingStore.getState().lastOutput || "(no run yet)", "log")}>
            Output
          </button>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto pb-2">
        {!files.length && !discovering ? (
          <div className="px-3 py-2 text-[11.5px] text-muted-foreground">No tests found. Gear finds Vitest / Jest (*.test.ts, *.spec.js, __tests__), pytest (test_*.py), Go (*_test.go) and Rust (#[test]) tests.</div>
        ) : null}
        {shown.map((f) => (
          <FileGroup key={f.path} file={f} failedOnly={failedOnly} />
        ))}
      </div>
    </div>
  );
}
