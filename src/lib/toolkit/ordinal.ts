/** Return the ordinal suffix for an integer: 1 -> "st", 2 -> "nd", 11 -> "th". */
export function ordinalSuffix(n: number): string {
  const abs = Math.abs(Math.trunc(n));
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  switch (abs % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

/** Format an integer with its ordinal suffix: 21 -> "21st". */
export function ordinal(n: number): string {
  return `${Math.trunc(n)}${ordinalSuffix(n)}`;
}
