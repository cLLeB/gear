export interface TruncateWordsOptions {
  /** Suffix appended when truncation happens. Defaults to "…". */
  ellipsis?: string;
}

/**
 * Truncate text to at most `maxWords` whole words, appending an ellipsis when
 * content was removed. Preserves single spaces between kept words.
 */
export function truncateWords(text: string, maxWords: number, options: TruncateWordsOptions = {}): string {
  const { ellipsis = "…" } = options;
  if (maxWords <= 0) return "";
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  return words.slice(0, maxWords).join(" ") + ellipsis;
}
