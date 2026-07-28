// A fuzzy subsequence matcher with optimal-alignment scoring, following the
// `fzy` algorithm. A naive subsequence test can tell you *whether* a query
// matches, but ranking a symbol quick-open or command palette well needs to know
// *how* it matches: matches at word/camelCase/path boundaries and in consecutive
// runs should rank far above scattered ones. This computes the best-scoring
// alignment in O(query x target) time and reconstructs the matched positions so
// the UI can highlight them.

const SCORE_MIN = -Infinity;
const SCORE_GAP_LEADING = -0.005;
const SCORE_GAP_TRAILING = -0.005;
const SCORE_GAP_INNER = -0.01;
const SCORE_MATCH_CONSECUTIVE = 1.0;
const SCORE_MATCH_SLASH = 0.9;
const SCORE_MATCH_WORD = 0.8;
const SCORE_MATCH_CAPITAL = 0.7;
const SCORE_MATCH_DOT = 0.6;

export interface FuzzyResult {
  score: number;
  /** Indices into `target` that were matched, ascending. */
  positions: number[];
}

function isLower(c: string): boolean { return c >= "a" && c <= "z"; }
function isUpper(c: string): boolean { return c >= "A" && c <= "Z"; }

/** Bonus for matching target[j] given the character before it. */
function bonusAt(target: string, j: number): number {
  const cur = target[j];
  const prev = j === 0 ? "/" : target[j - 1];
  if (prev === "/") return SCORE_MATCH_SLASH;
  if (prev === "-" || prev === "_" || prev === " ") return SCORE_MATCH_WORD;
  if (prev === ".") return SCORE_MATCH_DOT;
  if (isLower(prev) && isUpper(cur)) return SCORE_MATCH_CAPITAL;
  return 0;
}

function eq(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Whether `query` is a (case-insensitive) subsequence of `target`. */
export function fuzzyMatches(query: string, target: string): boolean {
  if (query === "") return true;
  let qi = 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

/**
 * Score and align `query` against `target`. Returns null when `query` is not a
 * subsequence of `target`. A perfect exact match still returns finite positions.
 */
export function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  const m = query.length;
  const n = target.length;
  if (m === 0) return { score: 0, positions: [] };
  if (m > n || !fuzzyMatches(query, target)) return null;
  if (m === n) return { score: SCORE_MATCH_CONSECUTIVE * m, positions: [...Array(m).keys()] };

  // D[i][j]: best score with query[i] matched exactly at target[j].
  // M[i][j]: best score matching query[0..i] within target[0..j] (any end).
  const D: number[][] = Array.from({ length: m }, () => new Array<number>(n).fill(SCORE_MIN));
  const M: number[][] = Array.from({ length: m }, () => new Array<number>(n).fill(SCORE_MIN));

  for (let i = 0; i < m; i++) {
    let prevScore = SCORE_MIN;
    const gapScore = i === m - 1 ? SCORE_GAP_TRAILING : SCORE_GAP_INNER;
    for (let j = 0; j < n; j++) {
      if (eq(query[i], target[j])) {
        let score = SCORE_MIN;
        if (i === 0) {
          score = j * SCORE_GAP_LEADING + bonusAt(target, j);
        } else if (j > 0) {
          const start = M[i - 1][j - 1] + bonusAt(target, j);
          const consecutive = D[i - 1][j - 1] + SCORE_MATCH_CONSECUTIVE;
          score = Math.max(start, consecutive);
        }
        D[i][j] = score;
        M[i][j] = prevScore = Math.max(score, prevScore + gapScore);
      } else {
        D[i][j] = SCORE_MIN;
        M[i][j] = prevScore = prevScore + gapScore;
      }
    }
  }

  const positions = reconstruct(D, M, m, n);
  return { score: M[m - 1][n - 1], positions };
}

function reconstruct(D: number[][], M: number[][], m: number, n: number): number[] {
  const positions = new Array<number>(m).fill(-1);
  let matchRequired = false;
  let j = n - 1;
  for (let i = m - 1; i >= 0; i--) {
    for (; j >= 0; j--) {
      const isMatch = D[i][j] !== SCORE_MIN && (matchRequired || D[i][j] === M[i][j]);
      if (isMatch) {
        matchRequired =
          i > 0 && j > 0 && M[i][j] === D[i - 1][j - 1] + SCORE_MATCH_CONSECUTIVE;
        positions[i] = j;
        j -= 1;
        break;
      }
    }
  }
  return positions;
}

export interface RankedItem<T> {
  item: T;
  score: number;
  positions: number[];
}

/**
 * Filter and rank a list of items by fuzzy match against `query`, best first.
 * Ties break by shorter target, then original order (stable).
 */
export function fuzzyFilter<T>(query: string, items: readonly T[], key: (item: T) => string): RankedItem<T>[] {
  const out: Array<RankedItem<T> & { len: number; index: number }> = [];
  items.forEach((item, index) => {
    const target = key(item);
    const res = fuzzyMatch(query, target);
    if (res) out.push({ item, score: res.score, positions: res.positions, len: target.length, index });
  });
  out.sort((a, b) => b.score - a.score || a.len - b.len || a.index - b.index);
  return out.map(({ item, score, positions }) => ({ item, score, positions }));
}
