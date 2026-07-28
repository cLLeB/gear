import { beforeEach, describe, expect, it } from "vitest";
import {
  allProblems,
  filesWithProblems,
  totals,
  useProblemsStore,
} from "./problemsStore";

const reset = () => useProblemsStore.getState().clearAll();

describe("problemsStore", () => {
  beforeEach(reset);

  it("analyzes a file and stores diagnostics", () => {
    const diags = useProblemsStore.getState().analyzeFile("a.json", "json", '{"a": }');
    expect(diags.length).toBeGreaterThan(0);
    expect(useProblemsStore.getState().byPath["a.json"]).toBeDefined();
  });

  it("removes the entry when a file becomes clean", () => {
    const store = useProblemsStore.getState();
    store.analyzeFile("a.json", "json", '{"a": }');
    store.analyzeFile("a.json", "json", '{"a": 1}\n');
    expect(useProblemsStore.getState().byPath["a.json"]).toBeUndefined();
  });

  it("aggregates totals across files", () => {
    const store = useProblemsStore.getState();
    store.analyzeFile("a.js", "javascript", "foo(");
    store.analyzeFile("b.js", "javascript", "bar[");
    const t = totals(useProblemsStore.getState().byPath);
    expect(t.error).toBeGreaterThanOrEqual(2);
  });

  it("flattens and sorts problems by severity", () => {
    const store = useProblemsStore.getState();
    store.setFileDiagnostics("x", "javascript", [
      { from: 0, to: 1, severity: "hint", message: "h", source: "t" },
      { from: 0, to: 1, severity: "error", message: "e", source: "t" },
    ]);
    const list = allProblems(useProblemsStore.getState().byPath);
    expect(list[0].diagnostic.severity).toBe("error");
  });

  it("lists files ordered by problem count", () => {
    const store = useProblemsStore.getState();
    store.setFileDiagnostics("few", "javascript", [
      { from: 0, to: 1, severity: "error", message: "", source: "t" },
    ]);
    store.setFileDiagnostics("many", "javascript", [
      { from: 0, to: 1, severity: "error", message: "", source: "t" },
      { from: 1, to: 2, severity: "warning", message: "", source: "t" },
    ]);
    expect(filesWithProblems(useProblemsStore.getState().byPath)[0].path).toBe("many");
  });

  it("clears individual files", () => {
    const store = useProblemsStore.getState();
    store.setFileDiagnostics("x", "javascript", [
      { from: 0, to: 1, severity: "error", message: "", source: "t" },
    ]);
    store.clearFile("x");
    expect(useProblemsStore.getState().byPath["x"]).toBeUndefined();
  });
});
