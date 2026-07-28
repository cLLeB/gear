// A three-way line merge (diff3) — the algorithm a version-control system uses
// to combine two independent sets of edits to a common ancestor. It anchors on
// the lines that survive unchanged in *both* sides (found via a longest-common-
// subsequence pass against the base), then resolves each region between anchors:
// if only one side changed it, take that side; if both made the identical
// change, take it once; if they changed it differently, emit a conflict block
// with the familiar `<<<<<<< / ======= / >>>>>>>` markers. This powers in-editor
// merging and "apply their change vs mine" resolution without shelling out.

export interface MergeResult {
  text: string;
  /** Number of conflict regions that could not be auto-resolved. */
  conflicts: number;
}

export interface MergeLabels {
  left?: string;
  right?: string;
}

/** Merge `left` and `right`, both derived from `base`. */
export function merge3(base: string, left: string, right: string, labels: MergeLabels = {}): MergeResult {
  const baseLines = splitLines(base);
  const leftLines = splitLines(left);
  const rightLines = splitLines(right);

  const toLeft = matchMap(baseLines, leftLines);
  const toRight = matchMap(baseLines, rightLines);

  // Anchors: base lines that are unchanged in both sides, in order.
  const anchors: Array<{ b: number; l: number; r: number }> = [];
  for (let b = 0; b < baseLines.length; b++) {
    if (toLeft.has(b) && toRight.has(b)) anchors.push({ b, l: toLeft.get(b)!, r: toRight.get(b)! });
  }

  const output: string[] = [];
  let conflicts = 0;
  let prevB = -1;
  let prevL = -1;
  let prevR = -1;

  const emitRegion = (bEnd: number, lEnd: number, rEnd: number) => {
    const baseSlice = baseLines.slice(prevB + 1, bEnd);
    const leftSlice = leftLines.slice(prevL + 1, lEnd);
    const rightSlice = rightLines.slice(prevR + 1, rEnd);
    const resolved = resolveRegion(baseSlice, leftSlice, rightSlice, labels);
    output.push(...resolved.lines);
    if (resolved.conflict) conflicts++;
  };

  for (const anchor of anchors) {
    emitRegion(anchor.b, anchor.l, anchor.r);
    output.push(baseLines[anchor.b]);
    prevB = anchor.b;
    prevL = anchor.l;
    prevR = anchor.r;
  }
  emitRegion(baseLines.length, leftLines.length, rightLines.length);

  return { text: output.join("\n"), conflicts };
}

function resolveRegion(
  base: string[],
  left: string[],
  right: string[],
  labels: MergeLabels,
): { lines: string[]; conflict: boolean } {
  if (equal(left, base)) return { lines: right, conflict: false }; // only right changed
  if (equal(right, base)) return { lines: left, conflict: false }; // only left changed
  if (equal(left, right)) return { lines: left, conflict: false }; // both made the same change

  return {
    conflict: true,
    lines: [
      `<<<<<<< ${labels.left ?? "left"}`,
      ...left,
      "=======",
      ...right,
      `>>>>>>> ${labels.right ?? "right"}`,
    ],
  };
}

function equal(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function splitLines(text: string): string[] {
  return text.split("\n");
}

/** Map base-line index -> other-line index for the lines they have in common. */
function matchMap(base: string[], other: string[]): Map<number, number> {
  const dp: number[][] = Array.from({ length: base.length + 1 }, () => new Array(other.length + 1).fill(0));
  for (let i = base.length - 1; i >= 0; i--) {
    for (let j = other.length - 1; j >= 0; j--) {
      dp[i][j] = base[i] === other[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const map = new Map<number, number>();
  let i = 0;
  let j = 0;
  while (i < base.length && j < other.length) {
    if (base[i] === other[j]) { map.set(i, j); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return map;
}
