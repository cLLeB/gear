// A tolerant JSON5/JSONC parser. Real-world config files — tsconfig.json, VS
// Code settings, .babelrc — are not strict JSON: they carry `//` and `/* */`
// comments, trailing commas, single-quoted strings, and unquoted object keys.
// The strict recursive-descent parser in jsonParser.ts intentionally rejects
// those; this one accepts the JSON5 superset so the editor can read and
// understand such files. It is a hand-written recursive-descent parser that
// tracks offsets to give precise error positions.

export type Json5Value = null | boolean | number | string | Json5Value[] | { [key: string]: Json5Value };

export class Json5Error extends Error {
  constructor(message: string, public readonly offset: number) {
    super(`${message} (at offset ${offset})`);
  }
}

class Json5Parser {
  private i = 0;
  constructor(private readonly src: string) {}

  parse(): Json5Value {
    this.skipTrivia();
    const value = this.parseValue();
    this.skipTrivia();
    if (this.i < this.src.length) throw this.error("unexpected trailing content");
    return value;
  }

  private parseValue(): Json5Value {
    this.skipTrivia();
    const c = this.peek();
    if (c === "{") return this.parseObject();
    if (c === "[") return this.parseArray();
    if (c === '"' || c === "'") return this.parseString();
    if (c === "-" || c === "+" || c === "." || isDigit(c) || c === "I" || c === "N") return this.parseNumber();
    if (this.src.startsWith("true", this.i)) { this.i += 4; return true; }
    if (this.src.startsWith("false", this.i)) { this.i += 5; return false; }
    if (this.src.startsWith("null", this.i)) { this.i += 4; return null; }
    throw this.error(`unexpected character ${JSON.stringify(c)}`);
  }

  private parseObject(): { [key: string]: Json5Value } {
    this.i += 1; // {
    const obj: { [key: string]: Json5Value } = {};
    this.skipTrivia();
    if (this.peek() === "}") { this.i += 1; return obj; }
    for (;;) {
      this.skipTrivia();
      const key = this.parseKey();
      this.skipTrivia();
      if (this.peek() !== ":") throw this.error("expected ':' after object key");
      this.i += 1;
      // Assign as an OWN property so a "__proto__" key becomes real data (as
      // JSON.parse does) instead of silently rewriting the object's prototype.
      Object.defineProperty(obj, key, {
        value: this.parseValue(),
        writable: true,
        enumerable: true,
        configurable: true,
      });
      this.skipTrivia();
      const next = this.peek();
      if (next === ",") { this.i += 1; this.skipTrivia(); if (this.peek() === "}") { this.i += 1; return obj; } continue; }
      if (next === "}") { this.i += 1; return obj; }
      throw this.error("expected ',' or '}' in object");
    }
  }

  private parseArray(): Json5Value[] {
    this.i += 1; // [
    const arr: Json5Value[] = [];
    this.skipTrivia();
    if (this.peek() === "]") { this.i += 1; return arr; }
    for (;;) {
      arr.push(this.parseValue());
      this.skipTrivia();
      const next = this.peek();
      if (next === ",") { this.i += 1; this.skipTrivia(); if (this.peek() === "]") { this.i += 1; return arr; } continue; }
      if (next === "]") { this.i += 1; return arr; }
      throw this.error("expected ',' or ']' in array");
    }
  }

  private parseKey(): string {
    const c = this.peek();
    if (c === '"' || c === "'") return this.parseString();
    // Unquoted identifier key.
    const start = this.i;
    if (!/[A-Za-z_$]/.test(c)) throw this.error("invalid object key");
    while (this.i < this.src.length && /[A-Za-z0-9_$]/.test(this.src[this.i])) this.i += 1;
    return this.src.slice(start, this.i);
  }

  private parseString(): string {
    const quote = this.src[this.i++];
    let out = "";
    while (this.i < this.src.length) {
      const c = this.src[this.i++];
      if (c === quote) return out;
      if (c === "\\") {
        const e = this.src[this.i++];
        switch (e) {
          case "n": out += "\n"; break;
          case "t": out += "\t"; break;
          case "r": out += "\r"; break;
          case "b": out += "\b"; break;
          case "f": out += "\f"; break;
          case "\n": break; // line continuation
          case "u": out += String.fromCharCode(parseInt(this.src.slice(this.i, this.i + 4), 16)); this.i += 4; break;
          default: out += e; break;
        }
        continue;
      }
      out += c;
    }
    throw this.error("unterminated string");
  }

  private parseNumber(): number {
    const rest = this.src.slice(this.i);
    const m = /^[+-]?(0[xX][0-9a-fA-F]+|Infinity|NaN|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)/.exec(rest);
    if (!m) throw this.error("invalid number");
    this.i += m[0].length;
    const text = m[0];
    if (/Infinity$/.test(text)) return text[0] === "-" ? -Infinity : Infinity;
    if (/NaN$/.test(text)) return NaN;
    if (/0[xX]/.test(text)) return parseInt(text, 16);
    return Number(text);
  }

  /** Skip whitespace and both comment styles. */
  private skipTrivia(): void {
    for (;;) {
      const c = this.src[this.i];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") { this.i += 1; continue; }
      if (c === "/" && this.src[this.i + 1] === "/") {
        this.i += 2;
        while (this.i < this.src.length && this.src[this.i] !== "\n") this.i += 1;
        continue;
      }
      if (c === "/" && this.src[this.i + 1] === "*") {
        this.i += 2;
        while (this.i < this.src.length && !(this.src[this.i] === "*" && this.src[this.i + 1] === "/")) this.i += 1;
        this.i += 2;
        continue;
      }
      break;
    }
  }

  private peek(): string {
    return this.src[this.i] ?? "";
  }

  private error(message: string): Json5Error {
    return new Json5Error(message, this.i);
  }
}

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}

/** Parse a JSON5/JSONC document into a JavaScript value. */
export function parseJson5(text: string): Json5Value {
  return new Json5Parser(text).parse();
}
