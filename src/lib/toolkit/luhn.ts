/**
 * Validate a numeric string using the Luhn (mod-10) checksum, used by credit
 * cards, IMEIs, and many account numbers. Non-digit separators are ignored.
 */
export function isValidLuhn(input: string): boolean {
  const digits = input.replace(/[\s-]/g, "");
  if (!/^\d+$/.test(digits) || digits.length < 2) return false;

  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Compute the Luhn check digit that would make `partial` valid. */
export function luhnCheckDigit(partial: string): number {
  const digits = partial.replace(/[\s-]/g, "");
  let sum = 0;
  let double = true;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return (10 - (sum % 10)) % 10;
}
