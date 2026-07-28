export interface HighlightSegment {
  text: string;
  match: boolean;
}

/**
 * Split text into alternating matched/unmatched segments given a list of
 * matched character indices (e.g. from fuzzyScore). Adjacent matched indices
 * are merged so a renderer can wrap each run once.
 */
export function highlightRanges(text: string, positions: readonly number[]): HighlightSegment[] {
  if (positions.length === 0) return text ? [{ text, match: false }] : [];

  const marked = new Set(positions);
  const segments: HighlightSegment[] = [];
  let current = "";
  let currentMatch = marked.has(0);

  for (let i = 0; i < text.length; i++) {
    const isMatch = marked.has(i);
    if (isMatch === currentMatch) {
      current += text[i];
    } else {
      if (current) segments.push({ text: current, match: currentMatch });
      current = text[i];
      currentMatch = isMatch;
    }
  }
  if (current) segments.push({ text: current, match: currentMatch });
  return segments;
}
