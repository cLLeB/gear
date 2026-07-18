// A snippet engine implementing the LSP snippet grammar: tabstops (`$1`, `$0`),
// placeholders with nested content (`${1:default}`), choices (`${1|a,b,c|}`),
// variables (`$TM_FILENAME`, `${VAR:fallback}`), mirrors (the same index used
// more than once), and variable/tabstop transforms (`${VAR/regex/format/opts}`).
// Parsing is a recursive descent over the template; expansion walks the tree,
// substituting variable values and recording the absolute range of every
// tabstop so an editor can drive tab-through navigation and linked-edit mirrors.

export type SnippetNode =
  | { kind: "text"; value: string }
  | { kind: "tabstop"; index: number; transform?: Transform }
  | { kind: "placeholder"; index: number; children: SnippetNode[] }
  | { kind: "choice"; index: number; options: string[] }
  | { kind: "variable"; name: string; children: SnippetNode[]; transform?: Transform };

export interface Transform {
  regex: RegExp;
  format: string;
}

export interface TabStopRange {
  from: number;
  to: number;
}

export interface TabStop {
  index: number;
  ranges: TabStopRange[];
  /** Present for choice tabstops. */
  options?: string[];
}

export interface Expansion {
  text: string;
  /** Tabstops in navigation order: 1, 2, … then $0 (final cursor) last. */
  tabStops: TabStop[];
}

// --- Parser ----------------------------------------------------------------

class SnippetParser {
  private i = 0;
  constructor(private readonly src: string) {}

  parse(stop: (c: string) => boolean = () => false): SnippetNode[] {
    const nodes: SnippetNode[] = [];
    let text = "";
    const flush = () => { if (text) { nodes.push({ kind: "text", value: text }); text = ""; } };

    while (this.i < this.src.length) {
      const c = this.src[this.i];
      if (stop(c)) break;

      if (c === "\\") {
        const next = this.src[this.i + 1];
        if (next !== undefined) { text += next; this.i += 2; continue; }
      }
      if (c === "$") {
        const node = this.parseDollar();
        if (node) { flush(); nodes.push(node); continue; }
      }
      text += c;
      this.i += 1;
    }
    flush();
    return nodes;
  }

  private parseDollar(): SnippetNode | null {
    const start = this.i;
    this.i += 1; // consume '$'
    // `$1` — bare tabstop / variable.
    if (/[0-9]/.test(this.src[this.i] ?? "")) {
      const index = this.readInt();
      return { kind: "tabstop", index };
    }
    if (/[A-Za-z_]/.test(this.src[this.i] ?? "")) {
      const name = this.readName();
      return { kind: "variable", name, children: [] };
    }
    if (this.src[this.i] === "{") {
      const node = this.parseBrace();
      if (node) return node;
    }
    // Not a construct — treat '$' as literal.
    this.i = start + 1;
    return { kind: "text", value: "$" };
  }

  private parseBrace(): SnippetNode | null {
    const save = this.i;
    this.i += 1; // consume '{'

    if (/[0-9]/.test(this.src[this.i] ?? "")) {
      const index = this.readInt();
      const c = this.src[this.i];
      if (c === "}") { this.i += 1; return { kind: "tabstop", index }; }
      if (c === ":") {
        this.i += 1;
        const children = this.parse((ch) => ch === "}");
        this.expect("}");
        return { kind: "placeholder", index, children };
      }
      if (c === "|") {
        this.i += 1;
        const options = this.readChoices();
        this.expect("}");
        return { kind: "choice", index, options };
      }
      if (c === "/") {
        const transform = this.readTransform();
        this.expect("}");
        return { kind: "tabstop", index, transform };
      }
    }

    if (/[A-Za-z_]/.test(this.src[this.i] ?? "")) {
      const name = this.readName();
      const c = this.src[this.i];
      if (c === "}") { this.i += 1; return { kind: "variable", name, children: [] }; }
      if (c === ":") {
        this.i += 1;
        const children = this.parse((ch) => ch === "}");
        this.expect("}");
        return { kind: "variable", name, children };
      }
      if (c === "/") {
        const transform = this.readTransform();
        this.expect("}");
        return { kind: "variable", name, children: [], transform };
      }
    }

    this.i = save;
    return null;
  }

  private readTransform(): Transform {
    this.i += 1; // consume first '/'
    const pattern = this.readUntilUnescaped("/");
    this.i += 1; // consume separating '/'
    const format = this.readUntilUnescaped("/");
    this.i += 1; // consume closing '/'
    let flags = "";
    while (this.i < this.src.length && this.src[this.i] !== "}") flags += this.src[this.i++];
    // A malformed transform regex must not throw while parsing a snippet; fall
    // back to a pattern that never matches, so the transform is a no-op.
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, flags);
    } catch {
      regex = /(?!)/;
    }
    return { regex, format };
  }

  private readChoices(): string[] {
    const options: string[] = [];
    let cur = "";
    while (this.i < this.src.length) {
      const c = this.src[this.i];
      if (c === "\\") { cur += this.src[this.i + 1] ?? ""; this.i += 2; continue; }
      if (c === ",") { options.push(cur); cur = ""; this.i += 1; continue; }
      if (c === "|") { this.i += 1; break; }
      cur += c; this.i += 1;
    }
    options.push(cur);
    return options;
  }

  private readUntilUnescaped(delim: string): string {
    let out = "";
    while (this.i < this.src.length && this.src[this.i] !== delim) {
      if (this.src[this.i] === "\\") { out += this.src[this.i] + (this.src[this.i + 1] ?? ""); this.i += 2; continue; }
      out += this.src[this.i++];
    }
    return out;
  }

  private readInt(): number {
    let n = "";
    while (/[0-9]/.test(this.src[this.i] ?? "")) n += this.src[this.i++];
    return Number(n);
  }

  private readName(): string {
    let n = "";
    while (/[A-Za-z0-9_]/.test(this.src[this.i] ?? "")) n += this.src[this.i++];
    return n;
  }

  private expect(c: string): void {
    if (this.src[this.i] === c) this.i += 1;
  }
}

/** Parse a snippet template into its node tree. */
export function parseSnippet(template: string): SnippetNode[] {
  return new SnippetParser(template).parse();
}

// --- Expansion -------------------------------------------------------------

export interface ExpandContext {
  /** Values for `$VARIABLE` references (e.g. TM_FILENAME, TM_SELECTED_TEXT). */
  variables?: Record<string, string>;
}

/** Expand a snippet template into concrete text plus tabstop ranges. */
export function expandSnippet(template: string, ctx: ExpandContext = {}): Expansion {
  const nodes = parseSnippet(template);
  const vars = ctx.variables ?? {};
  let out = "";
  const stops = new Map<number, TabStop>();

  const record = (index: number, from: number, to: number, options?: string[]) => {
    const existing = stops.get(index);
    if (existing) existing.ranges.push({ from, to });
    else stops.set(index, { index, ranges: [{ from, to }], ...(options ? { options } : {}) });
  };

  const walk = (list: SnippetNode[]): void => {
    for (const node of list) {
      switch (node.kind) {
        case "text":
          out += node.value;
          break;
        case "tabstop": {
          const start = out.length;
          record(node.index, start, start); // empty; transforms on tabstops need prior input
          break;
        }
        case "placeholder": {
          const start = out.length;
          walk(node.children);
          record(node.index, start, out.length);
          break;
        }
        case "choice": {
          const start = out.length;
          out += node.options[0] ?? "";
          record(node.index, start, out.length, node.options);
          break;
        }
        case "variable": {
          const raw = vars[node.name];
          if (raw !== undefined && raw !== "") {
            out += node.transform ? applyTransform(raw, node.transform) : raw;
          } else {
            // Unknown or empty variable falls back to its default content (which
            // may itself contain tabstops); an empty default yields nothing.
            walk(node.children);
          }
          break;
        }
      }
    }
  };

  walk(nodes);

  const ordered = [...stops.values()].sort((a, b) => rank(a.index) - rank(b.index));
  return { text: out, tabStops: ordered };
}

/** $0 (final cursor) sorts after all positive tabstops. */
function rank(index: number): number {
  return index === 0 ? Number.MAX_SAFE_INTEGER : index;
}

/** Apply an LSP-style transform: replace regex matches using a format string. */
export function applyTransform(input: string, transform: Transform): string {
  return input.replace(transform.regex, (...args) => {
    // args: match, p1, p2, ..., offset, string [, groups]
    const groups = args.slice(1, -2).map((g) => (g === undefined ? "" : String(g)));
    return formatReplacement(transform.format, [args[0] as string, ...groups]);
  });
}

/** Expand `$1`, `${1:/upcase}`, `${1:/downcase}`, `${1:/capitalize}` in a format. */
function formatReplacement(format: string, groups: string[]): string {
  let out = "";
  let i = 0;
  while (i < format.length) {
    const c = format[i];
    if (c === "\\") { out += format[i + 1] ?? ""; i += 2; continue; }
    if (c === "$") {
      const simple = /^\$([0-9]+)/.exec(format.slice(i));
      if (simple) { out += groups[Number(simple[1])] ?? ""; i += simple[0].length; continue; }
      const complex = /^\$\{([0-9]+):\/(upcase|downcase|capitalize)\}/.exec(format.slice(i));
      if (complex) {
        out += modify(groups[Number(complex[1])] ?? "", complex[2]);
        i += complex[0].length;
        continue;
      }
    }
    out += c;
    i += 1;
  }
  return out;
}

function modify(value: string, op: string): string {
  switch (op) {
    case "upcase": return value.toUpperCase();
    case "downcase": return value.toLowerCase();
    case "capitalize": return value ? value[0].toUpperCase() + value.slice(1) : value;
    default: return value;
  }
}
