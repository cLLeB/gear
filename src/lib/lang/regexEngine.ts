// A small regular-expression engine implemented from first principles: a
// recursive-descent parser builds an AST, Thompson's construction compiles it
// into a non-deterministic finite automaton, and matching runs the classic
// subset (epsilon-closure) simulation. Because it never backtracks it has no
// catastrophic-backtracking blow-up — useful for validating user-supplied
// patterns and for teaching/visualising how regex matching works.
//
// Supported syntax: literals, concatenation, alternation `|`, quantifiers
// `* + ?`, grouping `( )`, wildcard `.`, character classes `[...]` (with ranges
// and negation), and escapes `\d \w \s \n \t \\` (and their negations).

type Matcher = (ch: string) => boolean;

type Node =
  | { kind: "char"; match: Matcher }
  | { kind: "concat"; parts: Node[] }
  | { kind: "alt"; options: Node[] }
  | { kind: "star"; node: Node }
  | { kind: "plus"; node: Node }
  | { kind: "opt"; node: Node }
  | { kind: "empty" };

// --- Parser ----------------------------------------------------------------

class RegexParser {
  private p = 0;
  constructor(private readonly src: string) {}

  private peek(): string { return this.src[this.p]; }
  private eof(): boolean { return this.p >= this.src.length; }

  parse(): Node {
    const node = this.alternation();
    if (!this.eof()) throw new SyntaxError(`Unexpected '${this.peek()}' at ${this.p}`);
    return node;
  }

  private alternation(): Node {
    const options = [this.concatenation()];
    while (this.peek() === "|") {
      this.p++;
      options.push(this.concatenation());
    }
    return options.length === 1 ? options[0] : { kind: "alt", options };
  }

  private concatenation(): Node {
    const parts: Node[] = [];
    while (!this.eof() && this.peek() !== "|" && this.peek() !== ")") {
      parts.push(this.quantified());
    }
    if (parts.length === 0) return { kind: "empty" };
    return parts.length === 1 ? parts[0] : { kind: "concat", parts };
  }

  private quantified(): Node {
    let node = this.atom();
    while (!this.eof() && "*+?".includes(this.peek())) {
      const q = this.src[this.p++];
      if (q === "*") node = { kind: "star", node };
      else if (q === "+") node = { kind: "plus", node };
      else node = { kind: "opt", node };
    }
    return node;
  }

  private atom(): Node {
    const c = this.src[this.p++];
    if (c === "(") {
      const inner = this.alternation();
      if (this.src[this.p++] !== ")") throw new SyntaxError("Unbalanced '('");
      return inner;
    }
    if (c === "[") return this.charClass();
    if (c === ".") return { kind: "char", match: (ch) => ch !== "\n" };
    if (c === "\\") return { kind: "char", match: escapeMatcher(this.src[this.p++]) };
    if (c === undefined) throw new SyntaxError("Unexpected end of pattern");
    if ("*+?".includes(c)) throw new SyntaxError(`Dangling quantifier '${c}'`);
    return { kind: "char", match: (ch) => ch === c };
  }

  private charClass(): Node {
    let negate = false;
    if (this.peek() === "^") { negate = true; this.p++; }
    const tests: Matcher[] = [];
    while (!this.eof() && this.peek() !== "]") {
      let lo = this.src[this.p++];
      if (lo === "\\") {
        tests.push(escapeMatcher(this.src[this.p++]));
        continue;
      }
      if (this.peek() === "-" && this.src[this.p + 1] !== "]" && !this.eof()) {
        this.p++; // consume '-'
        const hi = this.src[this.p++];
        tests.push((ch) => ch >= lo && ch <= hi);
      } else {
        tests.push((ch) => ch === lo);
      }
    }
    if (this.src[this.p++] !== "]") throw new SyntaxError("Unterminated character class");
    const match: Matcher = (ch) => {
      const hit = tests.some((t) => t(ch));
      return negate ? !hit : hit;
    };
    return { kind: "char", match };
  }
}

function escapeMatcher(c: string): Matcher {
  switch (c) {
    case "d": return (ch) => ch >= "0" && ch <= "9";
    case "D": return (ch) => !(ch >= "0" && ch <= "9");
    case "w": return (ch) => /[A-Za-z0-9_]/.test(ch);
    case "W": return (ch) => !/[A-Za-z0-9_]/.test(ch);
    case "s": return (ch) => /\s/.test(ch);
    case "S": return (ch) => !/\s/.test(ch);
    case "n": return (ch) => ch === "\n";
    case "t": return (ch) => ch === "\t";
    default: return (ch) => ch === c;
  }
}

// --- NFA (Thompson construction) -------------------------------------------

interface Transition { match: Matcher | null; to: number } // null == epsilon

class NFA {
  readonly transitions: Transition[][] = [];
  start = 0;
  accept = 0;

  private newState(): number {
    this.transitions.push([]);
    return this.transitions.length - 1;
  }

  private link(from: number, match: Matcher | null): Transition {
    const t: Transition = { match, to: -1 };
    this.transitions[from].push(t);
    return t;
  }

  static compile(node: Node): NFA {
    const nfa = new NFA();
    const frag = nfa.build(node);
    const accept = nfa.newState();
    for (const out of frag.outs) out.to = accept;
    nfa.start = frag.start;
    nfa.accept = accept;
    return nfa;
  }

  private build(node: Node): { start: number; outs: Transition[] } {
    switch (node.kind) {
      case "empty": {
        const s = this.newState();
        return { start: s, outs: [this.link(s, null)] };
      }
      case "char": {
        const s = this.newState();
        return { start: s, outs: [this.link(s, node.match)] };
      }
      case "concat": {
        let frag = this.build(node.parts[0]);
        const start = frag.start;
        for (let i = 1; i < node.parts.length; i++) {
          const next = this.build(node.parts[i]);
          for (const out of frag.outs) out.to = next.start;
          frag = next;
        }
        return { start, outs: frag.outs };
      }
      case "alt": {
        const s = this.newState();
        const outs: Transition[] = [];
        for (const option of node.options) {
          const f = this.build(option);
          this.link(s, null).to = f.start;
          outs.push(...f.outs);
        }
        return { start: s, outs };
      }
      case "star": {
        const s = this.newState();
        const f = this.build(node.node);
        this.link(s, null).to = f.start;
        for (const out of f.outs) out.to = s;
        return { start: s, outs: [this.link(s, null)] };
      }
      case "plus": {
        const f = this.build(node.node);
        const s = this.newState();
        for (const out of f.outs) out.to = s;
        this.link(s, null).to = f.start;
        return { start: f.start, outs: [this.link(s, null)] };
      }
      case "opt": {
        const s = this.newState();
        const f = this.build(node.node);
        this.link(s, null).to = f.start;
        return { start: s, outs: [...f.outs, this.link(s, null)] };
      }
    }
  }

  private epsilonClosure(states: Iterable<number>): Set<number> {
    const closure = new Set<number>();
    const stack = [...states];
    while (stack.length) {
      const s = stack.pop()!;
      if (closure.has(s)) continue;
      closure.add(s);
      for (const t of this.transitions[s]) {
        if (t.match === null && t.to >= 0 && !closure.has(t.to)) stack.push(t.to);
      }
    }
    return closure;
  }

  /** Full-string match. */
  test(input: string): boolean {
    let current = this.epsilonClosure([this.start]);
    for (const ch of input) {
      const next = new Set<number>();
      for (const s of current) {
        for (const t of this.transitions[s]) {
          if (t.match && t.to >= 0 && t.match(ch)) next.add(t.to);
        }
      }
      current = this.epsilonClosure(next);
      if (current.size === 0) return false;
    }
    return current.has(this.accept);
  }
}

export interface CompiledRegex {
  test(input: string): boolean;
}

/** Compile a pattern into a matcher. Throws SyntaxError on invalid syntax. */
export function compileRegex(pattern: string): CompiledRegex {
  const ast = new RegexParser(pattern).parse();
  const nfa = NFA.compile(ast);
  return { test: (input) => nfa.test(input) };
}

/** Convenience: does `pattern` fully match `input`? */
export function regexMatch(pattern: string, input: string): boolean {
  return compileRegex(pattern).test(input);
}
