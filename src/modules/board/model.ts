// A Kanban board stored as plain Markdown: every `## Heading` is a column and
// every top-level list item under it is a card. Everything else in the file
// (the title, notes between cards, deeper headings) is kept exactly as written.

export interface Card {
  /** The item's own line plus its indented continuation lines. */
  lines: string[];
}

export interface Column {
  /** The heading line as written, e.g. "## In progress". */
  heading: string;
  /** Lines between the heading and the first card. */
  before: string[];
  cards: Card[];
  /** Lines after the last card (blank lines, notes) up to the next column. */
  after: string[];
}

export interface Board {
  /** Lines before the first column. */
  preamble: string[];
  columns: Column[];
  eol: string;
  finalNewline: boolean;
}

const ITEM = /^([-*+])\s+(\[( |x|X)\]\s+)?(.*)$/;
const HEADING = /^##\s+(.*?)\s*#*\s*$/;

export function parseBoard(text: string): Board {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const finalNewline = /\r?\n$/.test(text);
  const lines = text.split(/\r?\n/);
  if (finalNewline) lines.pop();
  const board: Board = { preamble: [], columns: [], eol, finalNewline };
  let col: Column | null = null;
  let fence: string | null = null;
  // Lines seen since the last card that may turn out to belong to it (blank lines before an indented line).
  let pending: string[] = [];
  const flush = () => {
    if (!col || !pending.length) return;
    (col.cards.length ? col.after : col.before).push(...pending);
    pending = [];
  };
  for (const line of lines) {
    const fenceMark = /^\s*(```|~~~)/.exec(line)?.[1] ?? null;
    if (fence) {
      if (fenceMark === fence) fence = null;
    } else if (fenceMark) fence = fenceMark;
    const inFence = fence !== null || fenceMark !== null;
    if (!inFence && HEADING.test(line)) {
      flush();
      col = { heading: line, before: [], cards: [], after: [] };
      board.columns.push(col);
      continue;
    }
    if (!col) {
      board.preamble.push(line);
      continue;
    }
    const lastCard = col.cards[col.cards.length - 1];
    const trailing = col.after.length > 0;
    if (!inFence && ITEM.test(line) && !trailing) {
      // Blank lines between cards stay with the card above, so they travel with it.
      if (lastCard) lastCard.lines.push(...pending);
      else col.before.push(...pending);
      pending = [];
      col.cards.push({ lines: [line] });
    } else if (lastCard && !trailing && /^\s+\S/.test(line)) {
      lastCard.lines.push(...pending, line);
      pending = [];
    } else if (lastCard && !trailing && line.trim() === "") {
      pending.push(line);
    } else {
      flush();
      (col.cards.length ? col.after : col.before).push(line);
    }
  }
  flush();
  return board;
}

export function serializeBoard(b: Board): string {
  const lines = [...b.preamble];
  for (const c of b.columns) lines.push(c.heading, ...c.before, ...c.cards.flatMap((k) => k.lines), ...c.after);
  return lines.join(b.eol) + (b.finalNewline ? b.eol : "");
}

export function columnTitle(c: Column): string {
  return HEADING.exec(c.heading)?.[1] ?? c.heading;
}

export interface CardView {
  text: string;
  /** null when the item has no checkbox. */
  done: boolean | null;
  tags: string[];
  due: string | null;
  /** Continuation lines, unindented. */
  details: string[];
}

export function viewCard(card: Card): CardView {
  const m = ITEM.exec(card.lines[0]);
  const text = m?.[4] ?? card.lines[0];
  const rest = card.lines.slice(1).filter((l) => l.trim() !== "");
  const indent = Math.min(...rest.map((l) => /^\s*/.exec(l)?.[0].length ?? 0), 99);
  return {
    text,
    done: m?.[2] ? m[3].toLowerCase() === "x" : null,
    tags: [...text.matchAll(/(?:^|\s)#([\w-]+)/g)].map((t) => t[1]),
    due: /@due\((\d{4}-\d{2}-\d{2})\)/.exec(text)?.[1] ?? /(?:📅|due:)\s*(\d{4}-\d{2}-\d{2})/.exec(text)?.[1] ?? null,
    details: rest.map((l) => l.slice(indent)),
  };
}

function setFirstLine(card: Card, done: boolean | null, text: string): Card {
  const marker = ITEM.exec(card.lines[0])?.[1] ?? "-";
  const box = done === null ? "" : done ? "[x] " : "[ ] ";
  return { lines: [`${marker} ${box}${text}`, ...card.lines.slice(1)] };
}

const isDoneColumn = (c: Column) => /\b(done|complete|completed|finished|shipped|closed)\b/i.test(columnTitle(c));

function mapColumn(b: Board, col: number, fn: (c: Column) => Column): Board {
  return { ...b, columns: b.columns.map((c, i) => (i === col ? fn(c) : c)) };
}

/** A column emptied of its cards does not keep two blank lines in a row. */
function withoutDoubleGap(c: Column): Column {
  const blankBefore = c.before.length > 0 && c.before[c.before.length - 1].trim() === "";
  return c.cards.length === 0 && blankBefore && c.after[0]?.trim() === "" ? { ...c, after: c.after.slice(1) } : c;
}

/** A column that has cards keeps a blank line after its heading and before the next one. */
function withGap(b: Board, col: number): Board {
  const isLast = col >= b.columns.length - 1;
  return mapColumn(b, col, (c) => {
    if (!c.cards.length) return c;
    const before = c.before.length === 0 || c.before[c.before.length - 1].trim() !== "" ? [...c.before, ""] : c.before;
    const after = !isLast && c.after.length === 0 && c.cards[c.cards.length - 1].lines.slice(-1)[0]?.trim() !== "" ? [""] : c.after;
    return before === c.before && after === c.after ? c : { ...c, before, after };
  });
}

export function addCard(b: Board, col: number, text: string): Board {
  const clean = text.replace(/\s*\r?\n\s*/g, " ").trim();
  if (!clean) return b;
  return withGap(mapColumn(b, col, (c) => {
    const box = c.cards.some((k) => viewCard(k).done !== null) || !c.cards.length;
    return { ...c, cards: [...c.cards, { lines: [`- ${box ? (isDoneColumn(c) ? "[x] " : "[ ] ") : ""}${clean}`] }] };
  }), col);
}

export function editCard(b: Board, col: number, index: number, text: string): Board {
  const clean = text.replace(/\s*\r?\n\s*/g, " ").trim();
  if (!clean) return b;
  return mapColumn(b, col, (c) => ({ ...c, cards: c.cards.map((k, i) => (i === index ? setFirstLine(k, viewCard(k).done, clean) : k)) }));
}

export function toggleCard(b: Board, col: number, index: number): Board {
  return mapColumn(b, col, (c) => ({
    ...c,
    cards: c.cards.map((k, i) => {
      if (i !== index) return k;
      const v = viewCard(k);
      return setFirstLine(k, !(v.done ?? false), v.text);
    }),
  }));
}

export function deleteCard(b: Board, col: number, index: number): Board {
  return mapColumn(b, col, (c) => withoutDoubleGap({ ...c, cards: c.cards.filter((_, i) => i !== index) }));
}

/**
 * Moves a card. `toIndex` is the position in the target column after the card
 * has been taken out of its old place. Dropping into a "Done" column ticks the
 * card's checkbox; taking it out unticks it.
 */
export function moveCard(b: Board, fromCol: number, fromIndex: number, toCol: number, toIndex: number): Board {
  const card = b.columns[fromCol]?.cards[fromIndex];
  if (!card || !b.columns[toCol]) return b;
  let moved = card;
  if (fromCol !== toCol) {
    const v = viewCard(card);
    const target = isDoneColumn(b.columns[toCol]);
    const source = isDoneColumn(b.columns[fromCol]);
    if (v.done !== null && target !== source) moved = setFirstLine(card, target, v.text);
  }
  const without = mapColumn(b, fromCol, (c) => withoutDoubleGap({ ...c, cards: c.cards.filter((_, i) => i !== fromIndex) }));
  return withGap(
    mapColumn(without, toCol, (c) => {
      const at = Math.max(0, Math.min(toIndex, c.cards.length));
      return { ...c, cards: [...c.cards.slice(0, at), moved, ...c.cards.slice(at)] };
    }),
    toCol,
  );
}

export function addColumn(b: Board, title: string): Board {
  const clean = title.trim();
  if (!clean) return b;
  const columns = [...b.columns];
  const lastCol = columns[columns.length - 1];
  // Keep a blank line between the previous column and the new heading.
  if (lastCol && lastCol.after[lastCol.after.length - 1]?.trim() !== "") columns[columns.length - 1] = { ...lastCol, after: [...lastCol.after, ""] };
  const preamble = !lastCol && b.preamble.length && b.preamble[b.preamble.length - 1].trim() !== "" ? [...b.preamble, ""] : b.preamble;
  return { ...b, preamble, columns: [...columns, { heading: `## ${clean}`, before: [""], cards: [], after: [] }] };
}

export function renameColumn(b: Board, col: number, title: string): Board {
  const clean = title.trim();
  return clean ? mapColumn(b, col, (c) => ({ ...c, heading: `## ${clean}` })) : b;
}

export function moveColumn(b: Board, col: number, by: -1 | 1): Board {
  const to = col + by;
  if (to < 0 || to >= b.columns.length) return b;
  const columns = [...b.columns];
  [columns[col], columns[to]] = [columns[to], columns[col]];
  return { ...b, columns };
}

/** An empty board for a new file. */
export const NEW_BOARD = "# Board\n\n## To do\n\n- [ ] First task\n\n## In progress\n\n## Done\n";

export function overdue(due: string | null, today: string): boolean {
  return due !== null && due < today;
}
