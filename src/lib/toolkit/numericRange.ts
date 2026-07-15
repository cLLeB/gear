/** Constrain a value to the inclusive [min, max] range. */
export function clamp(value: number, min: number, max: number): number {
  if (min > max) [min, max] = [max, min];
  return Math.min(Math.max(value, min), max);
}

/** Linear interpolation between a and b at t in [0, 1]. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Inverse lerp: where does value fall between a and b, as a fraction? */
export function inverseLerp(a: number, b: number, value: number): number {
  if (a === b) return 0;
  return (value - a) / (b - a);
}

/** Remap a value from one range to another, clamping the output. */
export function mapRange(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  const t = clamp(inverseLerp(inMin, inMax, value), 0, 1);
  return lerp(outMin, outMax, t);
}

/** Round to a fixed number of decimal places without float drift. */
export function roundTo(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
