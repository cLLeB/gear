// Conversions between JSON and other data formats: CSV, TOML, XML, .env and
// URL query strings, plus JSON arrays as Markdown tables.

import { parseCsv, stringifyCsv } from "@/lib/lang/csv";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

// ── CSV ───────────────────────────────────────────────────────────────────

function inferScalar(s: string): Json {
  const t = s.trim();
  if (t === "") return "";
  if (/^(true|false)$/i.test(t)) return t.toLowerCase() === "true";
  if (/^null$/i.test(t)) return null;
  if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][-+]?\d+)?$/.test(t) && t.length < 16) return Number(t);
  return s;
}

function setPath(obj: Record<string, Json>, path: string, value: Json): void {
  const keys = path.split(".");
  let cur = obj;
  keys.forEach((k, i) => {
    if (i === keys.length - 1) cur[k] = value;
    else {
      if (typeof cur[k] !== "object" || cur[k] === null || Array.isArray(cur[k])) cur[k] = {};
      cur = cur[k] as Record<string, Json>;
    }
  });
}

/** CSV/TSV with a header row → array of objects; dotted headers nest, values are typed. */
export function csvToJson(text: string, delimiter?: string): Json[] {
  const d = delimiter ?? (text.split("\n")[0].includes("\t") ? "\t" : text.split("\n")[0].split(";").length > text.split("\n")[0].split(",").length ? ";" : ",");
  const rows = parseCsv(text.replace(/\r?\n$/, ""), { delimiter: d });
  if (!rows.length) return [];
  const [header, ...body] = rows;
  return body
    .filter((r) => r.some((c) => c !== ""))
    .map((r) => {
      const o: Record<string, Json> = {};
      header.forEach((h, i) => setPath(o, h.trim() || `column${i + 1}`, inferScalar(r[i] ?? "")));
      return o;
    });
}

function flatten(v: Json, prefix: string, out: Record<string, string>): void {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v)) flatten(x, prefix ? `${prefix}.${k}` : k, out);
  } else if (Array.isArray(v)) {
    out[prefix] = v.every((x) => x === null || typeof x !== "object") ? v.join("; ") : JSON.stringify(v);
  } else out[prefix] = v === null ? "" : String(v);
}

/** Array of objects → CSV; nested objects become dotted columns. */
export function jsonToCsv(value: unknown, delimiter = ","): string {
  const list = (Array.isArray(value) ? value : [value]) as Json[];
  const flat = list.map((item) => {
    const o: Record<string, string> = {};
    flatten(item ?? null, "", o);
    if ("" in o) {
      o.value = o[""];
      delete o[""];
    }
    return o;
  });
  const cols: string[] = [];
  for (const o of flat) for (const k of Object.keys(o)) if (!cols.includes(k)) cols.push(k);
  const csv = stringifyCsv([cols, ...flat.map((o) => cols.map((c) => o[c] ?? ""))], { delimiter });
  return csv.endsWith("\n") ? csv : `${csv}\n`;
}

/** Array of objects → Markdown table. */
export function jsonToMarkdownTable(value: unknown): string {
  const csv = jsonToCsv(value);
  const rows = parseCsv(csv.replace(/\r?\n$/, ""));
  const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const widths = rows[0].map((_, i) => Math.max(3, ...rows.map((r) => esc(r[i] ?? "").length)));
  const line = (r: string[]) => `| ${r.map((c, i) => esc(c ?? "").padEnd(widths[i])).join(" | ")} |`;
  return [line(rows[0]), `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`, ...rows.slice(1).map(line)].join("\n") + "\n";
}

// ── TOML ──────────────────────────────────────────────────────────────────

export class TomlError extends Error {}

class TomlReader {
  i = 0;
  constructor(readonly s: string) {}
  ws(): void {
    while (this.i < this.s.length && (this.s[this.i] === " " || this.s[this.i] === "\t")) this.i++;
  }
  wsnl(): void {
    for (;;) {
      this.ws();
      if (this.s[this.i] === "#") while (this.i < this.s.length && this.s[this.i] !== "\n") this.i++;
      if (this.s[this.i] === "\n" || this.s[this.i] === "\r") this.i++;
      else return;
    }
  }
  key(): string[] {
    const parts: string[] = [];
    for (;;) {
      this.ws();
      const c = this.s[this.i];
      if (c === '"' || c === "'") parts.push(this.string());
      else {
        const m = /^[A-Za-z0-9_-]+/.exec(this.s.slice(this.i));
        if (!m) throw new TomlError(`Expected a key at offset ${this.i}`);
        parts.push(m[0]);
        this.i += m[0].length;
      }
      this.ws();
      if (this.s[this.i] !== ".") return parts;
      this.i++;
    }
  }
  string(): string {
    const q = this.s[this.i];
    const triple = this.s.startsWith(q.repeat(3), this.i);
    const close = triple ? q.repeat(3) : q;
    this.i += close.length;
    if (triple && this.s[this.i] === "\n") this.i++;
    let out = "";
    while (this.i < this.s.length && !this.s.startsWith(close, this.i)) {
      const c = this.s[this.i];
      if (!triple && c === "\n") throw new TomlError("Unterminated string");
      if (q === '"' && c === "\\") {
        const n = this.s[this.i + 1];
        const map: Record<string, string> = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\", b: "\b", f: "\f" };
        if (n === "u" || n === "U") {
          const len = n === "u" ? 4 : 8;
          out += String.fromCodePoint(parseInt(this.s.slice(this.i + 2, this.i + 2 + len), 16));
          this.i += 2 + len;
          continue;
        }
        if (triple && n === "\n") {
          this.i += 2;
          while (/\s/.test(this.s[this.i] ?? "")) this.i++;
          continue;
        }
        out += map[n] ?? n;
        this.i += 2;
        continue;
      }
      out += c;
      this.i++;
    }
    if (!this.s.startsWith(close, this.i)) throw new TomlError("Unterminated string");
    this.i += close.length;
    return out;
  }
  value(): Json {
    this.ws();
    const c = this.s[this.i];
    if (c === '"' || c === "'") return this.string();
    if (c === "[") {
      this.i++;
      const arr: Json[] = [];
      for (;;) {
        this.wsnl();
        if (this.s[this.i] === "]") {
          this.i++;
          return arr;
        }
        arr.push(this.value());
        this.wsnl();
        if (this.s[this.i] === ",") this.i++;
      }
    }
    if (c === "{") {
      this.i++;
      const obj: Record<string, Json> = {};
      this.ws();
      if (this.s[this.i] === "}") {
        this.i++;
        return obj;
      }
      for (;;) {
        const k = this.key();
        if (this.s[this.i] !== "=") throw new TomlError("Expected = in inline table");
        this.i++;
        assignPath(obj, k, this.value());
        this.ws();
        if (this.s[this.i] === ",") {
          this.i++;
          continue;
        }
        if (this.s[this.i] === "}") {
          this.i++;
          return obj;
        }
        throw new TomlError("Expected , or } in inline table");
      }
    }
    const m = /^[^\s,\]}#]+(?:[ T]\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)?)?/.exec(this.s.slice(this.i));
    if (!m) throw new TomlError(`Expected a value at offset ${this.i}`);
    this.i += m[0].length;
    const raw = m[0];
    if (raw === "true" || raw === "false") return raw === "true";
    if (/^[+-]?(inf|nan)$/.test(raw)) return raw.replace("+", "");
    if (/^\d{4}-\d\d-\d\d/.test(raw) || /^\d\d:\d\d/.test(raw)) return raw;
    const num = raw.replace(/_/g, "");
    if (/^[+-]?0x[0-9a-f]+$/i.test(num)) return parseInt(num, 16);
    if (/^[+-]?0o[0-7]+$/i.test(num)) return parseInt(num.replace(/0o/i, ""), 8);
    if (/^[+-]?0b[01]+$/i.test(num)) return parseInt(num.replace(/0b/i, ""), 2);
    if (/^[+-]?(\d+)(\.\d+)?([eE][+-]?\d+)?$/.test(num)) return Number(num);
    throw new TomlError(`Unrecognised value "${raw}"`);
  }
}

function assignPath(root: Record<string, Json>, path: string[], value: Json): void {
  let cur = root;
  for (const k of path.slice(0, -1)) {
    if (cur[k] === undefined) cur[k] = {};
    const next = cur[k];
    if (Array.isArray(next)) cur = next[next.length - 1] as Record<string, Json>;
    else if (typeof next === "object" && next !== null) cur = next as Record<string, Json>;
    else throw new TomlError(`Key ${path.join(".")} conflicts with a value`);
  }
  const last = path[path.length - 1];
  if (last in cur) throw new TomlError(`Duplicate key ${path.join(".")}`);
  cur[last] = value;
}

export function parseToml(text: string): Record<string, Json> {
  const r = new TomlReader(text.replace(/\r\n/g, "\n"));
  const root: Record<string, Json> = {};
  let table = root;
  for (;;) {
    r.wsnl();
    if (r.i >= r.s.length) return root;
    if (r.s[r.i] === "[") {
      const array = r.s[r.i + 1] === "[";
      r.i += array ? 2 : 1;
      const path = r.key();
      r.i += array ? 2 : 1;
      let cur = root;
      for (const k of path.slice(0, -1)) {
        if (cur[k] === undefined) cur[k] = {};
        const next = cur[k];
        cur = (Array.isArray(next) ? next[next.length - 1] : next) as Record<string, Json>;
      }
      const last = path[path.length - 1];
      if (array) {
        if (cur[last] === undefined) cur[last] = [];
        const list = cur[last];
        if (!Array.isArray(list)) throw new TomlError(`${path.join(".")} is not an array of tables`);
        const t: Record<string, Json> = {};
        list.push(t);
        table = t;
      } else {
        if (cur[last] === undefined) cur[last] = {};
        table = cur[last] as Record<string, Json>;
      }
      continue;
    }
    const key = r.key();
    if (r.s[r.i] !== "=") throw new TomlError(`Expected = after ${key.join(".")}`);
    r.i++;
    assignPath(table, key, r.value());
    r.ws();
    if (r.s[r.i] === "#") while (r.i < r.s.length && r.s[r.i] !== "\n") r.i++;
    if (r.i < r.s.length && r.s[r.i] !== "\n") throw new TomlError(`Unexpected "${r.s[r.i]}" at offset ${r.i}`);
  }
}

const BARE = /^[A-Za-z0-9_-]+$/;
const tk = (k: string) => (BARE.test(k) ? k : JSON.stringify(k));

function tomlValue(v: Json): string {
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v === null) return '""';
  if (Array.isArray(v)) return `[${v.map(tomlValue).join(", ")}]`;
  return `{ ${Object.entries(v).map(([k, x]) => `${tk(k)} = ${tomlValue(x)}`).join(", ")} }`;
}

const isTable = (v: Json): v is Record<string, Json> => typeof v === "object" && v !== null && !Array.isArray(v);
const isTableArray = (v: Json): v is Record<string, Json>[] => Array.isArray(v) && v.length > 0 && v.every(isTable);

export function toToml(value: unknown, prefix: string[] = []): string {
  if (!isTable(value as Json)) throw new TomlError("TOML needs an object at the top level");
  const obj = value as Record<string, Json>;
  const lines: string[] = [];
  const nested: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (isTable(v)) nested.push(`\n[${[...prefix, k].map(tk).join(".")}]\n${toToml(v, [...prefix, k])}`.replace(/\n{3,}/g, "\n\n"));
    else if (isTableArray(v)) for (const item of v) nested.push(`\n[[${[...prefix, k].map(tk).join(".")}]]\n${toToml(item, [...prefix, k])}`);
    else lines.push(`${tk(k)} = ${tomlValue(v)}`);
  }
  return (lines.join("\n") + (lines.length ? "\n" : "") + nested.join("")).replace(/^\n/, "");
}

// ── XML ───────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decodeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e] ?? m),
  );

/**
 * XML → JSON in the common "BadgerFish-lite" shape: attributes as "@name",
 * text as "#text" (or the bare value when an element has only text), repeated
 * children as arrays.
 */
export function xmlToJson(xml: string): Json {
  const s = xml.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>/g, "");
  let i = 0;
  const node = (): [string, Json] => {
    const open = /^<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/.exec(s.slice(i));
    if (!open) throw new Error(`Malformed XML near offset ${i}`);
    i += open[0].length;
    const name = open[1];
    const o: Record<string, Json> = {};
    for (const a of open[2].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) o[`@${a[1]}`] = decodeXml(a[2] ?? a[3]);
    if (open[3]) return [name, Object.keys(o).length ? o : null];
    let text = "";
    for (;;) {
      const lt = s.indexOf("<", i);
      if (lt < 0) throw new Error(`Unclosed <${name}>`);
      text += s.slice(i, lt);
      i = lt;
      if (s.startsWith("<![CDATA[", i)) {
        const end = s.indexOf("]]>", i);
        text += s.slice(i + 9, end);
        i = end + 3;
        continue;
      }
      if (s.startsWith("</", i)) {
        const close = /^<\/([\w:.-]+)\s*>/.exec(s.slice(i))!;
        if (close[1] !== name) throw new Error(`Expected </${name}> but found </${close[1]}>`);
        i += close[0].length;
        break;
      }
      const [k, v] = node();
      if (k in o) o[k] = Array.isArray(o[k]) ? [...(o[k] as Json[]), v] : [o[k], v];
      else o[k] = v;
    }
    const t = decodeXml(text).trim();
    if (!Object.keys(o).length) return [name, t === "" ? null : (inferScalar(t) as Json)];
    if (t) o["#text"] = t;
    return [name, o];
  };
  i = s.indexOf("<");
  const [k, v] = node();
  return { [k]: v };
}

const escXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function jsonToXml(value: unknown, indent = "  "): string {
  const el = (name: string, v: Json, depth: number): string => {
    const pad = indent.repeat(depth);
    const tag = /^[A-Za-z_][\w.-]*$/.test(name) ? name : "item";
    if (Array.isArray(v)) return v.map((x) => el(tag, x, depth)).join("");
    if (v === null) return `${pad}<${tag}/>\n`;
    if (typeof v !== "object") return `${pad}<${tag}>${escXml(String(v))}</${tag}>\n`;
    const attrs = Object.entries(v)
      .filter(([k]) => k.startsWith("@"))
      .map(([k, x]) => ` ${k.slice(1)}="${escXml(String(x))}"`)
      .join("");
    const kids = Object.entries(v).filter(([k]) => !k.startsWith("@") && k !== "#text");
    const text = v["#text"] !== undefined ? escXml(String(v["#text"])) : "";
    if (!kids.length) return text ? `${pad}<${tag}${attrs}>${text}</${tag}>\n` : `${pad}<${tag}${attrs}/>\n`;
    return `${pad}<${tag}${attrs}>${text ? `\n${pad}${indent}${text}` : ""}\n${kids.map(([k, x]) => el(k, x, depth + 1)).join("")}${pad}</${tag}>\n`;
  };
  const root = value as Json;
  const entries = isTable(root) ? Object.entries(root) : [["root", root] as [string, Json]];
  const body = entries.length === 1 ? el(entries[0][0], entries[0][1], 0) : el("root", root, 0);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;
}

// ── .env and query strings ────────────────────────────────────────────────

export function envToJson(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][\w.-]*)\s*=\s*(.*)$/.exec(lines[n]);
    if (!m) continue;
    let v = m[2];
    const q = v[0];
    if ((q === '"' || q === "'") ) {
      // Values may span lines until the closing quote.
      let body = v.slice(1);
      while (!new RegExp(`(^|[^\\\\])${q}\\s*(#.*)?$`).test(body) && n + 1 < lines.length) body += `\n${lines[++n]}`;
      body = body.replace(new RegExp(`${q}\\s*(#.*)?$`), "");
      v = q === '"' ? body.replace(/\\n/g, "\n").replace(/\\"/g, '"') : body;
    } else v = v.replace(/\s+#.*$/, "").trim();
    out[m[1]] = v;
  }
  return out;
}

export function jsonToEnv(value: unknown): string {
  const flat: Record<string, string> = {};
  flatten((value ?? {}) as Json, "", flat);
  return (
    Object.entries(flat)
      .map(([k, v]) => {
        const key = k.replace(/[^A-Za-z0-9]+/g, "_").replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
        const needsQuotes = /[\s#"'$\\]/.test(v) || v === "";
        return `${key}=${needsQuotes ? JSON.stringify(v) : v}`;
      })
      .join("\n") + "\n"
  );
}

/** "a=1&b[]=2&b[]=3&c[d]=4" (or a full URL) → object; repeated keys become arrays. */
export function queryToJson(input: string): Record<string, Json> {
  const qs = input.includes("?") ? input.slice(input.indexOf("?") + 1) : input;
  const out: Record<string, Json> = {};
  for (const pair of qs.replace(/#.*$/, "").split("&")) {
    if (!pair) continue;
    const [rawK, rawV = ""] = pair.split(/=(.*)/s);
    const k = decodeURIComponent(rawK.replace(/\+/g, " "));
    const v = inferScalar(decodeURIComponent(rawV.replace(/\+/g, " ")));
    const path = k.replace(/\]/g, "").split("[");
    let cur: Record<string, Json> = out;
    path.forEach((p, i) => {
      const last = i === path.length - 1;
      if (last) {
        if (p === "") return;
        if (path[i + 1] === "" || k.endsWith("[]")) return;
        if (p in cur) cur[p] = Array.isArray(cur[p]) ? [...(cur[p] as Json[]), v] : [cur[p], v];
        else cur[p] = v;
      } else if (path[i + 1] === "" && i + 1 === path.length - 1) {
        cur[p] = [...((Array.isArray(cur[p]) ? cur[p] : []) as Json[]), v];
      } else {
        if (!isTable(cur[p] ?? null)) cur[p] = {};
        cur = cur[p] as Record<string, Json>;
      }
    });
  }
  return out;
}

export function jsonToQuery(value: unknown): string {
  const parts: string[] = [];
  const enc = encodeURIComponent;
  const walk = (v: Json, key: string) => {
    if (Array.isArray(v)) v.forEach((x) => walk(x, `${key}[]`));
    else if (isTable(v)) for (const [k, x] of Object.entries(v)) walk(x, key ? `${key}[${k}]` : k);
    else parts.push(`${enc(key).replace(/%5B/g, "[").replace(/%5D/g, "]")}=${enc(v === null ? "" : String(v))}`);
  };
  walk(value as Json, "");
  return parts.join("&");
}
