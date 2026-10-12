// Markdown slides: one file, slides separated by a line of three dashes.
// Speaker notes follow a line that says "Note:" (or "???") and are not shown
// on the slide. Front matter at the top of the file is skipped.

export interface Slide {
  /** What is rendered on the slide. */
  body: string;
  /** Speaker notes, empty when there are none. */
  notes: string;
  /** The first heading, for the overview; falls back to the first words. */
  title: string;
  /** 1-based line in the file where the slide starts. */
  line: number;
}

export interface Deck {
  slides: Slide[];
  /** `title:` from the front matter, when present. */
  title: string | null;
}

const SEPARATOR = /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/;
const NOTE_MARK = /^\s*(note:|notes:|\?\?\?)\s*(.*)$/i;

function titleOf(body: string): string {
  const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m.exec(body)?.[1];
  const plain = (heading ?? body.split("\n").find((l) => l.trim()) ?? "").replace(/[*_`~]|!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim();
  return plain.length > 60 ? `${plain.slice(0, 57)}…` : plain;
}

export function parseDeck(text: string): Deck {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let start = 0;
  let title: string | null = null;
  // Front matter: a block between two `---` lines at the very top.
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (end > 0 && lines.slice(1, end).every((l) => l.trim() === "" || /^[\w-]+\s*:/.test(l) || /^\s+\S/.test(l) || l.trim().startsWith("#"))) {
      const t = lines.slice(1, end).find((l) => /^title\s*:/.test(l));
      if (t) title = t.replace(/^title\s*:\s*/, "").replace(/^["']|["']$/g, "").trim() || null;
      start = end + 1;
    }
  }
  const slides: Slide[] = [];
  let body: string[] = [];
  let notes: string[] | null = null;
  let fence: string | null = null;
  let from = start;
  const flush = (next: number) => {
    const b = body.join("\n").trim();
    const n = (notes ?? []).join("\n").trim();
    if (b || n) slides.push({ body: b, notes: n, title: titleOf(b), line: from + 1 + body.findIndex((l) => l.trim() !== "") });
    body = [];
    notes = null;
    from = next;
  };
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    const mark = /^\s*(```|~~~)/.exec(line)?.[1] ?? null;
    if (fence) {
      if (mark === fence) fence = null;
    } else if (mark) fence = mark;
    else if (SEPARATOR.test(line) && (i === start || lines[i - 1].trim() === "")) {
      // A dashed line directly under text is a heading underline, not a separator.
      flush(i + 1);
      continue;
    } else if (notes === null && NOTE_MARK.test(line)) {
      notes = [NOTE_MARK.exec(line)?.[2] ?? ""];
      continue;
    }
    (notes ?? body).push(line);
  }
  flush(lines.length);
  // The line of a slide whose body is empty (notes only) falls back to its start.
  for (const s of slides) if (s.line <= 0) s.line = 1;
  return { slides, title };
}

export function clampIndex(index: number, count: number): number {
  return Math.max(0, Math.min(index, Math.max(0, count - 1)));
}

/** Where a key takes the presenter; null for keys that do nothing here. */
export function navigate(key: string, index: number, count: number): number | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
    case "PageDown":
    case " ":
    case "Enter":
    case "n":
    case "j":
      return clampIndex(index + 1, count);
    case "ArrowLeft":
    case "ArrowUp":
    case "PageUp":
    case "Backspace":
    case "p":
    case "k":
      return clampIndex(index - 1, count);
    case "Home":
      return 0;
    case "End":
      return clampIndex(count - 1, count);
    default:
      return null;
  }
}

/** A font scale that keeps a long slide on screen: 1 for short slides, down to 0.55. */
export function fitScale(body: string): number {
  const lines = body.split("\n");
  // Wrapped lines and fenced code count for more than their line number suggests.
  const weight = lines.reduce((a, l) => a + 1 + Math.floor(l.length / 70), 0);
  if (weight <= 10) return 1;
  return Math.max(0.55, Math.round((10 / weight) ** 0.5 * 100) / 100);
}

export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Reading time for the notes at a speaking pace of 140 words a minute. */
export function speakingSeconds(deck: Deck): number {
  const words = deck.slides.reduce((a, s) => a + (s.notes.match(/\S+/g)?.length ?? 0), 0);
  return Math.round((words / 140) * 60);
}

export const SAMPLE_DECK = `---
title: My talk
---

# My talk

A subtitle goes here

Note: Welcome everyone. These notes are only visible to you.

---

## The problem

- Point one
- Point two
- Point three

Note: Explain each point in turn.

---

## Some code

\`\`\`ts
const answer = 6 * 7;
\`\`\`

---

## Thank you

Questions?
`;
