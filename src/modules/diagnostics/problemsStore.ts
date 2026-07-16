// A zustand store that aggregates diagnostics across every open file, powering a
// VS Code-style "Problems" panel: severity totals in the status bar, a grouped
// list, and jump-to-location navigation. The editor pushes each file's
// diagnostics here after every analysis pass; the panel subscribes.

import { create } from "zustand";
import { countBySeverity, type Diagnostic, type Severity } from "./engine";
import { runDiagnostics } from "./index";

export interface FileProblems {
  path: string;
  languageId: string;
  diagnostics: Diagnostic[];
}

export interface ProblemLocation {
  path: string;
  diagnostic: Diagnostic;
}

type ProblemsState = {
  byPath: Record<string, FileProblems>;
  /** Replace the diagnostics for a file (removing the entry when empty). */
  setFileDiagnostics: (path: string, languageId: string, diagnostics: Diagnostic[]) => void;
  /** Analyze a document with the built-in engine and store the result. */
  analyzeFile: (path: string, languageId: string, source: string) => Diagnostic[];
  clearFile: (path: string) => void;
  clearAll: () => void;
};

export const useProblemsStore = create<ProblemsState>((set) => ({
  byPath: {},

  setFileDiagnostics(path, languageId, diagnostics) {
    set((s) => {
      const next = { ...s.byPath };
      if (diagnostics.length === 0) delete next[path];
      else next[path] = { path, languageId, diagnostics };
      return { byPath: next };
    });
  },

  analyzeFile(path, languageId, source) {
    const diagnostics = runDiagnostics(source, languageId);
    set((s) => {
      const next = { ...s.byPath };
      if (diagnostics.length === 0) delete next[path];
      else next[path] = { path, languageId, diagnostics };
      return { byPath: next };
    });
    return diagnostics;
  },

  clearFile(path) {
    set((s) => {
      if (!s.byPath[path]) return s;
      const next = { ...s.byPath };
      delete next[path];
      return { byPath: next };
    });
  },

  clearAll() {
    set({ byPath: {} });
  },
}));

// --- Pure selectors (usable with useProblemsStore(selector) or standalone) ---

/** Every diagnostic across all files, flattened, most-severe first. */
export function allProblems(byPath: Record<string, FileProblems>): ProblemLocation[] {
  const out: ProblemLocation[] = [];
  for (const file of Object.values(byPath)) {
    for (const diagnostic of file.diagnostics) out.push({ path: file.path, diagnostic });
  }
  const rank: Record<Severity, number> = { error: 0, warning: 1, info: 2, hint: 3 };
  return out.sort(
    (a, b) =>
      rank[a.diagnostic.severity] - rank[b.diagnostic.severity] ||
      a.path.localeCompare(b.path) ||
      a.diagnostic.from - b.diagnostic.from,
  );
}

/** Total counts by severity across all files. */
export function totals(byPath: Record<string, FileProblems>): Record<Severity, number> {
  return countBySeverity(Object.values(byPath).flatMap((f) => f.diagnostics));
}

/** Files that currently have at least one problem, sorted by error count. */
export function filesWithProblems(byPath: Record<string, FileProblems>): FileProblems[] {
  return Object.values(byPath).sort((a, b) => b.diagnostics.length - a.diagnostics.length);
}
