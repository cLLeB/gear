// Smaller text utilities: statistics, extra line sorts, number bases, case
// changes, and a scanner for invisible / bidi / homoglyph characters.

// ── statistics ────────────────────────────────────────────────────────────

export interface TextStats {
  characters: number;
  charactersNoSpaces: number;
  words: number;
  uniqueWords: number;
  lines: number;
  sentences: number;
  paragraphs: number;
  readingMinutes: number;
  speakingMinutes: number;
  topWords: [string, number][];
}

const STOP = new Set("the a an and or of to in is it that for on with as be at by this are was from not but have".split(" "));

export function textStats(text: string): TextStats {
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) ?? [];
  const counts = new Map<string, number>();
  for (const w of words) {
    const k = w.toLowerCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const topWords = [...counts]
    .filter(([w]) => w.length > 2 && !STOP.has(w))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5);
  return {
    characters: [...text].length,
    charactersNoSpaces: [...text.replace(/\s/g, "")].length,
    words: words.length,
    uniqueWords: counts.size,
    lines: text ? text.split(/\r?\n/).length : 0,
    sentences: (text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? []).length || (words.length ? 1 : 0),
    paragraphs: text.split(/\n\s*\n/).filter((p) => p.trim()).length,
    readingMinutes: words.length / 238,
    speakingMinutes: words.length / 150,
    topWords,
  };
}

export function formatMinutes(m: number): string {
  if (m < 1) return `${Math.max(1, Math.round(m * 60))} s`;
  return `${Math.round(m)} min`;
}

// ── line sorts ────────────────────────────────────────────────────────────

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** "file2" before "file10". */
export function sortNatural(lines: readonly string[], desc = false): string[] {
  const out = [...lines].sort(collator.compare);
  return desc ? out.reverse() : out;
}

export function sortByLength(lines: readonly string[], desc = false): string[] {
  // Stable: equal lengths keep their order.
  return lines
    .map((l, i) => [l, i] as const)
    .sort((a, b) => (desc ? b[0].length - a[0].length : a[0].length - b[0].length) || a[1] - b[1])
    .map(([l]) => l);
}

/** Sort by the leading number on each line (non-numeric lines last). */
export function sortNumeric(lines: readonly string[], desc = false): string[] {
  const num = (l: string) => {
    const m = /[-+]?(\d+(\.\d*)?|\.\d+)(e[-+]?\d+)?/i.exec(l.replace(/,(?=\d{3})/g, ""));
    return m ? Number(m[0]) : NaN;
  };
  return lines
    .map((l, i) => ({ l, i, n: num(l) }))
    .sort((a, b) => {
      if (Number.isNaN(a.n) || Number.isNaN(b.n)) return Number(Number.isNaN(a.n)) - Number(Number.isNaN(b.n)) || a.i - b.i;
      return (desc ? b.n - a.n : a.n - b.n) || a.i - b.i;
    })
    .map(({ l }) => l);
}

/** Sort by a 1-based delimited column (auto-detects tab, comma, |, ;, whitespace). */
export function sortByColumn(lines: readonly string[], column: number, desc = false): string[] {
  const sample = lines.find((l) => l.trim()) ?? "";
  const delim = ["\t", ",", "|", ";"].find((d) => sample.includes(d));
  const cell = (l: string) => (delim ? l.split(delim) : l.trim().split(/\s+/))[column - 1]?.trim() ?? "";
  const out = lines.map((l, i) => ({ l, i, c: cell(l) })).sort((a, b) => collator.compare(a.c, b.c) || a.i - b.i);
  return (desc ? out.reverse() : out).map(({ l }) => l);
}

/** Fisher–Yates; `random` is injectable for tests. */
export function shuffleLines(lines: readonly string[], random: () => number = Math.random): string[] {
  const out = [...lines];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ── number bases ──────────────────────────────────────────────────────────

/** Parses 0x / 0b / 0o / decimal (with _ or , separators); null when not an integer literal. */
export function parseIntegerLiteral(raw: string): bigint | null {
  const s = raw.trim().replace(/[_,']/g, "").replace(/[uUlLnN]+$/, "");
  const neg = s.startsWith("-");
  const body = s.replace(/^[-+]/, "");
  let v: bigint;
  try {
    if (/^0x[0-9a-f]+$/i.test(body)) v = BigInt(body);
    else if (/^0b[01]+$/i.test(body)) v = BigInt(body);
    else if (/^0o[0-7]+$/i.test(body)) v = BigInt(body);
    else if (/^#[0-9a-f]+$/i.test(body)) v = BigInt(`0x${body.slice(1)}`);
    else if (/^\d+$/.test(body)) v = BigInt(body);
    else return null;
  } catch {
    return null;
  }
  return neg ? -v : v;
}

function group(s: string, size: number, sep: string): string {
  const out: string[] = [];
  for (let i = s.length; i > 0; i -= size) out.unshift(s.slice(Math.max(0, i - size), i));
  return out.join(sep);
}

export function integerForms(v: bigint): { label: string; value: string }[] {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const sign = neg ? "-" : "";
  const forms = [
    { label: "Decimal", value: `${sign}${a.toString(10)}` },
    { label: "Hex", value: `${sign}0x${a.toString(16).toUpperCase()}` },
    { label: "Binary", value: `${sign}0b${a.toString(2)}` },
    { label: "Octal", value: `${sign}0o${a.toString(8)}` },
    { label: "Decimal (grouped)", value: `${sign}${group(a.toString(10), 3, ",")}` },
    { label: "Binary (nibbles)", value: `${sign}0b${group(a.toString(2), 4, "_")}` },
  ];
  if (!neg && a <= 0x10ffffn && a >= 0x20n) forms.push({ label: "Character", value: String.fromCodePoint(Number(a)) });
  if (!neg && a < 1n << 53n) {
    const n = Number(a);
    if (n >= 1e9 && n < 1e10) forms.push({ label: "As Unix time", value: new Date(n * 1000).toISOString() });
    if (n >= 1e12 && n < 1e13) forms.push({ label: "As Unix ms", value: new Date(n).toISOString() });
    const units = ["B", "KiB", "MiB", "GiB", "TiB"];
    let size = n;
    let u = 0;
    while (size >= 1024 && u < units.length - 1) {
      size /= 1024;
      u++;
    }
    if (u > 0) forms.push({ label: "As bytes", value: `${size.toFixed(2).replace(/\.?0+$/, "")} ${units[u]}` });
  }
  return forms;
}

// ── case ──────────────────────────────────────────────────────────────────

const SMALL = new Set("a an and as at but by for in nor of on or the to up via vs".split(" "));

export function titleCase(s: string): string {
  let first = true;
  return s.replace(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu, (w, offset: number) => {
    const lower = w.toLowerCase();
    const atStart = first || /[:.!?]\s*$/.test(s.slice(0, offset));
    first = false;
    // Leave acronyms / mixed case (iPhone, NASA) alone.
    if (/[A-Z]/.test(w.slice(1)) && w !== w.toUpperCase()) return w;
    if (w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w)) return w;
    if (!atStart && SMALL.has(lower)) return lower;
    return lower[0].toUpperCase() + lower.slice(1);
  });
}

export function sentenceCase(s: string): string {
  return s.toLowerCase().replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (_m, pre: string, c: string) => pre + c.toUpperCase());
}

export function swapCase(s: string): string {
  return [...s].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join("");
}

// ── invisible / bidi / homoglyph characters ───────────────────────────────

export type SuspiciousKind = "bidi" | "invisible" | "space" | "homoglyph";

export interface SuspiciousChar {
  from: number;
  to: number;
  kind: SuspiciousKind;
  label: string;
}

const NAMES: Record<number, string> = {
  0x200b: "ZERO WIDTH SPACE",
  0x200c: "ZERO WIDTH NON-JOINER",
  0x200d: "ZERO WIDTH JOINER",
  0x2060: "WORD JOINER",
  0xfeff: "ZERO WIDTH NO-BREAK SPACE (BOM)",
  0x00ad: "SOFT HYPHEN",
  0x180e: "MONGOLIAN VOWEL SEPARATOR",
  0x200e: "LEFT-TO-RIGHT MARK",
  0x200f: "RIGHT-TO-LEFT MARK",
  0x061c: "ARABIC LETTER MARK",
  0x202a: "LEFT-TO-RIGHT EMBEDDING",
  0x202b: "RIGHT-TO-LEFT EMBEDDING",
  0x202c: "POP DIRECTIONAL FORMATTING",
  0x202d: "LEFT-TO-RIGHT OVERRIDE",
  0x202e: "RIGHT-TO-LEFT OVERRIDE",
  0x2066: "LEFT-TO-RIGHT ISOLATE",
  0x2067: "RIGHT-TO-LEFT ISOLATE",
  0x2068: "FIRST STRONG ISOLATE",
  0x2069: "POP DIRECTIONAL ISOLATE",
  0x00a0: "NO-BREAK SPACE",
  0x202f: "NARROW NO-BREAK SPACE",
  0x205f: "MEDIUM MATHEMATICAL SPACE",
  0x3000: "IDEOGRAPHIC SPACE",
  0x2028: "LINE SEPARATOR",
  0x2029: "PARAGRAPH SEPARATOR",
};

function classify(cp: number): SuspiciousKind | null {
  if ((cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069) || cp === 0x200e || cp === 0x200f || cp === 0x061c) return "bidi";
  if ((cp >= 0x200b && cp <= 0x200d) || cp === 0x2060 || cp === 0xfeff || cp === 0x00ad || cp === 0x180e || (cp >= 0xe0000 && cp <= 0xe007f)) return "invisible";
  if (cp === 0x00a0 || (cp >= 0x2000 && cp <= 0x200a) || cp === 0x202f || cp === 0x205f || cp === 0x3000 || cp === 0x2028 || cp === 0x2029) return "space";
  return null;
}

const LATIN = /\p{Script=Latin}/u;
const CONFUSABLE = /[\p{Script=Cyrillic}\p{Script=Greek}]/u;

/**
 * Characters that make code read differently from how it runs: bidi controls
 * (CVE-2021-42574 "Trojan Source"), zero-width characters, look-alike spaces,
 * and words mixing Latin with Cyrillic/Greek letters (homoglyph spoofing).
 * A BOM at offset 0 is allowed.
 */
export function findSuspiciousChars(text: string): SuspiciousChar[] {
  const out: SuspiciousChar[] = [];
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const len = cp > 0xffff ? 2 : 1;
    const kind = classify(cp);
    if (kind && !(cp === 0xfeff && i === 0)) {
      const hex = cp.toString(16).toUpperCase().padStart(4, "0");
      out.push({ from: i, to: i + len, kind, label: `U+${hex} ${NAMES[cp] ?? (cp >= 0xe0000 ? "TAG CHARACTER" : "SPACE")}` });
    }
    i += len;
  }
  for (const m of text.matchAll(/[\p{L}\p{N}_]+/gu)) {
    const w = m[0];
    if (!LATIN.test(w) || !CONFUSABLE.test(w)) continue;
    for (let k = 0; k < w.length; k++) {
      if (CONFUSABLE.test(w[k])) {
        const at = m.index! + k;
        out.push({ from: at, to: at + 1, kind: "homoglyph", label: `U+${w.codePointAt(k)!.toString(16).toUpperCase().padStart(4, "0")} look-alike letter in “${w}”` });
      }
    }
  }
  return out.sort((a, b) => a.from - b.from);
}

/** Remove bidi/invisible characters and turn odd spaces into plain spaces. Homoglyphs are left alone. */
export function cleanSuspiciousChars(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const len = cp > 0xffff ? 2 : 1;
    const kind = classify(cp);
    if (kind === "space") out += cp === 0x2028 || cp === 0x2029 ? "\n" : " ";
    else if (!kind || (cp === 0xfeff && i === 0)) out += text.slice(i, i + len);
    i += len;
  }
  return out;
}
