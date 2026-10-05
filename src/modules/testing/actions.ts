// Palette commands for the test explorer.

import { toast } from "sonner";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { discover, frameworkFor } from "./model";
import { debugTest, discoverTests, rediscoverFile, resultKey, runTests, useTestingStore, type TestFile } from "./store";

function show(): void {
  window.dispatchEvent(new CustomEvent("gear:show-testing-panel"));
}

function activeTestFile(): { file: TestFile; line: number } | null {
  const ed = getActiveEditor();
  const path = ed?.path?.replace(/\\/g, "/");
  if (!ed || !path || !frameworkFor(path)) {
    toast.info("Open a test file first");
    return null;
  }
  let file = useTestingStore.getState().files.find((f) => f.path === path);
  if (!file) {
    rediscoverFile(path, ed.view.state.doc.toString());
    file = useTestingStore.getState().files.find((f) => f.path === path);
  }
  if (!file || !discover(file.framework, ed.view.state.doc.toString()).length) {
    toast.info("No tests found in this file");
    return null;
  }
  return { file, line: ed.view.state.doc.lineAt(ed.view.state.selection.main.head).number };
}

/** The innermost test or suite whose declaration is at or above the cursor. */
function testAtCursor(file: TestFile, line: number) {
  return [...file.tests].filter((t) => t.line <= line).sort((a, b) => b.line - a.line || b.suites.length - a.suites.length)[0] ?? null;
}

async function runAll(coverage = false): Promise<void> {
  if (!useTestingStore.getState().files.length) await discoverTests();
  const fws = [...new Set(useTestingStore.getState().files.map((f) => f.framework))];
  if (!fws.length) return void toast.info("No tests found in the workspace");
  show();
  for (const fw of fws) await runTests({ framework: fw, coverage });
}

async function rerunFailed(): Promise<void> {
  const s = useTestingStore.getState();
  const failed = s.files.flatMap((f) => f.tests.filter((t) => t.kind === "test" && s.results[resultKey(f.path, t.id)]?.status === "failed").map((t) => ({ f, t })));
  if (!failed.length) return void toast.info("No failed tests");
  // One run per file keeps it fast; single failures run just that test.
  const byFile = new Map<TestFile, typeof failed>();
  for (const x of failed) byFile.set(x.f, [...(byFile.get(x.f) ?? []), x]);
  for (const [f, xs] of byFile) await runTests(xs.length === 1 ? { file: f, test: xs[0].t } : { file: f });
}

export const TESTING_ACTIONS = [
  { id: "testing.runAll", label: "Testing: Run all tests", keywords: ["test", "run", "all", "suite", "vitest", "jest", "pytest", "go test", "cargo test"], run: () => void runAll() },
  { id: "testing.runFile", label: "Testing: Run tests in this file", keywords: ["test", "run", "file"], run: () => {
    const a = activeTestFile();
    if (a) void runTests({ file: a.file });
  } },
  { id: "testing.runAtCursor", label: "Testing: Run test at cursor", keywords: ["test", "run", "cursor", "this test", "single"], run: () => {
    const a = activeTestFile();
    const t = a && testAtCursor(a.file, a.line);
    if (a && t) void runTests({ file: a.file, test: t });
  } },
  { id: "testing.debugAtCursor", label: "Testing: Debug test at cursor", keywords: ["test", "debug", "cursor", "breakpoint"], run: () => {
    const a = activeTestFile();
    const t = a && testAtCursor(a.file, a.line);
    if (a && t) void debugTest(a.file, t);
  } },
  { id: "testing.rerunFailed", label: "Testing: Re-run failed tests", keywords: ["test", "failed", "rerun", "again"], run: () => void rerunFailed() },
  { id: "testing.coverage", label: "Testing: Run all tests with coverage", keywords: ["coverage", "lcov", "test", "istanbul", "pytest-cov"], run: () => void runAll(true) },
  { id: "testing.toggleCoverage", label: "Testing: Show / hide coverage in the editor", keywords: ["coverage", "gutter", "toggle", "highlight"], run: () => useTestingStore.setState((s) => ({ showCoverage: !s.showCoverage })) },
  { id: "testing.show", label: "Testing: Show test explorer", keywords: ["tests", "explorer", "panel", "testing"], run: show },
  { id: "testing.refresh", label: "Testing: Rediscover tests", keywords: ["tests", "refresh", "rescan", "discover"], run: () => void discoverTests() },
];
