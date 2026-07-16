export interface ReadingTime {
  words: number;
  minutes: number;
  /** Human label such as "3 min read" or "< 1 min read". */
  text: string;
}

/** Count words in a string, treating any whitespace run as a separator. */
export function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Estimate reading time for a body of text at a given words-per-minute rate
 * (default 200), returning the word count, minutes, and a display label.
 */
export function readingTime(text: string, wpm = 200): ReadingTime {
  const words = wordCount(text);
  const minutes = words / wpm;
  const rounded = Math.max(1, Math.round(minutes));
  const label = words === 0 ? "0 min read" : minutes < 1 ? "< 1 min read" : `${rounded} min read`;
  return { words, minutes, text: label };
}
