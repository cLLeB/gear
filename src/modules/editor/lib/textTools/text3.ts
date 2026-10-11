// Third set of text tools: JSON ⇄ JS literals, language string escaping,
// join/split/wrap lines, CSV transpose, line frequencies, colour palettes,
// extra encodings, ID / URL inspection, validation, JSON Schema, flattening,
// Markdown → HTML and SQL keyword case.

import { parseCsv, stringifyCsv } from "@/lib/lang/csv";
import { parseJson5 } from "@/lib/lang/json5";
import { parseJson } from "@/lib/lang/jsonParser";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

// ── JSON ⇄ JS object literal ──────────────────────────────────────────────

const IDENT = /^[A-Za-z_$][\w$]*$/;

export function toJsLiteral(value: unknown, indent = "  ", depth = 0): string {
  const pad = indent.repeat(depth + 1);
  const end = indent.repeat(depth);
  if (value === null || typeof value !== "object") return typeof value === "string" ? `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n")}'` : String(value);
  if (Array.isArray(value)) return value.length ? `[\n${value.map((v) => pad + toJsLiteral(v, indent, depth + 1)).join(",\n")},\n${end}]` : "[]";
  const entries = Object.entries(value as object);
  if (!entries.length) return "{}";
  return `{\n${entries.map(([k, v]) => `${pad}${IDENT.test(k) ? k : `'${k.replace(/'/g, "\\'")}'`}: ${toJsLiteral(v, indent, depth + 1)}`).join(",\n")},\n${end}}`;
}

/** JS/JSON5 literal (unquoted keys, single quotes, trailing commas) → strict JSON. */
export function jsLiteralToJson(text: string): string {
  return `${JSON.stringify(parseJson5(text.trim().replace(/;$/, "")), null, 2)}\n`;
}

// ── escaping per language ─────────────────────────────────────────────────

export type EscapeTarget = "c" | "java" | "python" | "shell" | "powershell" | "sql" | "regex" | "csv" | "xml";

export function escapeFor(text: string, target: EscapeTarget): string {
  switch (target) {
    case "c":
    case "java":
      return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")}"`;
    case "python":
      return text.includes("\n") ? `"""${text.replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"')}"""` : `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    case "shell":
      return `'${text.replace(/'/g, `'\\''`)}'`;
    case "powershell":
      return `'${text.replace(/'/g, "''")}'`;
    case "sql":
      return `'${text.replace(/'/g, "''")}'`;
    case "regex":
      return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    case "csv":
      return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    case "xml":
      return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }
}

export function unescapeFrom(text: string, target: EscapeTarget): string {
  const t = text.trim();
  switch (target) {
    case "c":
    case "java":
    case "python": {
      const body = t.replace(/^("""|"|')([\s\S]*)\1$/, "$2");
      return body.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_m, e: string) => {
        if (e[0] === "u" && e.length === 5) return String.fromCharCode(parseInt(e.slice(1), 16));
        if (e[0] === "x" && e.length === 3) return String.fromCharCode(parseInt(e.slice(1), 16));
        return ({ n: "\n", r: "\r", t: "\t", "0": "\0" } as Record<string, string>)[e] ?? e;
      });
    }
    case "shell":
      return t.replace(/^'([\s\S]*)'$/, "$1").replace(/'\\''/g, "'");
    case "powershell":
    case "sql":
      return t.replace(/^'([\s\S]*)'$/, "$1").replace(/''/g, "'");
    case "regex":
      return t.replace(/\\([.*+?^${}()|[\]\\/])/g, "$1");
    case "csv":
      return t.replace(/^"([\s\S]*)"$/, "$1").replace(/""/g, '"');
    case "xml":
      return t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  }
}

// ── lines ─────────────────────────────────────────────────────────────────

export function joinLines(text: string, separator: string, quote = ""): string {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `${quote}${l}${quote}`)
    .join(separator);
}

export function splitToLines(text: string, delimiter: string): string {
  const d = delimiter === "\\t" ? "\t" : delimiter;
  return text
    .split(d)
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n");
}

export function wrapLines(text: string, prefix: string, suffix: string, skipBlank = true): string {
  return text
    .split("\n")
    .map((l) => (skipBlank && !l.trim() ? l : `${prefix}${l}${suffix}`))
    .join("\n");
}

/** Lines → SQL `IN (...)` list with quoting. */
export function sqlInList(text: string): string {
  const items = text.split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean);
  const numeric = items.every((s) => /^-?\d+(\.\d+)?$/.test(s));
  return `IN (${items.map((s) => (numeric ? s : `'${s.replace(/'/g, "''")}'`)).join(", ")})`;
}

export function transposeCsv(text: string): string {
  const d = text.includes("\t") ? "\t" : ",";
  const rows = parseCsv(text.replace(/\r?\n$/, ""), { delimiter: d });
  const width = Math.max(...rows.map((r) => r.length));
  const out = Array.from({ length: width }, (_, c) => rows.map((r) => r[c] ?? ""));
  return `${stringifyCsv(out, { delimiter: d })}\n`.replace(/\n\n$/, "\n");
}

/** "count  line" for every distinct line, most frequent first (like sort | uniq -c | sort -rn). */
export function lineFrequencies(text: string, ignoreCase = false): string {
  const counts = new Map<string, { n: number; first: string }>();
  for (const l of text.split(/\r?\n/)) {
    if (!l.trim()) continue;
    const k = ignoreCase ? l.toLowerCase() : l;
    const c = counts.get(k);
    if (c) c.n++;
    else counts.set(k, { n: 1, first: l });
  }
  const rows = [...counts.values()].sort((a, b) => b.n - a.n);
  const w = String(rows[0]?.n ?? 0).length;
  return rows.map((r) => `${String(r.n).padStart(w)}  ${r.first}`).join("\n") + "\n";
}

// ── colours ───────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
const mixRgb = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);

/** Tailwind-style 50…950 scale around a base colour (500). */
export function colorScale(hex: string, name = "brand"): { step: number; hex: string }[] {
  if (!/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex.trim())) throw new Error("Use a hex colour like #3b82f6");
  const base = hexToRgb(hex.trim());
  void name;
  const steps: [number, number][] = [[50, 0.95], [100, 0.9], [200, 0.75], [300, 0.6], [400, 0.3], [500, 0], [600, -0.15], [700, -0.3], [800, -0.45], [900, -0.6], [950, -0.75]];
  return steps.map(([step, t]) => ({ step, hex: toHex(t >= 0 ? mixRgb(base, [255, 255, 255], t) : mixRgb(base, [0, 0, 0], -t)) }));
}

export function colorScaleCss(hex: string, name: string, format: "css" | "tailwind" | "scss"): string {
  const scale = colorScale(hex, name);
  if (format === "tailwind") return `${name}: {\n${scale.map((s) => `  ${s.step}: "${s.hex}",`).join("\n")}\n},\n`;
  if (format === "scss") return scale.map((s) => `$${name}-${s.step}: ${s.hex};`).join("\n") + "\n";
  return `:root {\n${scale.map((s) => `  --${name}-${s.step}: ${s.hex};`).join("\n")}\n}\n`;
}

// ── extra encodings ───────────────────────────────────────────────────────

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const enc = new TextEncoder();
const dec = new TextDecoder();

export function base32Encode(text: string): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of enc.encode(text)) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out.padEnd(Math.ceil(out.length / 8) * 8, "=");
}

export function base32Decode(text: string): string {
  const clean = text.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    const i = B32.indexOf(c);
    if (i < 0) throw new Error(`Invalid Base32 character "${c}"`);
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return dec.decode(new Uint8Array(out));
}

export function base58Encode(text: string): string {
  const bytes = enc.encode(text);
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

export function base58Decode(text: string): string {
  let n = 0n;
  for (const c of text.trim()) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error(`Invalid Base58 character "${c}"`);
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n % 256n));
    n /= 256n;
  }
  for (const c of text.trim()) {
    if (c !== "1") break;
    bytes.unshift(0);
  }
  return dec.decode(new Uint8Array(bytes));
}

export const rot13 = (s: string) => s.replace(/[a-z]/gi, (c) => String.fromCharCode(((c.toLowerCase().charCodeAt(0) - 97 + 13) % 26) + (c <= "Z" ? 65 : 97)));

const MORSE: Record<string, string> = {
  a: ".-", b: "-...", c: "-.-.", d: "-..", e: ".", f: "..-.", g: "--.", h: "....", i: "..", j: ".---", k: "-.-", l: ".-..", m: "--",
  n: "-.", o: "---", p: ".--.", q: "--.-", r: ".-.", s: "...", t: "-", u: "..-", v: "...-", w: ".--", x: "-..-", y: "-.--", z: "--..",
  "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-", "5": ".....", "6": "-....", "7": "--...", "8": "---..", "9": "----.",
  ".": ".-.-.-", ",": "--..--", "?": "..--..", "/": "-..-.", "@": ".--.-.", "-": "-....-", "(": "-.--.", ")": "-.--.-", "!": "-.-.--",
};
const MORSE_REV = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));

export const toMorse = (s: string) => s.toLowerCase().split(/\s+/).map((w) => [...w].map((c) => MORSE[c] ?? "").filter(Boolean).join(" ")).join(" / ");
export const fromMorse = (s: string) => s.trim().split(/\s*\/\s*/).map((w) => w.split(/\s+/).map((c) => MORSE_REV[c] ?? "?").join("")).join(" ");
export const toBinary = (s: string) => [...enc.encode(s)].map((b) => b.toString(2).padStart(8, "0")).join(" ");
export const fromBinary = (s: string) => dec.decode(new Uint8Array(s.trim().split(/\s+/).map((b) => parseInt(b, 2))));

// ── ID / URL inspection ───────────────────────────────────────────────────

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Explain a UUID, ULID, MongoDB ObjectId, Snowflake or KSUID-like id. */
export function inspectId(id: string): { label: string; value: string }[] {
  const s = id.trim();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-([0-9a-f])[0-9a-f]{3}-([0-9a-f])[0-9a-f]{3}-[0-9a-f]{12}$/i.exec(s);
  if (uuid) {
    const version = parseInt(uuid[1], 16);
    const variant = parseInt(uuid[2], 16);
    const rows = [
      { label: "Type", value: s === "00000000-0000-0000-0000-000000000000" ? "Nil UUID" : `UUID version ${version}` },
      { label: "Variant", value: variant >= 8 && variant <= 11 ? "RFC 9562" : variant >= 12 ? "Microsoft (GUID)" : "NCS (legacy)" },
    ];
    const hex = s.replace(/-/g, "");
    if (version === 7) rows.push({ label: "Created", value: new Date(parseInt(hex.slice(0, 12), 16)).toISOString() });
    if (version === 1) {
      const t = BigInt(`0x${hex.slice(13, 16)}${hex.slice(8, 12)}${hex.slice(0, 8)}`);
      rows.push({ label: "Created", value: new Date(Number((t - 122192928000000000n) / 10000n)).toISOString() });
      rows.push({ label: "Node (MAC)", value: hex.slice(20).replace(/(..)(?!$)/g, "$1:") });
    }
    if (version === 4) rows.push({ label: "Randomness", value: "122 random bits" });
    return rows;
  }
  if (/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(s)) {
    const t = [...s.slice(0, 10).toUpperCase()].reduce((n, c) => n * 32 + CROCKFORD.indexOf(c), 0);
    return [{ label: "Type", value: "ULID" }, { label: "Created", value: new Date(t).toISOString() }];
  }
  if (/^[0-9a-f]{24}$/i.test(s)) {
    return [
      { label: "Type", value: "MongoDB ObjectId (probably)" },
      { label: "Created", value: new Date(parseInt(s.slice(0, 8), 16) * 1000).toISOString() },
      { label: "Counter", value: String(parseInt(s.slice(18), 16)) },
    ];
  }
  if (/^\d{15,20}$/.test(s)) {
    const n = BigInt(s);
    const twitter = Number((n >> 22n) + 1288834974657n);
    const discord = Number((n >> 22n) + 1420070400000n);
    return [
      { label: "Type", value: "Snowflake id (64-bit)" },
      { label: "Created if Twitter/X", value: new Date(twitter).toISOString() },
      { label: "Created if Discord", value: new Date(discord).toISOString() },
      { label: "Worker / process / sequence", value: `${(n >> 17n) & 31n} / ${(n >> 12n) & 31n} / ${n & 4095n}` },
    ];
  }
  throw new Error("Not a UUID, ULID, ObjectId or Snowflake id");
}

export function inspectUrl(raw: string): { label: string; value: string }[] {
  const u = new URL(raw.trim());
  const rows = [
    { label: "Protocol", value: u.protocol.replace(/:$/, "") },
    { label: "Host", value: u.hostname },
    ...(u.port ? [{ label: "Port", value: u.port }] : []),
    { label: "Path", value: decodeURIComponent(u.pathname) },
    ...(u.username ? [{ label: "User", value: u.username + (u.password ? " (has password!)" : "") }] : []),
    ...[...u.searchParams.entries()].map(([k, v]) => ({ label: `?${k}`, value: v })),
    ...(u.hash ? [{ label: "Fragment", value: decodeURIComponent(u.hash.slice(1)) }] : []),
    { label: "Origin", value: u.origin },
  ];
  return rows;
}

// ── validation ────────────────────────────────────────────────────────────

export interface ValidationError {
  message: string;
  line: number;
  column: number;
}

/** Strict JSON validation with the first error's position. */
export function validateJson(text: string): ValidationError | null {
  const { errors } = parseJson(text);
  if (!errors.length) return null;
  const e = errors[0];
  const before = text.slice(0, e.from).split("\n");
  return { message: e.message, line: before.length, column: before[before.length - 1].length + 1 };
}

// ── JSON Schema & flattening ──────────────────────────────────────────────

/** Draft 2020-12 schema inferred from a sample (arrays merge their items). */
export function jsonSchemaFrom(value: unknown, title?: string): Record<string, unknown> {
  const schemaOf = (v: unknown): Record<string, unknown> => {
    if (v === null) return { type: "null" };
    if (Array.isArray(v)) {
      if (!v.length) return { type: "array", items: {} };
      const items = v.map(schemaOf);
      return { type: "array", items: items.reduce(mergeSchemas) };
    }
    switch (typeof v) {
      case "string":
        return /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(v)
          ? { type: "string", format: "date-time" }
          : /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)
            ? { type: "string", format: "email" }
            : /^https?:\/\//.test(v)
              ? { type: "string", format: "uri" }
              : /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v)
                ? { type: "string", format: "uuid" }
                : { type: "string" };
      case "number":
        return { type: Number.isInteger(v) ? "integer" : "number" };
      case "boolean":
        return { type: "boolean" };
      default: {
        const o = v as Record<string, unknown>;
        return { type: "object", properties: Object.fromEntries(Object.entries(o).map(([k, x]) => [k, schemaOf(x)])), required: Object.keys(o), additionalProperties: false };
      }
    }
  };
  return { $schema: "https://json-schema.org/draft/2020-12/schema", ...(title ? { title } : {}), ...schemaOf(value) };
}

function mergeSchemas(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  if (JSON.stringify(a) === JSON.stringify(b)) return a;
  if (a.type === "object" && b.type === "object") {
    const pa = a.properties as Record<string, Record<string, unknown>>;
    const pb = b.properties as Record<string, Record<string, unknown>>;
    const keys = [...new Set([...Object.keys(pa), ...Object.keys(pb)])];
    const props = Object.fromEntries(keys.map((k) => [k, pa[k] && pb[k] ? mergeSchemas(pa[k], pb[k]) : (pa[k] ?? pb[k])]));
    const required = (a.required as string[]).filter((k) => (b.required as string[]).includes(k));
    return { type: "object", properties: props, required, additionalProperties: false };
  }
  if ((a.type === "integer" && b.type === "number") || (a.type === "number" && b.type === "integer")) return { type: "number" };
  const types = [...new Set([a.type, b.type].flat())];
  return { type: types };
}

export function flattenJson(value: unknown, sep = "."): Record<string, Json> {
  const out: Record<string, Json> = {};
  const walk = (v: unknown, path: string) => {
    if (v !== null && typeof v === "object" && Object.keys(v as object).length) {
      for (const [k, x] of Object.entries(v as object)) walk(x, path ? `${path}${sep}${k}` : k);
    } else out[path] = v as Json;
  };
  walk(value, "");
  return out;
}

export function unflattenJson(flat: Record<string, unknown>, sep = "."): Json {
  const root: Record<string, Json> = {};
  for (const [key, v] of Object.entries(flat)) {
    const parts = key.split(sep);
    let cur: Record<string, Json> | Json[] = root;
    parts.forEach((p, i) => {
      const last = i === parts.length - 1;
      const nextIsIndex = /^\d+$/.test(parts[i + 1] ?? "");
      const c = cur as Record<string, Json>;
      if (last) c[p] = v as Json;
      else {
        if (c[p] === undefined || typeof c[p] !== "object" || c[p] === null) c[p] = nextIsIndex ? [] : {};
        cur = c[p] as Record<string, Json>;
      }
    });
  }
  return root;
}

// ── Markdown → HTML ───────────────────────────────────────────────────────

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function inline(s: string): string {
  return escHtml(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img alt="$1" src="$2">')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\w*])[*_]([^*_]+)[*_](?=[^\w*]|$)/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");
}

/** Common Markdown → HTML (headings, lists, code, quotes, tables, links, emphasis). */
export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    const fence = /^```(\w*)/.exec(l);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(`<pre><code${fence[1] ? ` class="language-${fence[1]}"` : ""}>${escHtml(body.join("\n"))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) {
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(l)) {
      out.push("<hr>");
      i++;
      continue;
    }
    if (/^\|.*\|\s*$/.test(l) && /^\|?\s*:?-{3,}/.test(lines[i + 1] ?? "")) {
      const cells = (r: string) => r.replace(/^\||\|\s*$/g, "").split("|").map((c) => inline(c.trim()));
      const head = cells(l);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    if (/^>\s?/.test(l)) {
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${markdownToHtml(q.join("\n")).trim()}</blockquote>`);
      continue;
    }
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(l);
    if (li) {
      const ordered = /\d/.test(li[2]);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        const t = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(lines[i++])![1];
        const task = /^\[( |x)\]\s+(.*)$/i.exec(t);
        items.push(task ? `<li><input type="checkbox" disabled${task[1] !== " " ? " checked" : ""}> ${inline(task[2])}</li>` : `<li>${inline(t)}</li>`);
      }
      out.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }
    if (!l.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>|\s*([-*+]|\d+[.)])\s|\|)/.test(lines[i])) para.push(lines[i++]);
    out.push(`<p>${inline(para.join("\n")).replace(/ {2}\n/g, "<br>\n")}</p>`);
  }
  return `${out.join("\n")}\n`;
}

// ── SQL keyword case ──────────────────────────────────────────────────────

const SQL_KEYWORDS = "select from where and or not in is null like between join inner left right full outer cross on as group by order having limit offset union all distinct insert into values update set delete create table alter drop index view primary key foreign references default constraint unique check case when then else end exists with returning asc desc count sum avg min max coalesce cast over partition interval true false".split(" ");

export function sqlKeywordCase(sql: string, upper = true): string {
  const re = new RegExp(`\\b(${SQL_KEYWORDS.join("|")})\\b`, "gi");
  // Leave string literals and quoted identifiers alone.
  return sql.replace(/('(?:''|[^'])*'|"(?:[^"])*"|`[^`]*`)|([^'"`]+)/g, (_m, quoted?: string, code?: string) => quoted ?? code!.replace(re, (k) => (upper ? k.toUpperCase() : k.toLowerCase())));
}

export function minifySql(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/('(?:''|[^'])*')|\s+/g, (_m, q?: string) => q ?? " ")
    .replace(/\s*([(),;=<>])\s*/g, "$1")
    .trim();
}
