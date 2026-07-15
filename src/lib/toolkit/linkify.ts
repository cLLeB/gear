export interface DetectedLink {
  type: "url" | "email";
  value: string;
  start: number;
  end: number;
}

const URL_RE = /\bhttps?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/gi;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/**
 * Find URLs and email addresses in plain text, returning their positions so a
 * terminal or editor can turn them into clickable links.
 */
export function detectLinks(text: string): DetectedLink[] {
  const links: DetectedLink[] = [];

  for (const m of text.matchAll(URL_RE)) {
    links.push({ type: "url", value: m[0], start: m.index!, end: m.index! + m[0].length });
  }
  for (const m of text.matchAll(EMAIL_RE)) {
    links.push({ type: "email", value: m[0], start: m.index!, end: m.index! + m[0].length });
  }

  return links.sort((a, b) => a.start - b.start);
}
