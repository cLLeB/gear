export interface FuzzyMatch {
  /** Higher is better. 0 means no match. */
  score: number;
  /** Indices in the target that were matched, in order. */
  positions: number[];
}

/**
 * Score how well `query` fuzzy-matches `target` as an ordered subsequence.
 * Rewards consecutive runs, start-of-word boundaries, and early matches —
 * the same heuristics editors use for command palettes.
 */
export function fuzzyScore(query: string, target: string): FuzzyMatch {
  if (query.length === 0) return { score: 1, positions: [] };
  if (query.length > target.length) return { score: 0, positions: [] };

  const q = query.toLowerCase();
  const t = target.toLowerCase();
  const positions: number[] = [];

  let score = 0;
  let qi = 0;
  let prevMatch = -2;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;

    let bonus = 1;
    if (ti === prevMatch + 1) bonus += 3; // consecutive
    if (ti === 0) bonus += 2; // very start
    const prevChar = ti > 0 ? target[ti - 1] : "";
    if (/[\s\-_./\\]/.test(prevChar)) bonus += 2; // word boundary
    if (prevChar && prevChar === prevChar.toLowerCase() && target[ti] !== target[ti].toLowerCase())
      bonus += 1; // camelCase hump

    score += bonus;
    positions.push(ti);
    prevMatch = ti;
    qi += 1;
  }

  if (qi < q.length) return { score: 0, positions: [] };
  // Penalise long targets slightly so tighter matches win ties.
  score -= target.length * 0.01;
  return { score: Math.max(score, 0.01), positions };
}
