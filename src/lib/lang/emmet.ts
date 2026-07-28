// An Emmet-style abbreviation expander. It turns terse markup abbreviations into
// formatted HTML — `ul>li.item$*3` becomes a three-item list — by parsing the
// abbreviation grammar (child `>`, sibling `+`, repeat `*N`, grouping `(…)`,
// `#id`, `.class`, `[attr=value]`, `{text}`, and `$` item numbering) into a tree
// and rendering it with indentation. This is one of the highest-leverage editor
// features for anyone writing markup, and it is entirely offline and
// deterministic.

interface ElementNode {
  kind: "element";
  tag: string;
  id: string;
  classes: string[];
  attrs: Array<[string, string]>;
  text: string;
  multiplier: number;
  children: Node[];
}

interface GroupNode {
  kind: "group";
  items: Node[];
  multiplier: number;
  children: Node[];
}

type Node = ElementNode | GroupNode;

export class EmmetError extends Error {}

// Guards against a tiny abbreviation requesting a huge expansion, e.g.
// `div*999999999` or nested `(x*10000)*10000`.
const MAX_MULTIPLIER = 10000;
const MAX_TOTAL_ELEMENTS = 100000;

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

// --- Parser ----------------------------------------------------------------

class EmmetParser {
  private i = 0;
  constructor(private readonly src: string) {}

  /** A `+`-separated list of items, each of which may descend with `>`. */
  parseSiblings(): Node[] {
    const nodes: Node[] = [this.parseItem()];
    while (this.peek() === "+") {
      this.i += 1;
      nodes.push(this.parseItem());
    }
    return nodes;
  }

  private parseItem(): Node {
    const node = this.parseMultiplied();
    if (this.peek() === ">") {
      this.i += 1;
      node.children = this.parseSiblings();
    }
    return node;
  }

  private parseMultiplied(): Node {
    let node: Node;
    if (this.peek() === "(") {
      this.i += 1;
      const items = this.parseSiblings();
      if (this.peek() === ")") this.i += 1;
      node = { kind: "group", items, multiplier: 1, children: [] };
    } else {
      node = this.parseElement();
    }
    if (this.peek() === "*") {
      this.i += 1;
      node.multiplier = Math.min(this.readInt(), MAX_MULTIPLIER);
    }
    return node;
  }

  private parseElement(): ElementNode {
    const tag = this.readName();
    const node: ElementNode = {
      kind: "element",
      tag,
      id: "",
      classes: [],
      attrs: [],
      text: "",
      multiplier: 1,
      children: [],
    };
    for (;;) {
      const c = this.peek();
      if (c === "#") { this.i += 1; node.id = this.readName(); continue; }
      if (c === ".") { this.i += 1; node.classes.push(this.readName()); continue; }
      if (c === "[") { node.attrs.push(...this.readAttrs()); continue; }
      if (c === "{") { node.text = this.readText(); continue; }
      break;
    }
    if (node.tag === "") node.tag = "div"; // `.foo` / `#bar` imply a div
    return node;
  }

  private readAttrs(): Array<[string, string]> {
    this.i += 1; // consume '['
    const attrs: Array<[string, string]> = [];
    while (this.i < this.src.length && this.src[this.i] !== "]") {
      while (this.src[this.i] === " ") this.i += 1;
      if (this.src[this.i] === "]") break;
      let name = "";
      while (this.i < this.src.length && /[A-Za-z0-9_:-]/.test(this.src[this.i])) name += this.src[this.i++];
      let value = "";
      if (this.src[this.i] === "=") {
        this.i += 1;
        if (this.src[this.i] === '"' || this.src[this.i] === "'") {
          const q = this.src[this.i++];
          while (this.i < this.src.length && this.src[this.i] !== q) value += this.src[this.i++];
          this.i += 1; // closing quote
        } else {
          while (this.i < this.src.length && !/[\s\]]/.test(this.src[this.i])) value += this.src[this.i++];
        }
      }
      if (name) attrs.push([name, value]);
    }
    this.i += 1; // consume ']'
    return attrs;
  }

  private readText(): string {
    this.i += 1; // consume '{'
    let text = "";
    while (this.i < this.src.length && this.src[this.i] !== "}") {
      if (this.src[this.i] === "\\") { text += this.src[this.i + 1] ?? ""; this.i += 2; continue; }
      text += this.src[this.i++];
    }
    this.i += 1; // consume '}'
    return text;
  }

  private readName(): string {
    let name = "";
    while (this.i < this.src.length && /[A-Za-z0-9$_:-]/.test(this.src[this.i])) name += this.src[this.i++];
    return name;
  }

  private readInt(): number {
    let n = "";
    while (/[0-9]/.test(this.src[this.i] ?? "")) n += this.src[this.i++];
    return n === "" ? 1 : Number(n);
  }

  private peek(): string {
    return this.src[this.i] ?? "";
  }
}

// --- Renderer --------------------------------------------------------------

/** Replace `$`, `$$`, … in a string with the zero-padded 1-based item index. */
function numbering(text: string, index: number): string {
  return text.replace(/\$+/g, (run) => String(index).padStart(run.length, "0"));
}

function indentOf(level: number): string {
  return "  ".repeat(level);
}

interface Budget {
  remaining: number;
}

function renderForest(nodes: Node[], level: number, index: number, budget: Budget): string[] {
  const lines: string[] = [];
  for (const node of nodes) lines.push(...renderNode(node, level, index, budget));
  return lines;
}

function renderNode(node: Node, level: number, inheritedIndex: number, budget: Budget): string[] {
  const lines: string[] = [];
  const count = Math.max(1, node.multiplier);
  for (let i = 1; i <= count; i++) {
    const index = count > 1 ? i : inheritedIndex;
    if (node.kind === "group") {
      lines.push(...renderForest(node.items, level, index, budget));
      lines.push(...renderForest(node.children, level, index, budget));
    } else {
      if (--budget.remaining < 0) throw new EmmetError("Emmet expansion is too large");
      lines.push(...renderElement(node, level, index, budget));
    }
  }
  return lines;
}

function renderElement(node: ElementNode, level: number, index: number, budget: Budget): string[] {
  const pad = indentOf(level);
  const tag = numbering(node.tag, index);
  const attrParts: string[] = [];
  if (node.id) attrParts.push(`id="${numbering(node.id, index)}"`);
  if (node.classes.length) attrParts.push(`class="${node.classes.map((c) => numbering(c, index)).join(" ")}"`);
  for (const [k, v] of node.attrs) attrParts.push(v === "" ? k : `${k}="${numbering(v, index)}"`);
  const open = `<${tag}${attrParts.length ? " " + attrParts.join(" ") : ""}`;

  if (VOID_ELEMENTS.has(tag)) return [`${pad}${open} />`];

  const text = numbering(node.text, index);
  if (node.children.length === 0) {
    return [`${pad}${open}>${text}</${tag}>`];
  }

  const inner = renderForest(node.children, level + 1, index, budget);
  const lines: string[] = [`${pad}${open}>`];
  if (text) lines.push(`${indentOf(level + 1)}${text}`);
  lines.push(...inner);
  lines.push(`${pad}</${tag}>`);
  return lines;
}

/** Expand an Emmet abbreviation into formatted HTML. */
export function expandEmmet(abbreviation: string): string {
  const trimmed = abbreviation.trim();
  if (trimmed === "") return "";
  const forest = new EmmetParser(trimmed).parseSiblings();
  return renderForest(forest, 0, 1, { remaining: MAX_TOTAL_ELEMENTS }).join("\n");
}
