// Markdown helpers: GitHub-compatible heading anchors, table-of-contents
// generation that updates in place between <!-- toc --> markers, and
// toggling inline formatting around a selection.

import { markdownHeadings } from "./outline";

/** GitHub's anchor algorithm: lower-case, drop punctuation, spaces → dashes, dedupe. */
export function slugger(): (heading: string) => string {
  const seen = new Map<string, number>();
  return (heading) => {
    const base = heading
      .replace(/`([^`]*)`/g, "$1")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s/g, "-");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
}

export const TOC_START = "<!-- toc -->";
export const TOC_END = "<!-- tocstop -->";

export function buildToc(markdown: string, options: { minLevel?: number; maxLevel?: number } = {}): string {
  const { minLevel = 2, maxLevel = 4 } = options;
  const slug = slugger();
  const lines: string[] = [];
  for (const h of markdownHeadings(markdown)) {
    const level = Number(h.kind.slice(1));
    const anchor = slug(h.name); // every heading consumes a slug, like GitHub
    if (level < minLevel || level > maxLevel) continue;
    const text = h.name.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
    lines.push(`${"  ".repeat(level - minLevel)}- [${text}](#${anchor})`);
  }
  return lines.join("\n");
}

/**
 * Insert or refresh a TOC. With markers present the block between them is
 * replaced; otherwise the TOC is inserted at `insertAt` wrapped in markers.
 */
export function upsertToc(markdown: string, insertAt: number): { text: string; updated: boolean } {
  // Headings inside an old TOC block must not feed the new one.
  const start = markdown.indexOf(TOC_START);
  const end = start === -1 ? -1 : markdown.indexOf(TOC_END, start);
  const source = start !== -1 && end !== -1 ? markdown.slice(0, start) + markdown.slice(end + TOC_END.length) : markdown;
  const toc = buildToc(source);
  const block = `${TOC_START}\n${toc}\n${TOC_END}`;
  if (start !== -1 && end !== -1) {
    return { text: markdown.slice(0, start) + block + markdown.slice(end + TOC_END.length), updated: true };
  }
  return { text: `${markdown.slice(0, insertAt)}${block}\n${markdown.slice(insertAt)}`, updated: false };
}

/** Wrap or unwrap `text` in a symmetric marker, also checking just outside the selection. */
export function toggleWrap(
  doc: string,
  from: number,
  to: number,
  marker: string,
): { from: number; to: number; insert: string; selFrom: number; selTo: number } {
  const inner = doc.slice(from, to);
  const m = marker.length;
  if (inner.startsWith(marker) && inner.endsWith(marker) && inner.length >= 2 * m) {
    const insert = inner.slice(m, -m);
    return { from, to, insert, selFrom: from, selTo: from + insert.length };
  }
  if (doc.slice(from - m, from) === marker && doc.slice(to, to + m) === marker) {
    return { from: from - m, to: to + m, insert: inner, selFrom: from - m, selTo: to - m };
  }
  return { from, to, insert: `${marker}${inner}${marker}`, selFrom: from + m, selTo: to + m };
}
