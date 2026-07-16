// A hand-written recursive-descent JSON parser built for editor tooling rather
// than raw deserialization. Unlike JSON.parse it:
//   - reports EVERY error in one pass (error recovery), not just the first;
//   - returns precise start/end offsets for each error;
//   - detects duplicate object keys and (optionally) trailing commas / comments;
//   - never throws — callers always get a best-effort value plus an error list.

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface JsonError {
  message: string;
  from: number;
  to: number;
  code: string;
}

export interface JsonParseResult {
  value: JsonValue | undefined;
  errors: JsonError[];
}

export interface JsonParseOptions {
  allowComments?: boolean;
  allowTrailingCommas?: boolean;
}

type TokType =
  | "{" | "}" | "[" | "]" | ":" | ","
  | "string" | "number" | "true" | "false" | "null" | "eof" | "invalid";

interface Tok {
  type: TokType;
  from: number;
  to: number;
  value?: string | number;
}

function lex(src: string, opts: JsonParseOptions, errors: JsonError[]): Tok[] {
  const toks: Tok[] = [];
  const n = src.length;
  let i = 0;

  const isWs = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r";

  while (i < n) {
    const c = src[i];
    if (isWs(c)) { i++; continue; }

    if (c === "/" && opts.allowComments) {
      if (src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
      if (src[i + 1] === "*") {
        i += 2;
        while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
        i += 2;
        continue;
      }
    }

    if ("{}[]:,".includes(c)) {
      toks.push({ type: c as TokType, from: i, to: i + 1 });
      i++;
      continue;
    }

    if (c === '"') {
      const start = i;
      i++;
      let ok = true;
      while (i < n && src[i] !== '"') {
        if (src[i] === "\\") {
          const esc = src[i + 1];
          if (esc === "u") {
            if (!/[0-9a-fA-F]{4}/.test(src.slice(i + 2, i + 6))) {
              errors.push({ message: "Invalid \\u escape", from: i, to: i + 2, code: "json-bad-escape" });
            }
            i += 6;
          } else if (esc && '"\\/bfnrt'.includes(esc)) {
            i += 2;
          } else {
            errors.push({ message: `Invalid escape \\${esc ?? ""}`, from: i, to: i + 2, code: "json-bad-escape" });
            i += 2;
          }
        } else if (src[i] === "\n") {
          ok = false;
          break;
        } else {
          i++;
        }
      }
      if (src[i] === '"') i++;
      else { ok = false; }
      if (!ok) errors.push({ message: "Unterminated string", from: start, to: i, code: "json-unterminated-string" });
      toks.push({ type: "string", from: start, to: i, value: src.slice(start + 1, ok ? i - 1 : i) });
      continue;
    }

    if (c === "-" || (c >= "0" && c <= "9")) {
      const start = i;
      const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (m && m[0].length > 0) {
        i += m[0].length;
        toks.push({ type: "number", from: start, to: i, value: Number(m[0]) });
      } else {
        errors.push({ message: "Invalid number", from: start, to: start + 1, code: "json-bad-number" });
        i++;
        toks.push({ type: "invalid", from: start, to: i });
      }
      continue;
    }

    if (/[a-z]/.test(c)) {
      const start = i;
      while (i < n && /[a-z]/.test(src[i])) i++;
      const word = src.slice(start, i);
      if (word === "true" || word === "false" || word === "null") {
        toks.push({ type: word as TokType, from: start, to: i });
      } else {
        errors.push({ message: `Unexpected token '${word}'`, from: start, to: i, code: "json-unexpected" });
        toks.push({ type: "invalid", from: start, to: i });
      }
      continue;
    }

    errors.push({ message: `Unexpected character '${c}'`, from: i, to: i + 1, code: "json-unexpected" });
    toks.push({ type: "invalid", from: i, to: i + 1 });
    i++;
  }

  toks.push({ type: "eof", from: n, to: n });
  return toks;
}

/** Parse a JSON (or JSONC) document, returning a value and all errors found. */
export function parseJson(src: string, options: JsonParseOptions = {}): JsonParseResult {
  const errors: JsonError[] = [];
  const toks = lex(src, options, errors);
  let p = 0;

  const peek = () => toks[p];
  const next = () => toks[p++];
  const err = (message: string, t: Tok, code = "json-syntax") =>
    errors.push({ message, from: t.from, to: t.to, code });

  function parseValue(): JsonValue | undefined {
    const t = peek();
    switch (t.type) {
      case "{": return parseObject();
      case "[": return parseArray();
      case "string": next(); return t.value as string;
      case "number": next(); return t.value as number;
      case "true": next(); return true;
      case "false": next(); return false;
      case "null": next(); return null;
      default:
        err(`Expected a value but found '${t.type === "eof" ? "end of input" : src.slice(t.from, t.to)}'`, t);
        if (t.type !== "eof") next();
        return undefined;
    }
  }

  function parseObject(): JsonValue {
    next(); // consume {
    const obj: { [k: string]: JsonValue } = {};
    const seen = new Set<string>();
    if (peek().type === "}") { next(); return obj; }

    for (;;) {
      const keyTok = peek();
      let key: string;
      if (keyTok.type === "string") {
        key = keyTok.value as string;
        next();
        if (seen.has(key)) err(`Duplicate object key "${key}"`, keyTok, "json-duplicate-key");
        seen.add(key);
      } else {
        err("Expected a string key", keyTok);
        key = `__error_${p}`;
        if (keyTok.type !== "}" && keyTok.type !== "eof") next();
      }

      if (peek().type === ":") next();
      else err("Expected ':' after key", peek());

      const value = parseValue();
      if (value !== undefined || keyTok.type === "string") obj[key] = value as JsonValue;

      const sep = peek();
      if (sep.type === ",") {
        next();
        if (peek().type === "}") {
          if (!options.allowTrailingCommas) err("Trailing comma in object", sep, "json-trailing-comma");
          next();
          break;
        }
        continue;
      }
      if (sep.type === "}") { next(); break; }
      if (sep.type === "eof") { err("Unterminated object — missing '}'", sep, "json-unterminated"); break; }
      err("Expected ',' or '}'", sep);
      // Recovery: skip until comma or closing brace.
      while (peek().type !== "," && peek().type !== "}" && peek().type !== "eof") next();
      if (peek().type === ",") next();
      else if (peek().type === "}") { next(); break; }
    }
    return obj;
  }

  function parseArray(): JsonValue {
    next(); // consume [
    const arr: JsonValue[] = [];
    if (peek().type === "]") { next(); return arr; }

    for (;;) {
      const value = parseValue();
      arr.push(value as JsonValue);

      const sep = peek();
      if (sep.type === ",") {
        next();
        if (peek().type === "]") {
          if (!options.allowTrailingCommas) err("Trailing comma in array", sep, "json-trailing-comma");
          next();
          break;
        }
        continue;
      }
      if (sep.type === "]") { next(); break; }
      if (sep.type === "eof") { err("Unterminated array — missing ']'", sep, "json-unterminated"); break; }
      err("Expected ',' or ']'", sep);
      while (peek().type !== "," && peek().type !== "]" && peek().type !== "eof") next();
      if (peek().type === ",") next();
      else if (peek().type === "]") { next(); break; }
    }
    return arr;
  }

  if (peek().type === "eof") {
    err("Empty document", peek(), "json-empty");
    return { value: undefined, errors };
  }

  const value = parseValue();
  if (peek().type !== "eof") {
    err("Unexpected trailing content after JSON value", peek(), "json-trailing");
  }

  return { value, errors };
}
