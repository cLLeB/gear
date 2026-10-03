// Increment/decrement the number-like token at a position (Vim's Ctrl-A /
// Ctrl-X, generalised): decimal integers and floats (keeping their precision
// and zero padding), hex (0xff, keeping case and width), binary, ISO dates
// (YYYY-MM-DD, by day) and booleans-as-numbers are all understood.

export interface IncrementResult {
  from: number;
  to: number;
  text: string;
}

const TOKEN_RE =
  /(\d{4}-\d{2}-\d{2})|(0[xX][0-9a-fA-F]+)|(0[bB][01]+)|(-?\d+\.\d+)|(-?\d+)/g;

function pad(n: number, width: number): string {
  const s = String(Math.abs(n));
  return (n < 0 ? "-" : "") + s.padStart(width, "0");
}

function bumpDecimal(tok: string, delta: number): string {
  const neg = tok.startsWith("-");
  const digits = neg ? tok.slice(1) : tok;
  const value = BigInt(tok) + BigInt(delta);
  // Keep zero padding ("007" → "008") when the token had a leading zero.
  if (digits.length > 1 && digits.startsWith("0")) {
    const abs = value < 0n ? -value : value;
    return (value < 0n ? "-" : "") + abs.toString().padStart(digits.length, "0");
  }
  return value.toString();
}

function bumpFloat(tok: string, delta: number): string {
  const decimals = tok.split(".")[1].length;
  const scale = 10 ** decimals;
  // Step the last decimal place: 1.25 + 1 → 1.26, like editors that respect precision.
  const v = Math.round(Number(tok) * scale) + delta;
  const neg = v < 0;
  const s = Math.abs(v).toString().padStart(decimals + 1, "0");
  return `${neg ? "-" : ""}${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
}

function bumpHex(tok: string, delta: number): string {
  const body = tok.slice(2);
  const upper = body !== body.toLowerCase();
  const max = 1n << BigInt(body.length * 4);
  let v = (BigInt(`0x${body}`) + BigInt(delta)) % max;
  if (v < 0n) v += max;
  const out = v.toString(16).padStart(body.length, "0");
  return tok.slice(0, 2) + (upper ? out.toUpperCase() : out);
}

function bumpBinary(tok: string, delta: number): string {
  const body = tok.slice(2);
  let v = BigInt(`0b${body}`) + BigInt(delta);
  if (v < 0n) v = 0n;
  return tok.slice(0, 2) + v.toString(2).padStart(body.length, "0");
}

function bumpDate(tok: string, delta: number): string {
  const [y, m, d] = tok.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + delta));
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;
}

/**
 * Find the token under `offset` within `line` (or, like Vim, the first one to
 * its right) and return the replacement for that span. `offset` is relative
 * to the start of `line`.
 */
export function incrementAt(line: string, offset: number, delta: number): IncrementResult | null {
  TOKEN_RE.lastIndex = 0;
  let best: RegExpExecArray | null = null;
  for (let m = TOKEN_RE.exec(line); m; m = TOKEN_RE.exec(line)) {
    const start = m.index;
    const end = start + m[0].length;
    if (end < offset) continue;
    best = m;
    break;
  }
  if (!best) return null;
  let from = best.index;
  let tok = best[0];
  // A minus sign only counts when it is not a binary operator (x-1 stays x-1 → x-2).
  if (tok.startsWith("-") && from > 0 && /[\w)\]]/.test(line[from - 1])) {
    from += 1;
    tok = tok.slice(1);
  }
  let text: string;
  if (best[1]) text = bumpDate(tok, delta);
  else if (best[2]) text = bumpHex(tok, delta);
  else if (best[3]) text = bumpBinary(tok, delta);
  else if (best[4]) text = bumpFloat(tok, delta);
  else text = bumpDecimal(tok, delta);
  return { from, to: from + tok.length, text };
}
