// Per-line change kinds between a base version and the live buffer, for the
// editor's change gutter: VS Code's "dirty diff" markers.

import { diffLinesMyers } from "@/lib/lang/myersDiff";

export type ChangeKind = "added" | "modified" | "deleted";

export interface LineChange {
  /** 1-based line in the current document. For "deleted", the line after the removal. */
  line: number;
  kind: ChangeKind;
}

export function lineChanges(base: string, current: string): LineChange[] {
  const diff = diffLinesMyers(base, current);
  const out: LineChange[] = [];
  let line = 1; // current-document line of the next entry
  let i = 0;
  const currentLines = current.split("\n").length;
  while (i < diff.length) {
    if (diff[i].op === "equal") {
      line++;
      i++;
      continue;
    }
    let deletes = 0;
    let inserts = 0;
    while (i < diff.length && diff[i].op !== "equal") {
      if (diff[i].op === "delete") deletes++;
      else inserts++;
      i++;
    }
    const modified = Math.min(deletes, inserts);
    for (let k = 0; k < modified; k++) out.push({ line: line + k, kind: "modified" });
    for (let k = modified; k < inserts; k++) out.push({ line: line + k, kind: "added" });
    if (deletes > inserts) out.push({ line: Math.min(line + inserts, currentLines), kind: "deleted" });
    line += inserts;
  }
  return out;
}

/** Start lines of contiguous change hunks, for next/previous change navigation. */
export function hunkStarts(changes: readonly LineChange[]): number[] {
  const starts: number[] = [];
  let prev = -2;
  for (const c of [...changes].sort((a, b) => a.line - b.line)) {
    if (c.line !== prev + 1 && c.line !== prev) starts.push(c.line);
    prev = c.line;
  }
  return starts;
}
