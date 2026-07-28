// Unified-diff support built on the Myers diff: generate a patch from two
// versions of a text, parse a unified diff back into structured hunks, and apply
// a patch to a source string. This underpins "apply suggested change" flows and
// review tooling without shelling out to `patch`/`git apply`.

import { diffLinesMyers } from "./myersDiff";

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Lines prefixed with " " (context), "-" (remove), "+" (add). */
  lines: string[];
}

export interface Patch {
  oldFile: string;
  newFile: string;
  hunks: Hunk[];
}

/** Produce a unified diff between two texts. `context` lines default to 3. */
export function createPatch(
  oldText: string,
  newText: string,
  { oldFile = "a", newFile = "b", context = 3 }: { oldFile?: string; newFile?: string; context?: number } = {},
): string {
  const diff = diffLinesMyers(oldText, newText);

  // Build tagged line list with old/new line numbers.
  type Tagged = { tag: " " | "-" | "+"; text: string };
  const tagged: Tagged[] = diff.map((e) => ({
    tag: e.op === "equal" ? " " : e.op === "delete" ? "-" : "+",
    text: e.value,
  }));

  // Group into hunks around runs of changes, padded by context.
  const hunks: Hunk[] = [];
  let i = 0;
  let oldLine = 1;
  let newLine = 1;
  const lineNums = tagged.map((t) => {
    const entry = { old: oldLine, new: newLine };
    if (t.tag !== "+") oldLine++;
    if (t.tag !== "-") newLine++;
    return entry;
  });

  while (i < tagged.length) {
    if (tagged[i].tag === " ") { i++; continue; }
    let start = i;
    while (start > 0 && tagged[start - 1].tag === " " && i - start < context) start--;
    let end = i;
    let trailingContext = 0;
    while (end < tagged.length && (tagged[end].tag !== " " || trailingContext < context)) {
      if (tagged[end].tag === " ") trailingContext++;
      else trailingContext = 0;
      end++;
    }

    const slice = tagged.slice(start, end);
    const oldCount = slice.filter((t) => t.tag !== "+").length;
    const newCount = slice.filter((t) => t.tag !== "-").length;
    hunks.push({
      oldStart: lineNums[start].old,
      oldLines: oldCount,
      newStart: lineNums[start].new,
      newLines: newCount,
      lines: slice.map((t) => t.tag + t.text),
    });
    i = end;
  }

  const header = `--- ${oldFile}\n+++ ${newFile}\n`;
  const body = hunks
    .map((h) => `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@\n${h.lines.join("\n")}`)
    .join("\n");
  return hunks.length ? header + body + "\n" : "";
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Parse a unified diff string into a structured patch. */
export function parsePatch(text: string): Patch {
  const lines = text.split("\n");
  const patch: Patch = { oldFile: "", newFile: "", hunks: [] };
  let current: Hunk | null = null;

  for (const line of lines) {
    if (line.startsWith("--- ")) patch.oldFile = line.slice(4);
    else if (line.startsWith("+++ ")) patch.newFile = line.slice(4);
    else if (line.startsWith("@@")) {
      const m = HUNK_RE.exec(line);
      if (m) {
        current = {
          oldStart: Number(m[1]),
          oldLines: m[2] ? Number(m[2]) : 1,
          newStart: Number(m[3]),
          newLines: m[4] ? Number(m[4]) : 1,
          lines: [],
        };
        patch.hunks.push(current);
      }
    } else if (current && (line.startsWith(" ") || line.startsWith("-") || line.startsWith("+"))) {
      current.lines.push(line);
    }
  }
  return patch;
}

export interface ApplyResult {
  ok: boolean;
  result: string;
  /** Index of the first hunk that failed to apply, if any. */
  failedHunk?: number;
}

/** Apply a unified diff (string or parsed) to a source text. */
export function applyPatch(source: string, patch: string | Patch): ApplyResult {
  const parsed = typeof patch === "string" ? parsePatch(patch) : patch;
  const srcLines = source.split("\n");
  const out: string[] = [];
  let cursor = 0; // 0-based index into srcLines

  parsed.hunks.forEach((hunk, hunkIndex) => {
    const target = hunk.oldStart - 1;
    // Copy untouched lines up to the hunk.
    while (cursor < target && cursor < srcLines.length) out.push(srcLines[cursor++]);

    for (const line of hunk.lines) {
      const tag = line[0];
      const content = line.slice(1);
      if (tag === " ") {
        if (srcLines[cursor] !== content) throw new PatchError(hunkIndex);
        out.push(srcLines[cursor++]);
      } else if (tag === "-") {
        if (srcLines[cursor] !== content) throw new PatchError(hunkIndex);
        cursor++;
      } else if (tag === "+") {
        out.push(content);
      }
    }
  });

  while (cursor < srcLines.length) out.push(srcLines[cursor++]);
  return { ok: true, result: out.join("\n") };
}

class PatchError extends Error {
  constructor(public readonly hunkIndex: number) {
    super(`Hunk ${hunkIndex} did not match the source`);
  }
}

/** Non-throwing variant of applyPatch. */
export function tryApplyPatch(source: string, patch: string | Patch): ApplyResult {
  try {
    return applyPatch(source, patch);
  } catch (error) {
    if (error instanceof PatchError) return { ok: false, result: source, failedHunk: error.hunkIndex };
    throw error;
  }
}
