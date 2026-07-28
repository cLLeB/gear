/**
 * Compute the Levenshtein edit distance between two strings using a single-row
 * dynamic-programming buffer (O(min(a,b)) space).
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Ensure `a` is the shorter string to minimise memory.
  if (a.length > b.length) [a, b] = [b, a];

  const row = Array.from({ length: a.length + 1 }, (_, i) => i);

  for (let j = 1; j <= b.length; j++) {
    let prev = row[0];
    row[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const temp = row[i];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[i] = Math.min(row[i] + 1, row[i - 1] + 1, prev + cost);
      prev = temp;
    }
  }
  return row[a.length];
}

/** Normalised similarity in [0, 1]; 1 means identical. */
export function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}
