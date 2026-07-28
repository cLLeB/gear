const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES = ["", "thousand", "million", "billion", "trillion"];

function chunkToWords(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : ""));
  } else if (n > 0) {
    parts.push(ONES[n]);
  }
  return parts.join(" ");
}

/**
 * Convert an integer to its English words: 42 -> "forty-two". Supports
 * negatives and magnitudes up to the trillions.
 */
export function numberToWords(value: number): string {
  let n = Math.trunc(value);
  if (n === 0) return "zero";
  const sign = n < 0 ? "negative " : "";
  n = Math.abs(n);

  const groups: string[] = [];
  let scale = 0;
  while (n > 0 && scale < SCALES.length) {
    const chunk = n % 1000;
    if (chunk > 0) {
      const words = chunkToWords(chunk) + (SCALES[scale] ? ` ${SCALES[scale]}` : "");
      groups.unshift(words);
    }
    n = Math.floor(n / 1000);
    scale += 1;
  }
  return sign + groups.join(" ");
}
