export type CharDiffOp = "equal" | "insert" | "delete";

export interface CharDiff {
  op: CharDiffOp;
  value: string;
}

/**
 * Character-level diff between two strings using the longest-common-subsequence
 * algorithm. Consecutive operations of the same kind are coalesced into runs.
 */
export function diffChars(a: string, b: string): CharDiff[] {
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const raw: CharDiff[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) raw.push({ op: "equal", value: a[i++] }), j++;
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) raw.push({ op: "delete", value: a[i++] });
    else raw.push({ op: "insert", value: b[j++] });
  }
  while (i < n) raw.push({ op: "delete", value: a[i++] });
  while (j < m) raw.push({ op: "insert", value: b[j++] });

  // Coalesce runs.
  const out: CharDiff[] = [];
  for (const part of raw) {
    const last = out[out.length - 1];
    if (last && last.op === part.op) last.value += part.value;
    else out.push({ ...part });
  }
  return out;
}
