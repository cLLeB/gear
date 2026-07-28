// Convert between absolute string offsets and 1-based line/column positions.
// Precomputes line-start offsets once so repeated lookups (a diagnostics pass
// produces many) are O(log n) via binary search rather than O(n) rescans.

export interface Position {
  /** 1-based line number. */
  line: number;
  /** 1-based column number. */
  column: number;
}

export class PositionMapper {
  private readonly lineStarts: number[];

  constructor(private readonly source: string) {
    const starts = [0];
    for (let i = 0; i < source.length; i++) {
      if (source[i] === "\n") starts.push(i + 1);
    }
    this.lineStarts = starts;
  }

  /** Offset -> 1-based line/column. */
  positionAt(offset: number): Position {
    const clamped = Math.max(0, Math.min(offset, this.source.length));
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (this.lineStarts[mid] <= clamped) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: clamped - this.lineStarts[lo] + 1 };
  }

  /** 1-based line/column -> offset. */
  offsetAt(position: Position): number {
    const line = Math.max(1, Math.min(position.line, this.lineStarts.length));
    const base = this.lineStarts[line - 1];
    const nextLine = line < this.lineStarts.length ? this.lineStarts[line] - 1 : this.source.length;
    return Math.min(base + Math.max(0, position.column - 1), nextLine);
  }

  /** Total number of lines. */
  get lineCount(): number {
    return this.lineStarts.length;
  }

  /** The text of a 1-based line without its trailing newline. */
  lineText(line: number): string {
    if (line < 1 || line > this.lineStarts.length) return "";
    const start = this.lineStarts[line - 1];
    const end = line < this.lineStarts.length ? this.lineStarts[line] - 1 : this.source.length;
    return this.source.slice(start, end).replace(/\r$/, "");
  }
}
