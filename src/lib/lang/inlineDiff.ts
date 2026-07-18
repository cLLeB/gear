// Word- and character-level inline diffing. The existing Myers diff works at
// line granularity — great for "which lines changed", useless for showing *what*
// changed within a line. This computes a longest-common-subsequence alignment
// over word or character tokens and emits a run of equal / inserted / deleted
// segments, exactly what a side-by-side or inline diff view needs to highlight
// the few characters that actually differ instead of repainting the whole line.

export type SegmentType = "equal" | "insert" | "delete";

export interface DiffSegment {
  type: SegmentType;
  text: string;
}

/** Split into alternating runs of whitespace and non-whitespace (word tokens). */
function wordTokens(text: string): string[] {
  return text.match(/\s+|\S+/g) ?? [];
}

/** Diff two strings at word granularity. */
export function wordDiff(a: string, b: string): DiffSegment[] {
  return diffTokens(wordTokens(a), wordTokens(b));
}

/** Diff two strings at character granularity. */
export function charDiff(a: string, b: string): DiffSegment[] {
  return diffTokens([...a], [...b]);
}

/** Align two token arrays via LCS and produce merged diff segments. */
function diffTokens(a: string[], b: string[]): DiffSegment[] {
  const matches = lcsPairs(a, b);
  const raw: DiffSegment[] = [];

  let i = 0;
  let j = 0;
  for (const [ai, bj] of matches) {
    while (i < ai) raw.push({ type: "delete", text: a[i++] });
    while (j < bj) raw.push({ type: "insert", text: b[j++] });
    raw.push({ type: "equal", text: a[ai] });
    i = ai + 1;
    j = bj + 1;
  }
  while (i < a.length) raw.push({ type: "delete", text: a[i++] });
  while (j < b.length) raw.push({ type: "insert", text: b[j++] });

  return mergeAdjacent(raw);
}

/** Merge consecutive segments of the same type into single runs. */
function mergeAdjacent(segments: DiffSegment[]): DiffSegment[] {
  const out: DiffSegment[] = [];
  for (const seg of segments) {
    if (seg.text === "") continue;
    const last = out[out.length - 1];
    if (last && last.type === seg.type) last.text += seg.text;
    else out.push({ ...seg });
  }
  return out;
}

/** Indices of a longest common subsequence, as [aIndex, bIndex] pairs. */
function lcsPairs(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return out;
}

/** Reconstruct the original ("delete"+"equal") side of a diff. */
export function originalText(segments: DiffSegment[]): string {
  return segments.filter((s) => s.type !== "insert").map((s) => s.text).join("");
}

/** Reconstruct the modified ("insert"+"equal") side of a diff. */
export function modifiedText(segments: DiffSegment[]): string {
  return segments.filter((s) => s.type !== "delete").map((s) => s.text).join("");
}
