/** Greatest common divisor of two integers (absolute value). */
export function gcd(a: number, b: number): number {
  a = Math.abs(Math.trunc(a));
  b = Math.abs(Math.trunc(b));
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

/** Least common multiple of two integers. */
export function lcm(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return Math.abs(Math.trunc(a) * Math.trunc(b)) / gcd(a, b);
}

/** Reduce a fraction to its lowest terms, returning [numerator, denominator]. */
export function simplifyFraction(numerator: number, denominator: number): [number, number] {
  if (denominator === 0) throw new RangeError("denominator must be non-zero");
  const divisor = gcd(numerator, denominator) || 1;
  const sign = denominator < 0 ? -1 : 1;
  return [(sign * numerator) / divisor, (sign * denominator) / divisor];
}
