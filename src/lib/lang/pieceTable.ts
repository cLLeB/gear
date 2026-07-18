// A piece table — the text-buffer data structure behind editors like VS Code.
// Instead of storing the document as one mutable string (so every insert/delete
// rewrites the whole buffer), it keeps the immutable original text, an
// append-only "add" buffer for everything typed since, and an ordered list of
// *pieces* that each point at a span of one of those two buffers. An edit never
// copies document text: inserting appends to the add buffer and splices a piece;
// deleting just trims or drops pieces. This keeps edits cheap regardless of
// document size and gives a clean foundation for line tracking and undo.

interface Piece {
  buffer: "original" | "add";
  start: number;
  length: number;
}

export class PieceTable {
  private readonly original: string;
  private add = "";
  private pieces: Piece[] = [];
  private total = 0;

  constructor(initial = "") {
    this.original = initial;
    if (initial.length > 0) {
      this.pieces.push({ buffer: "original", start: 0, length: initial.length });
      this.total = initial.length;
    }
  }

  /** Current document length in characters. */
  get length(): number {
    return this.total;
  }

  /** Materialize the full document text. */
  getText(): string {
    let out = "";
    for (const p of this.pieces) out += this.read(p);
    return out;
  }

  /** Text of the half-open range [from, to). */
  getRange(from: number, to: number): string {
    const lo = clamp(from, 0, this.total);
    const hi = clamp(to, lo, this.total);
    let out = "";
    let pos = 0;
    for (const p of this.pieces) {
      const pieceEnd = pos + p.length;
      if (pieceEnd > lo && pos < hi) {
        const localStart = Math.max(0, lo - pos);
        const localEnd = Math.min(p.length, hi - pos);
        out += this.buffer(p.buffer).slice(p.start + localStart, p.start + localEnd);
      }
      pos = pieceEnd;
      if (pos >= hi) break;
    }
    return out;
  }

  /** Insert `text` at `offset`. */
  insert(offset: number, text: string): void {
    if (text === "") return;
    const at = clamp(offset, 0, this.total);
    const start = this.add.length;
    this.add += text;
    const piece: Piece = { buffer: "add", start, length: text.length };

    const idx = this.splitAt(at);
    this.pieces.splice(idx, 0, piece);
    this.total += text.length;
  }

  /** Delete `length` characters starting at `offset`. */
  delete(offset: number, length: number): void {
    if (length <= 0) return;
    const from = clamp(offset, 0, this.total);
    const to = clamp(from + length, from, this.total);
    if (to === from) return;

    const startIdx = this.splitAt(from);
    const endIdx = this.splitAt(to);
    this.pieces.splice(startIdx, endIdx - startIdx);
    this.total -= to - from;
  }

  /** Replace the range [from, to) with `text` in one step. */
  replace(from: number, to: number, text: string): void {
    this.delete(from, to - from);
    this.insert(from, text);
  }

  // --- internals ---

  /**
   * Ensure a piece boundary exists exactly at global `offset`, splitting a piece
   * if the offset falls inside one, and return the index of the piece that
   * begins at `offset` (or pieces.length when at the very end).
   */
  private splitAt(offset: number): number {
    if (offset === 0) return 0;
    let pos = 0;
    for (let i = 0; i < this.pieces.length; i++) {
      const p = this.pieces[i];
      if (offset === pos) return i;
      if (offset < pos + p.length) {
        const local = offset - pos;
        const left: Piece = { buffer: p.buffer, start: p.start, length: local };
        const right: Piece = { buffer: p.buffer, start: p.start + local, length: p.length - local };
        this.pieces.splice(i, 1, left, right);
        return i + 1;
      }
      pos += p.length;
    }
    return this.pieces.length;
  }

  private read(p: Piece): string {
    return this.buffer(p.buffer).slice(p.start, p.start + p.length);
  }

  private buffer(which: Piece["buffer"]): string {
    return which === "original" ? this.original : this.add;
  }
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(value, hi));
}
