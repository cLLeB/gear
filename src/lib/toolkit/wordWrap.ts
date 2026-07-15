export interface WordWrapOptions {
  /** Column width to wrap at. Defaults to 80. */
  width?: number;
  /** Break words longer than width instead of overflowing. Defaults to true. */
  breakLongWords?: boolean;
  /** Preserve existing newlines as hard breaks. Defaults to true. */
  preserveNewlines?: boolean;
}

/**
 * Greedy word-wrap for plain text. Wraps on spaces, optionally hard-breaking
 * words longer than the target width. Handy for status lines and help output.
 */
export function wordWrap(text: string, options: WordWrapOptions = {}): string {
  const { width = 80, breakLongWords = true, preserveNewlines = true } = options;
  if (width <= 0) return text;

  const paragraphs = preserveNewlines ? text.split("\n") : [text.replace(/\n/g, " ")];

  return paragraphs
    .map((para) => wrapParagraph(para, width, breakLongWords))
    .join("\n");
}

function wrapParagraph(para: string, width: number, breakLongWords: boolean): string {
  const words = para.split(/ +/);
  const lines: string[] = [];
  let current = "";

  for (let word of words) {
    while (breakLongWords && word.length > width) {
      if (current) {
        lines.push(current);
        current = "";
      }
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }

    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current || lines.length === 0) lines.push(current);
  return lines.join("\n");
}
