/**
 * Split a string into fixed-width chunks. The final chunk may be shorter.
 * Uses the spread iterator so astral (surrogate-pair) characters stay intact.
 */
export function chunkString(input: string, size: number): string[] {
  if (size <= 0) throw new RangeError("size must be > 0");
  const chars = [...input];
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += size) {
    out.push(chars.slice(i, i + size).join(""));
  }
  return out;
}

/** Insert a separator every `size` characters (e.g. formatting a card number). */
export function groupString(input: string, size: number, separator = " "): string {
  return chunkString(input, size).join(separator);
}
