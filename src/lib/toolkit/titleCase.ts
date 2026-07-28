const SMALL_WORDS = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "if", "in",
  "nor", "of", "on", "or", "per", "the", "to", "vs", "via",
]);

/**
 * Convert a string to title case using AP-style rules: capitalise the first
 * and last words plus all significant words, leaving small joining words lower
 * unless they lead the title.
 */
export function titleCase(input: string): string {
  const words = input.toLowerCase().trim().split(/\s+/);
  const last = words.length - 1;

  return words
    .map((word, i) => {
      if (i !== 0 && i !== last && SMALL_WORDS.has(word)) return word;
      return capitalize(word);
    })
    .join(" ");
}

function capitalize(word: string): string {
  // Preserve hyphenated compounds: "well-known" -> "Well-Known".
  return word
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join("-");
}
