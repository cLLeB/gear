// A compact YAML 1.2 subset: enough to round-trip configuration files
// (Kubernetes manifests, GitHub workflows, docker-compose, OpenAPI) to and
// from JSON. Supported: block mappings and sequences, nested indentation,
// plain/single/double-quoted scalars, flow sequences and mappings, block
// scalars (| and > with chomping), comments, documents separated by `---`,
// and core-schema typing of plain scalars. Anchors/aliases and tags are not.

export class YamlError extends Error {
  constructor(message: string, readonly line: number) {
    super(`${message} (line ${line})`);
  }
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

// ---------------------------------------------------------------- emitting

const RESERVED = /^(true|false|null|yes|no|on|off|~|-?\.inf|\.nan)$/i;

function needsQuotes(s: string): boolean {
  if (s === "") return true;
  if (RESERVED.test(s)) return true;
  if (/^[-+]?(\d[\d_]*(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(s) || /^0[xo][0-9a-f]+$/i.test(s)) return true;
  if (/^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(s) || /\s$/.test(s)) return true;
  if (/: |\s#|\n|\t/.test(s) || s.endsWith(":")) return true;
  return false;
}

function scalar(v: null | boolean | number | string): string {
  if (v === null) return "null";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  return needsQuotes(v) ? JSON.stringify(v) : v;
}

function emit(v: Json, indent: number, out: string[], prefix: string): void {
  const pad = " ".repeat(indent);
  if (Array.isArray(v)) {
    if (v.length === 0) {
      out.push(`${prefix}[]`);
      return;
    }
    if (prefix) out.push(prefix.trimEnd());
    for (const item of v) {
      if (item !== null && typeof item === "object" && !Array.isArray(item) && Object.keys(item).length > 0) {
        // "- key: value" with the rest of the mapping aligned under the key.
        const lines: string[] = [];
        emit(item, indent + 2, lines, "");
        lines[0] = `${pad}- ${lines[0].trimStart()}`;
        out.push(...lines);
      } else if (Array.isArray(item) && item.length > 0) {
        out.push(`${pad}-`);
        emit(item, indent + 2, out, "");
      } else {
        emitInline(item, `${pad}- `, indent + 2, out);
      }
    }
    return;
  }
  if (v !== null && typeof v === "object") {
    const keys = Object.keys(v);
    if (keys.length === 0) {
      out.push(`${prefix}{}`);
      return;
    }
    if (prefix) out.push(prefix.trimEnd());
    for (const k of keys) {
      const key = needsQuotes(k) ? JSON.stringify(k) : k;
      const val = v[k];
      if (val !== null && typeof val === "object" && (Array.isArray(val) ? val.length > 0 : Object.keys(val).length > 0)) {
        out.push(`${pad}${key}:`);
        emit(val, Array.isArray(val) ? indent : indent + 2, out, "");
      } else {
        emitInline(val, `${pad}${key}: `, indent + 2, out);
      }
    }
    return;
  }
  emitInline(v, prefix, indent, out);
}

function emitInline(v: Json, lead: string, indent: number, out: string[]): void {
  if (Array.isArray(v)) out.push(`${lead}[]`);
  else if (v !== null && typeof v === "object") out.push(`${lead}{}`);
  else if (typeof v === "string" && v.includes("\n")) {
    const chomp = v.endsWith("\n") ? (v.endsWith("\n\n") ? "+" : "") : "-";
    out.push(`${lead}|${chomp}`);
    const body = v.endsWith("\n") ? v.slice(0, -1) : v;
    for (const l of body.split("\n")) out.push(l === "" ? "" : `${" ".repeat(indent)}${l}`);
  } else out.push(`${lead}${scalar(v)}`);
}

export function toYaml(value: unknown): string {
  const out: string[] = [];
  emit(value as Json, 0, out, "");
  return `${out.join("\n")}\n`;
}

// ---------------------------------------------------------------- parsing

interface Line {
  n: number; // 1-based line number
  indent: number;
  text: string; // content without indentation and trailing comment
  raw: string;
}

function stripComment(s: string): string {
  let inS = false;
  let inD = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS && s[i - 1] !== "\\") inD = !inD;
    else if (c === "#" && !inS && !inD && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
  }
  return s.trimEnd();
}

function plainScalar(s: string): Json {
  const t = s.trim();
  if (t === "" || t === "~" || t === "null" || t === "Null" || t === "NULL") return null;
  if (/^(true|True|TRUE)$/.test(t)) return true;
  if (/^(false|False|FALSE)$/.test(t)) return false;
  if (/^[-+]?\d+$/.test(t)) {
    const n = Number(t);
    return Number.isSafeInteger(n) ? n : t;
  }
  if (/^0x[0-9a-fA-F]+$/.test(t)) return parseInt(t, 16);
  if (/^0o[0-7]+$/.test(t)) return parseInt(t.slice(2), 8);
  if (/^[-+]?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$/.test(t)) return Number(t);
  if (/^[-+]?\.(inf|Inf|INF)$/.test(t)) return t.startsWith("-") ? -Infinity : Infinity;
  if (/^\.(nan|NaN|NAN)$/.test(t)) return NaN;
  return t;
}

class FlowParser {
  i = 0;
  constructor(readonly s: string, readonly line: number) {}
  ws() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }
  value(): Json {
    this.ws();
    const c = this.s[this.i];
    if (c === "[") {
      this.i++;
      const arr: Json[] = [];
      this.ws();
      if (this.s[this.i] === "]") {
        this.i++;
        return arr;
      }
      for (;;) {
        arr.push(this.value());
        this.ws();
        if (this.s[this.i] === ",") {
          this.i++;
          this.ws();
          if (this.s[this.i] === "]") {
            this.i++;
            return arr;
          }
          continue;
        }
        if (this.s[this.i] === "]") {
          this.i++;
          return arr;
        }
        throw new YamlError("Expected , or ] in flow sequence", this.line);
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
        const key = this.value();
        this.ws();
        if (this.s[this.i] !== ":") throw new YamlError("Expected : in flow mapping", this.line);
        this.i++;
        obj[String(key)] = this.value();
        this.ws();
        if (this.s[this.i] === ",") {
          this.i++;
          this.ws();
          if (this.s[this.i] === "}") {
            this.i++;
            return obj;
          }
          continue;
        }
        if (this.s[this.i] === "}") {
          this.i++;
          return obj;
        }
        throw new YamlError("Expected , or } in flow mapping", this.line);
      }
    }
    if (c === '"' || c === "'") {
      const { value, end } = quoted(this.s, this.i, this.line);
      this.i = end;
      return value;
    }
    const start = this.i;
    while (this.i < this.s.length && !/[,\]}]/.test(this.s[this.i]) && !(this.s[this.i] === ":" && /[\s,\]}]|$/.test(this.s[this.i + 1] ?? ""))) this.i++;
    return plainScalar(this.s.slice(start, this.i));
  }
}

function quoted(s: string, start: number, line: number): { value: string; end: number } {
  const q = s[start];
  let out = "";
  let i = start + 1;
  while (i < s.length) {
    const c = s[i];
    if (q === "'" && c === "'") {
      if (s[i + 1] === "'") {
        out += "'";
        i += 2;
        continue;
      }
      return { value: out, end: i + 1 };
    }
    if (q === '"' && c === "\\") {
      const e = s[i + 1];
      const map: Record<string, string> = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\", "/": "/", "0": "\0", b: "\b" };
      if (e === "u") {
        out += String.fromCharCode(parseInt(s.slice(i + 2, i + 6), 16));
        i += 6;
        continue;
      }
      out += map[e] ?? e;
      i += 2;
      continue;
    }
    if (q === '"' && c === '"') return { value: out, end: i + 1 };
    out += c;
    i++;
  }
  throw new YamlError("Unterminated quoted string", line);
}

function inlineValue(text: string, line: number): Json {
  const t = text.trim();
  if (t.startsWith("[") || t.startsWith("{")) {
    const p = new FlowParser(t, line);
    const v = p.value();
    p.ws();
    if (p.i !== t.length) throw new YamlError("Unexpected text after flow collection", line);
    return v;
  }
  if (t.startsWith('"') || t.startsWith("'")) {
    const { value, end } = quoted(t, 0, line);
    if (t.slice(end).trim() !== "") throw new YamlError("Unexpected text after quoted scalar", line);
    return value;
  }
  return plainScalar(t);
}

/** Split "key: value" at the first mapping colon outside quotes. */
function splitKey(text: string): { key: string; rest: string } | null {
  let inS = false;
  let inD = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS && text[i - 1] !== "\\") inD = !inD;
    else if (c === ":" && !inS && !inD && (i + 1 === text.length || text[i + 1] === " ")) {
      let key = text.slice(0, i).trim();
      if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
        key = quoted(key, 0, 0).value;
      }
      return { key, rest: text.slice(i + 1).trim() };
    }
    if ((c === "[" || c === "{") && !inS && !inD && i === 0) return null;
  }
  return null;
}

class BlockParser {
  pos = 0;
  constructor(readonly lines: Line[], readonly rawLines: string[]) {}

  peek(): Line | undefined {
    return this.lines[this.pos];
  }

  parseNode(indent: number): Json {
    const line = this.peek();
    if (!line || line.indent < indent) return null;
    if (line.text.startsWith("- ") || line.text === "-") return this.parseSeq(line.indent);
    if (splitKey(line.text)) return this.parseMap(line.indent);
    this.pos++;
    return inlineValue(line.text, line.n);
  }

  blockScalar(header: string, parentIndent: number, lineNo: number): string {
    const style = header[0];
    const chomp = header.includes("-") ? "strip" : header.includes("+") ? "keep" : "clip";
    // Collect raw lines (including blank ones) that are more indented.
    const startRaw = lineNo; // raw index of the first content line
    const body: string[] = [];
    let blockIndent = -1;
    let r = startRaw;
    for (; r < this.rawLines.length; r++) {
      const raw = this.rawLines[r];
      if (raw.trim() === "") {
        body.push("");
        continue;
      }
      const ind = raw.length - raw.trimStart().length;
      if (ind <= parentIndent) break;
      if (blockIndent === -1) blockIndent = ind;
      if (ind < blockIndent) break;
      body.push(raw.slice(blockIndent));
    }
    // Skip parsed lines that were consumed by the block.
    while (this.peek() && this.peek()!.n <= r) this.pos++;
    let trailing = 0;
    while (body.length > 0 && body[body.length - 1] === "") {
      body.pop();
      trailing++;
    }
    let text =
      style === "|"
        ? body.join("\n")
        : body.reduce(
            // Folding: line breaks become spaces; a blank line is a newline.
            (acc, l, i) => (l === "" ? `${acc}\n` : i === 0 || body[i - 1] === "" ? acc + l : `${acc} ${l}`),
            "",
          );
    if (chomp === "clip") text += "\n";
    else if (chomp === "keep") text += "\n".repeat(trailing + 1);
    return text;
  }

  valueAfter(rest: string, line: Line, childIndent: number): Json {
    if (rest === "" ) {
      const next = this.peek();
      if (next && (next.indent > line.indent || (next.indent === line.indent && next.text.startsWith("- ")))) {
        return this.parseNode(next.indent);
      }
      return null;
    }
    if (/^[|>][-+]?\d*$/.test(rest)) return this.blockScalar(rest, line.indent, line.n);
    void childIndent;
    return inlineValue(rest, line.n);
  }

  parseMap(indent: number): Json {
    const obj: Record<string, Json> = {};
    for (let line = this.peek(); line && line.indent === indent; line = this.peek()) {
      const kv = splitKey(line.text);
      if (!kv) throw new YamlError(`Expected "key: value"`, line.n);
      this.pos++;
      if (kv.key in obj) throw new YamlError(`Duplicate key "${kv.key}"`, line.n);
      obj[kv.key] = this.valueAfter(kv.rest, line, indent + 2);
    }
    const stray = this.peek();
    if (stray && stray.indent > indent) throw new YamlError("Unexpected indentation", stray.n);
    return obj;
  }

  parseSeq(indent: number): Json {
    const arr: Json[] = [];
    for (let line = this.peek(); line && line.indent === indent && (line.text.startsWith("- ") || line.text === "-"); line = this.peek()) {
      const rest = line.text === "-" ? "" : line.text.slice(2);
      if (rest === "") {
        this.pos++;
        const next = this.peek();
        arr.push(next && next.indent > indent ? this.parseNode(next.indent) : null);
        continue;
      }
      // "- key: value" starts a mapping whose keys align after "- ".
      const childIndent = indent + 2 + (rest.length - rest.trimStart().length);
      if (splitKey(rest.trimStart()) && !/^[[{"']/.test(rest.trimStart())) {
        this.lines[this.pos] = { ...line, indent: childIndent, text: rest.trimStart() };
        arr.push(this.parseMap(childIndent));
      } else if (rest.trimStart().startsWith("- ")) {
        this.lines[this.pos] = { ...line, indent: childIndent, text: rest.trimStart() };
        arr.push(this.parseSeq(childIndent));
      } else {
        this.pos++;
        arr.push(this.valueAfter(rest.trim(), { ...line, indent }, childIndent));
      }
    }
    return arr;
  }
}

/** Parse YAML; multiple `---` documents yield an array of documents. */
export function parseYaml(text: string): unknown {
  const rawLines = text.replace(/\r\n?/g, "\n").split("\n");
  const docs: Line[][] = [[]];
  rawLines.forEach((raw, i) => {
    if (/^---(\s|$)/.test(raw)) {
      if (docs[docs.length - 1].length > 0) docs.push([]);
      const after = raw.slice(3).trim();
      if (after) docs[docs.length - 1].push({ n: i + 1, indent: 0, text: stripComment(after), raw });
      return;
    }
    if (/^\.\.\.\s*$/.test(raw)) return;
    if (/^%/.test(raw)) return; // directives
    const content = stripComment(raw);
    if (content.trim() === "") return;
    if (/\t/.test(raw.slice(0, raw.length - raw.trimStart().length))) {
      throw new YamlError("Tabs are not allowed for indentation", i + 1);
    }
    docs[docs.length - 1].push({ n: i + 1, indent: raw.length - raw.trimStart().length, text: content.trim(), raw });
  });
  const results = docs.map((lines) => {
    if (lines.length === 0) return null;
    const p = new BlockParser(lines, rawLines);
    const v = p.parseNode(lines[0].indent);
    const left = p.peek();
    if (left) throw new YamlError("Unexpected content", left.n);
    return v;
  });
  return results.length === 1 ? results[0] : results;
}

/** Recursively sort object keys (arrays keep their order). */
export function sortKeysDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as object)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map((k) => [k, sortKeysDeep((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

/** Detect the indentation a JSON document uses, for re-serialising. */
export function detectJsonIndent(text: string): string | number {
  const m = /^\{\s*\n([ \t]+)"/.exec(text) ?? /\n([ \t]+)["{[]/.exec(text);
  if (!m) return 2;
  return m[1].includes("\t") ? "\t" : m[1].length;
}
