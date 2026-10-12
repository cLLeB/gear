// Hex editor: byte edits (returning new arrays, so undo is a stack of
// snapshots' differences), searching, and decoding the bytes at the cursor.

export const BYTES_PER_ROW = 16;

export function hex2(b: number): string {
  return b.toString(16).padStart(2, "0").toUpperCase();
}

export function offsetLabel(offset: number, size: number): string {
  return offset.toString(16).toUpperCase().padStart(size > 0xffffffff ? 12 : 8, "0");
}

export function printable(b: number): string {
  return b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : "·";
}

export type Edit = { kind: "set"; at: number; before: number; after: number } | { kind: "insert"; at: number; bytes: number[] } | { kind: "delete"; at: number; bytes: number[] };

export function applyEdit(data: Uint8Array, e: Edit): Uint8Array {
  if (e.kind === "set") {
    const out = data.slice();
    out[e.at] = e.after;
    return out;
  }
  if (e.kind === "insert") {
    const out = new Uint8Array(data.length + e.bytes.length);
    out.set(data.subarray(0, e.at));
    out.set(e.bytes, e.at);
    out.set(data.subarray(e.at), e.at + e.bytes.length);
    return out;
  }
  const out = new Uint8Array(data.length - e.bytes.length);
  out.set(data.subarray(0, e.at));
  out.set(data.subarray(e.at + e.bytes.length), e.at);
  return out;
}

export function invert(e: Edit): Edit {
  if (e.kind === "set") return { kind: "set", at: e.at, before: e.after, after: e.before };
  return e.kind === "insert" ? { kind: "delete", at: e.at, bytes: e.bytes } : { kind: "insert", at: e.at, bytes: e.bytes };
}

/**
 * Typing one hex digit over the byte at `at`. `high` says whether this is the
 * first digit of the byte (it replaces the high nibble) or the second.
 */
export function typeNibble(data: Uint8Array, at: number, digit: number, high: boolean): Extract<Edit, { kind: "set" }> {
  const before = data[at];
  const after = high ? (digit << 4) | (before & 0x0f) : (before & 0xf0) | digit;
  return { kind: "set", at, before, after };
}

/**
 * A search needle from what the user typed: `48 65 6c`, `48656c`, `0x48,0x65`
 * are bytes; anything else — or text in quotes — is matched as UTF-8.
 */
export function parseNeedle(query: string): { bytes: number[]; kind: "hex" | "text" } | null {
  const q = query.trim();
  if (!q) return null;
  const quoted = /^(["'])(.*)\1$/s.exec(q);
  if (!quoted) {
    const compact = q.replace(/0x/gi, "").replace(/[\s,:-]+/g, "");
    if (/^[0-9a-f]+$/i.test(compact) && compact.length % 2 === 0) {
      const bytes: number[] = [];
      for (let i = 0; i < compact.length; i += 2) bytes.push(Number.parseInt(compact.slice(i, i + 2), 16));
      return { bytes, kind: "hex" };
    }
  }
  return { bytes: [...new TextEncoder().encode(quoted ? quoted[2] : q)], kind: "text" };
}

/** Index of the next match at or after `from`, wrapping round; -1 when absent. */
export function findBytes(data: Uint8Array, needle: number[], from: number, backwards = false): number {
  const n = needle.length;
  if (!n || n > data.length) return -1;
  const last = data.length - n;
  const matches = (i: number) => {
    for (let k = 0; k < n; k++) if (data[i + k] !== needle[k]) return false;
    return true;
  };
  const start = Math.max(0, Math.min(from, last));
  if (backwards) {
    for (let i = Math.min(from, last); i >= 0; i--) if (matches(i)) return i;
    for (let i = last; i > from; i--) if (matches(i)) return i;
  } else {
    for (let i = start; i <= last; i++) if (matches(i)) return i;
    for (let i = 0; i < start; i++) if (matches(i)) return i;
  }
  return -1;
}

/** An offset typed by the user: `1024`, `0x400`, `400h`, or `+16` / `-16` relative to `current`. */
export function parseOffset(text: string, current: number, size: number): number | null {
  const m = /^\s*([+-])?\s*(0x[0-9a-f]+|[0-9a-f]+h|\d+)\s*$/i.exec(text);
  if (!m) return null;
  const raw = m[2].toLowerCase();
  const value = raw.startsWith("0x") ? Number.parseInt(raw.slice(2), 16) : raw.endsWith("h") ? Number.parseInt(raw.slice(0, -1), 16) : Number.parseInt(raw, 10);
  const target = m[1] === "+" ? current + value : m[1] === "-" ? current - value : value;
  return target >= 0 && target < Math.max(size, 1) ? target : null;
}

export interface Reading {
  label: string;
  value: string;
}

/** The bytes at `at` read as the usual number types, in the chosen byte order. */
export function inspect(data: Uint8Array, at: number, littleEndian: boolean): Reading[] {
  const left = data.length - at;
  if (left <= 0) return [];
  const view = new DataView(data.buffer, data.byteOffset + at, Math.min(left, 8));
  const out: Reading[] = [
    { label: "uint8", value: String(view.getUint8(0)) },
    { label: "int8", value: String(view.getInt8(0)) },
    { label: "binary", value: view.getUint8(0).toString(2).padStart(8, "0") },
    { label: "char", value: printable(view.getUint8(0)) },
  ];
  if (left >= 2) out.push({ label: "uint16", value: String(view.getUint16(0, littleEndian)) }, { label: "int16", value: String(view.getInt16(0, littleEndian)) });
  if (left >= 4) out.push({ label: "uint32", value: String(view.getUint32(0, littleEndian)) }, { label: "int32", value: String(view.getInt32(0, littleEndian)) }, { label: "float32", value: String(view.getFloat32(0, littleEndian)) });
  if (left >= 8) out.push({ label: "uint64", value: view.getBigUint64(0, littleEndian).toString() }, { label: "int64", value: view.getBigInt64(0, littleEndian).toString() }, { label: "float64", value: String(view.getFloat64(0, littleEndian)) });
  if (left >= 4) {
    const secs = view.getUint32(0, littleEndian);
    // Only plausible dates (2000–2100) are worth showing.
    if (secs > 946684800 && secs < 4102444800) out.push({ label: "unix time", value: new Date(secs * 1000).toISOString() });
  }
  return out;
}

/** Bytes parsed from pasted text: hex pairs when it looks like hex, UTF-8 otherwise. */
export function bytesFromPaste(text: string): number[] {
  return parseNeedle(text)?.bytes ?? [];
}

export function rowCount(size: number): number {
  return Math.max(1, Math.ceil((size + 1) / BYTES_PER_ROW));
}
