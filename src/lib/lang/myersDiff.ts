// An implementation of Myers' O(ND) difference algorithm — the same algorithm
// git uses. It computes the shortest edit script between two sequences by
// walking the edit graph's furthest-reaching D-paths and then backtracking
// through the recorded traces to emit operations. Generic over element type so
// it works on lines, tokens, or characters.

export type DiffOp = "equal" | "insert" | "delete";

export interface DiffEntry<T> {
  op: DiffOp;
  value: T;
}

/**
 * Compute the shortest edit script transforming `a` into `b`. Returns an ordered
 * list of equal/delete/insert entries. `equals` customizes element comparison.
 */
export function myersDiff<T>(a: readonly T[], b: readonly T[], equals: (x: T, y: T) => boolean = Object.is): DiffEntry<T>[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  if (max === 0) return [];

  const offset = max;
  const size = 2 * max + 1;
  const v = new Int32Array(size);
  const trace: Int32Array[] = [];

  let reachedD = -1;
  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1]; // move down (insertion)
      } else {
        x = v[offset + k - 1] + 1; // move right (deletion)
      }
      let y = x - k;
      while (x < n && y < m && equals(a[x], b[y])) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        reachedD = d;
        break outer;
      }
    }
  }

  // Backtrack through the traces to build the edit script.
  const entries: DiffEntry<T>[] = [];
  let x = n;
  let y = m;
  for (let d = reachedD; d > 0; d--) {
    const vPrev = trace[d];
    const k = x - y;
    const prevK =
      k === -d || (k !== d && vPrev[offset + k - 1] < vPrev[offset + k + 1]) ? k + 1 : k - 1;
    const prevX = vPrev[offset + prevK];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      entries.push({ op: "equal", value: a[x - 1] });
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) {
        entries.push({ op: "insert", value: b[y - 1] });
        y--;
      } else {
        entries.push({ op: "delete", value: a[x - 1] });
        x--;
      }
    }
  }
  while (x > 0 && y > 0) {
    entries.push({ op: "equal", value: a[x - 1] });
    x--;
    y--;
  }
  while (y > 0) {
    entries.push({ op: "insert", value: b[y - 1] });
    y--;
  }
  while (x > 0) {
    entries.push({ op: "delete", value: a[x - 1] });
    x--;
  }

  return entries.reverse();
}

/** Line-level diff of two texts using Myers. */
export function diffLinesMyers(a: string, b: string): DiffEntry<string>[] {
  const aLines = a.length === 0 ? [] : a.split("\n");
  const bLines = b.length === 0 ? [] : b.split("\n");
  return myersDiff(aLines, bLines);
}

/** Total number of changed (inserted + deleted) elements in a diff. */
export function editDistance<T>(diff: readonly DiffEntry<T>[]): number {
  return diff.reduce((acc, e) => acc + (e.op === "equal" ? 0 : 1), 0);
}
