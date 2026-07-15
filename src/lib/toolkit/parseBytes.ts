const FACTORS: Record<string, number> = {
  b: 1,
  kb: 1000,
  mb: 1000 ** 2,
  gb: 1000 ** 3,
  tb: 1000 ** 4,
  pb: 1000 ** 5,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4,
  pib: 1024 ** 5,
};

/**
 * Parse a human byte-size string such as "10MB", "1.5 GiB", or "512" into a
 * number of bytes. Bare numbers are treated as bytes. Returns null on failure.
 */
export function parseBytes(input: string): number | null {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*([a-zA-Z]*)\s*$/.exec(input);
  if (!match) return null;
  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "") return Math.round(value);
  const factor = FACTORS[unit];
  if (factor === undefined) return null;
  return Math.round(value * factor);
}
