// vim-surround for the editor: wrap a selection in a pair, and find, remove
// or change the innermost pair enclosing a range. Brackets are matched with
// nesting; quotes are matched on the same line, honouring backslash escapes.

export interface Pair {
  open: string;
  close: string;
}

const BRACKETS: Record<string, string> = { "(": ")", "[": "]", "{": "}", "<": ">" };
const QUOTES = new Set(['"', "'", "`"]);

/** Turn a user choice ("(", "'", "<div class='x'>", "**") into a pair. */
export function pairFor(spec: string): Pair {
  const s = spec.trim();
  if (BRACKETS[s]) return { open: s, close: BRACKETS[s] };
  const closing = Object.entries(BRACKETS).find(([, c]) => c === s);
  if (closing) return { open: closing[0], close: s };
  const tag = /^<([A-Za-z][\w:-]*)([^>]*)>$/.exec(s);
  if (tag) return { open: s, close: `</${tag[1]}>` };
  if (/^[A-Za-z][\w:-]*$/.test(s)) return { open: `<${s}>`, close: `</${s}>` };
  return { open: s, close: s }; // quotes and symmetric markers (**, _, ~~)
}

export function wrap(text: string, pair: Pair): string {
  return `${pair.open}${text}${pair.close}`;
}

export interface FoundPair {
  openFrom: number;
  openTo: number;
  closeFrom: number;
  closeTo: number;
}

function isEscaped(doc: string, i: number): boolean {
  let n = 0;
  for (let j = i - 1; j >= 0 && doc[j] === "\\"; j--) n++;
  return n % 2 === 1;
}

function enclosingBracket(doc: string, from: number, to: number): FoundPair | null {
  const closers = new Set(Object.values(BRACKETS));
  const stack: string[] = [];
  for (let i = from - 1; i >= 0; i--) {
    const c = doc[i];
    if (closers.has(c) && c !== ">") stack.push(c);
    else if (BRACKETS[c] && c !== "<") {
      if (stack.length > 0) {
        if (stack[stack.length - 1] === BRACKETS[c]) stack.pop();
        continue;
      }
      // Found an unmatched opener; find its closer after `to`.
      const close = BRACKETS[c];
      let depth = 0;
      for (let j = i + 1; j < doc.length; j++) {
        if (doc[j] === c) depth++;
        else if (doc[j] === close) {
          if (depth === 0) {
            if (j < to) break; // closes before the selection ends: not enclosing
            return { openFrom: i, openTo: i + 1, closeFrom: j, closeTo: j + 1 };
          }
          depth--;
        }
      }
    }
  }
  return null;
}

function enclosingQuote(doc: string, from: number, to: number): FoundPair | null {
  const lineStart = doc.lastIndexOf("\n", from - 1) + 1;
  let lineEnd = doc.indexOf("\n", to);
  if (lineEnd === -1) lineEnd = doc.length;
  let best: FoundPair | null = null;
  for (const q of QUOTES) {
    // Walk quote pairs on the line left to right; pick one that encloses.
    let open = -1;
    for (let i = lineStart; i < lineEnd; i++) {
      if (doc[i] !== q || isEscaped(doc, i)) continue;
      if (open === -1) open = i;
      else {
        if (open < from && i >= to) {
          const cand = { openFrom: open, openTo: open + 1, closeFrom: i, closeTo: i + 1 };
          if (!best || cand.openFrom > best.openFrom) best = cand;
        }
        open = -1;
      }
    }
  }
  return best;
}

function enclosingTag(doc: string, from: number, to: number): FoundPair | null {
  const openRe = /<([A-Za-z][\w:-]*)(?:\s[^<>]*)?>/g;
  let best: FoundPair | null = null;
  for (const m of doc.slice(0, from).matchAll(openRe)) {
    const name = m[1];
    const openFrom = m.index!;
    const openTo = openFrom + m[0].length;
    // Find the matching close tag accounting for nesting of the same name.
    const re = new RegExp(`<(/?)${name}(?:\\s[^<>]*)?>`, "g");
    re.lastIndex = openTo;
    let depth = 0;
    for (let t = re.exec(doc); t; t = re.exec(doc)) {
      if (t[1] === "") depth++;
      else if (depth === 0) {
        if (t.index >= to && (!best || openFrom > best.openFrom)) {
          best = { openFrom, openTo, closeFrom: t.index, closeTo: t.index + t[0].length };
        }
        break;
      } else depth--;
    }
  }
  return best;
}

/** The innermost bracket, quote or tag pair enclosing [from, to). */
export function findEnclosingPair(doc: string, from: number, to: number): FoundPair | null {
  const candidates = [enclosingBracket(doc, from, to), enclosingQuote(doc, from, to), enclosingTag(doc, from, to)].filter(
    (p): p is FoundPair => p !== null,
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (b.openFrom > a.openFrom ? b : a));
}
