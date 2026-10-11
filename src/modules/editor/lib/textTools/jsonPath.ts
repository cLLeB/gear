// Path to the value under the cursor in a JSON/JSON5 or YAML document, for
// "Copy JSON path" — the thing you need for jq, lodash.get, JSON Pointer or a
// JSONPath query, without counting brackets by hand.

export type PathSegment = string | number;

interface Frame {
  type: "obj" | "arr";
  key: string | null;
  index: number;
  expectKey: boolean;
}

/** Path at `offset` in JSON (comments, single quotes and bare keys tolerated). */
export function jsonPathAt(text: string, offset: number): PathSegment[] {
  const stack: Frame[] = [];
  let i = 0;
  const end = Math.min(offset, text.length);
  while (i < end) {
    const c = text[i];
    const top = stack[stack.length - 1];
    if (c === '"' || c === "'") {
      let s = "";
      i++;
      while (i < text.length && text[i] !== c) {
        if (text[i] === "\\") {
          s += text[i + 1] ?? "";
          i += 2;
          continue;
        }
        s += text[i];
        i++;
      }
      if (top?.type === "obj" && top.expectKey) top.key = s;
      i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      i = close < 0 ? text.length : close + 2;
      continue;
    }
    if (c === "{") stack.push({ type: "obj", key: null, index: 0, expectKey: true });
    else if (c === "[") stack.push({ type: "arr", key: null, index: 0, expectKey: false });
    else if (c === "}" || c === "]") stack.pop();
    else if (c === ":" && top?.type === "obj") top.expectKey = false;
    else if (c === "," && top) {
      if (top.type === "arr") top.index++;
      else {
        top.expectKey = true;
        top.key = null;
      }
    } else if (/[A-Za-z_$]/.test(c) && top?.type === "obj" && top.expectKey) {
      const m = /^[A-Za-z_$][\w$]*/.exec(text.slice(i));
      top.key = m![0];
      i += m![0].length;
      continue;
    }
    i++;
  }
  const path: PathSegment[] = [];
  for (const f of stack) {
    if (f.type === "arr") path.push(f.index);
    else if (f.key !== null) path.push(f.key);
    else break;
  }
  return path;
}

type Entry = { indent: number; kind: "key" | "item"; key?: string };

function yamlEntries(line: string): Entry[] {
  const stripped = line.replace(/\s+#.*$/, "");
  if (!stripped.trim() || stripped.trim().startsWith("#") || /^\s*(---|\.\.\.)\s*$/.test(stripped)) return [];
  const out: Entry[] = [];
  let pos = /^\s*/.exec(stripped)![0].length;
  let rest = stripped.slice(pos);
  while (/^-(\s|$)/.test(rest)) {
    out.push({ indent: pos, kind: "item" });
    const skip = /^-\s*/.exec(rest)![0].length;
    pos += skip;
    rest = rest.slice(skip);
  }
  const key = /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)'|([^\s"'#][^:#]*?))\s*:(?:\s|$)/.exec(rest);
  if (key) out.push({ indent: pos, kind: "key", key: key[1] ?? key[2]?.replace(/''/g, "'") ?? key[3].trim() });
  return out;
}

/** Path at `offset` in an indentation-based YAML document (block style). */
export function yamlPathAt(text: string, offset: number): PathSegment[] {
  const lines = text.split("\n");
  const cursorLine = text.slice(0, offset).split("\n").length - 1;
  const entries = lines.map(yamlEntries);
  const path: PathSegment[] = [];
  let limit = Infinity;
  // A sequence may sit at the same indent as its parent key.
  let keyAtLimit = false;
  for (let li = cursorLine; li >= 0; li--) {
    const ents = entries[li];
    for (let k = ents.length - 1; k >= 0; k--) {
      const e = ents[k];
      if (e.indent > limit || (e.indent === limit && !(keyAtLimit && e.kind === "key"))) continue;
      if (e.kind === "key") {
        path.unshift(e.key!);
        limit = e.indent;
        keyAtLimit = false;
        continue;
      }
      let index = 0;
      for (let j = li - 1; j >= 0; j--) {
        const first = entries[j][0];
        if (!first) continue;
        if (first.indent < e.indent || (first.indent === e.indent && first.kind === "key")) break;
        if (first.indent === e.indent && first.kind === "item") index++;
      }
      path.unshift(index);
      limit = e.indent;
      keyAtLimit = true;
    }
  }
  return path;
}

const IDENT = /^[A-Za-z_$][\w$]*$/;

export type PathFormat = "jsonpath" | "jq" | "js" | "pointer" | "dotted";

export function formatPath(path: PathSegment[], format: PathFormat): string {
  switch (format) {
    case "pointer":
      return path.length ? `/${path.map((p) => String(p).replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}` : "";
    case "dotted":
      return path.map(String).join(".");
    case "jq": {
      const s = path
        .map((p) => (typeof p === "number" ? `[${p}]` : IDENT.test(p) ? `.${p}` : `[${JSON.stringify(p)}]`))
        .join("");
      return s.startsWith(".") ? s : `.${s}`;
    }
    case "js":
    case "jsonpath": {
      const root = format === "jsonpath" ? "$" : "data";
      return (
        root +
        path
          .map((p) => (typeof p === "number" ? `[${p}]` : IDENT.test(p) ? `.${p}` : `[${format === "jsonpath" ? `'${p.replace(/'/g, "\\'")}'` : JSON.stringify(p)}]`))
          .join("")
      );
    }
  }
}
