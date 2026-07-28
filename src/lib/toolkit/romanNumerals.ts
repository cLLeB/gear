const NUMERALS: readonly [number, string][] = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

/** Convert an integer (1-3999) to a Roman numeral string. */
export function toRoman(value: number): string {
  let n = Math.trunc(value);
  if (n <= 0 || n >= 4000) throw new RangeError("value must be between 1 and 3999");
  let out = "";
  for (const [num, sym] of NUMERALS) {
    while (n >= num) {
      out += sym;
      n -= num;
    }
  }
  return out;
}

/** Parse a Roman numeral string into an integer, or null when invalid. */
export function fromRoman(roman: string): number | null {
  const s = roman.trim().toUpperCase();
  if (!/^[MDCLXVI]+$/.test(s)) return null;
  const value: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const cur = value[s[i]];
    const next = value[s[i + 1]] ?? 0;
    total += cur < next ? -cur : cur;
  }
  return toRoman(total) === s ? total : null;
}
