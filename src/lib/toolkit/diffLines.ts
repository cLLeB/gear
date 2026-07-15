export type DiffOp = "equal" | "insert" | "delete";

export interface DiffLine {
  op: DiffOp;
  value: string;
}

/**
 * Compute a line-level diff between two texts using the longest-common-
 * subsequence algorithm. Returns an ordered list of equal/insert/delete lines
 * suitable for rendering a unified diff.
 */
export function diffLines(a: string, b: string): DiffLine[] {
  const aLines = a.length === 0 ? [] : a.split("\n");
  const bLines = b.length === 0 ? [] : b.split("\n");
  const n = aLines.length;
  const m = bLines.length;

  // LCS length table.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        aLines[i] === bLines[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      out.push({ op: "equal", value: aLines[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ op: "delete", value: aLines[i++] });
    } else {
      out.push({ op: "insert", value: bLines[j++] });
    }
  }
  while (i < n) out.push({ op: "delete", value: aLines[i++] });
  while (j < m) out.push({ op: "insert", value: bLines[j++] });
  return out;
}
