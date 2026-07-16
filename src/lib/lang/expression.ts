// A self-contained expression language: tokenizer, Pratt (top-down operator
// precedence) parser, and tree-walking evaluator. It powers inline calculation
// and any place the app needs to safely evaluate a user-typed formula without
// `eval`. Supports arithmetic, comparison, boolean logic, a ternary, unary
// minus/not, right-associative exponentiation, grouping, variables, and calls.

export type Expr =
  | { kind: "num"; value: number }
  | { kind: "bool"; value: boolean }
  | { kind: "var"; name: string }
  | { kind: "unary"; op: string; operand: Expr }
  | { kind: "binary"; op: string; left: Expr; right: Expr }
  | { kind: "ternary"; cond: Expr; then: Expr; else: Expr }
  | { kind: "call"; name: string; args: Expr[] };

export interface EvalScope {
  variables?: Record<string, number | boolean>;
  functions?: Record<string, (...args: number[]) => number>;
}

export class ExpressionError extends Error {}

// --- Tokenizer -------------------------------------------------------------

type Tok =
  | { t: "num"; v: number; pos: number }
  | { t: "id"; v: string; pos: number }
  | { t: "op"; v: string; pos: number }
  | { t: "eof"; pos: number };

const OPERATORS = ["**", "==", "!=", "<=", ">=", "&&", "||", "+", "-", "*", "/", "%", "<", ">", "!", "(", ")", ",", "?", ":"];

function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
    if (/[0-9.]/.test(c)) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i))!;
      toks.push({ t: "num", v: Number(m[0]), pos: i });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_]\w*/.exec(src.slice(i))!;
      toks.push({ t: "id", v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (op) {
      toks.push({ t: "op", v: op, pos: i });
      i += op.length;
      continue;
    }
    throw new ExpressionError(`Unexpected character '${c}' at position ${i}`);
  }
  toks.push({ t: "eof", pos: src.length });
  return toks;
}

// --- Pratt parser ----------------------------------------------------------

// Binding powers (higher binds tighter). Ternary is lowest.
const INFIX_BP: Record<string, number> = {
  "||": 3, "&&": 4,
  "==": 5, "!=": 5, "<": 6, ">": 6, "<=": 6, ">=": 6,
  "+": 7, "-": 7, "*": 8, "/": 8, "%": 8,
  "**": 10,
};
const RIGHT_ASSOC = new Set(["**"]);

class Parser {
  private p = 0;
  constructor(private readonly toks: Tok[]) {}

  private peek(): Tok { return this.toks[this.p]; }
  private next(): Tok { return this.toks[this.p++]; }

  private expectOp(op: string): void {
    const t = this.next();
    if (t.t !== "op" || t.v !== op) throw new ExpressionError(`Expected '${op}' at position ${t.pos}`);
  }

  parse(): Expr {
    const expr = this.expression(0);
    if (this.peek().t !== "eof") throw new ExpressionError(`Unexpected trailing input at position ${this.peek().pos}`);
    return expr;
  }

  private expression(minBp: number): Expr {
    let left = this.nud();

    for (;;) {
      const t = this.peek();
      if (t.t !== "op") break;

      // Ternary has the lowest precedence and is handled specially.
      if (t.v === "?" && minBp <= 2) {
        this.next();
        const then = this.expression(0);
        this.expectOp(":");
        const els = this.expression(2);
        left = { kind: "ternary", cond: left, then, else: els };
        continue;
      }

      const bp = INFIX_BP[t.v];
      if (bp === undefined || bp < minBp) break;
      this.next();
      const nextMin = RIGHT_ASSOC.has(t.v) ? bp : bp + 1;
      const right = this.expression(nextMin);
      left = { kind: "binary", op: t.v, left, right };
    }
    return left;
  }

  private nud(): Expr {
    const t = this.next();
    if (t.t === "num") return { kind: "num", value: t.v };
    if (t.t === "id") {
      if (t.v === "true") return { kind: "bool", value: true };
      if (t.v === "false") return { kind: "bool", value: false };
      if (this.peek().t === "op" && (this.peek() as { v: string }).v === "(") {
        return this.finishCall(t.v);
      }
      return { kind: "var", name: t.v };
    }
    if (t.t === "op") {
      if (t.v === "(") {
        const inner = this.expression(0);
        this.expectOp(")");
        return inner;
      }
      if (t.v === "-" || t.v === "!") {
        return { kind: "unary", op: t.v, operand: this.expression(9) };
      }
    }
    throw new ExpressionError(`Unexpected token at position ${t.pos}`);
  }

  private finishCall(name: string): Expr {
    this.expectOp("(");
    const args: Expr[] = [];
    if (!(this.peek().t === "op" && (this.peek() as { v: string }).v === ")")) {
      for (;;) {
        args.push(this.expression(0));
        const t = this.peek();
        if (t.t === "op" && t.v === ",") { this.next(); continue; }
        break;
      }
    }
    this.expectOp(")");
    return { kind: "call", name, args };
  }
}

/** Parse an expression string into an AST. */
export function parseExpression(src: string): Expr {
  return new Parser(lex(src)).parse();
}

// --- Evaluator -------------------------------------------------------------

const BUILTINS: Record<string, (...a: number[]) => number> = {
  abs: Math.abs, min: Math.min, max: Math.max, sqrt: Math.sqrt, floor: Math.floor,
  ceil: Math.ceil, round: Math.round, pow: Math.pow, log: Math.log, sign: Math.sign,
};

function toNum(v: number | boolean): number {
  return typeof v === "boolean" ? (v ? 1 : 0) : v;
}

/** Evaluate an AST against a scope, returning a number or boolean. */
export function evaluate(expr: Expr, scope: EvalScope = {}): number | boolean {
  const vars = scope.variables ?? {};
  const fns = { ...BUILTINS, ...(scope.functions ?? {}) };

  switch (expr.kind) {
    case "num": return expr.value;
    case "bool": return expr.value;
    case "var":
      if (!(expr.name in vars)) throw new ExpressionError(`Undefined variable '${expr.name}'`);
      return vars[expr.name];
    case "unary": {
      const v = evaluate(expr.operand, scope);
      return expr.op === "-" ? -toNum(v) : !(typeof v === "boolean" ? v : v !== 0);
    }
    case "ternary":
      return evaluate(expr.cond, scope) ? evaluate(expr.then, scope) : evaluate(expr.else, scope);
    case "call": {
      const fn = fns[expr.name];
      if (!fn) throw new ExpressionError(`Unknown function '${expr.name}'`);
      return fn(...expr.args.map((a) => toNum(evaluate(a, scope))));
    }
    case "binary": {
      const l = evaluate(expr.left, scope);
      if (expr.op === "&&") return Boolean(l) && Boolean(evaluate(expr.right, scope));
      if (expr.op === "||") return Boolean(l) || Boolean(evaluate(expr.right, scope));
      const r = evaluate(expr.right, scope);
      const a = toNum(l);
      const b = toNum(r);
      switch (expr.op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": return a / b;
        case "%": return a % b;
        case "**": return a ** b;
        case "==": return a === b;
        case "!=": return a !== b;
        case "<": return a < b;
        case ">": return a > b;
        case "<=": return a <= b;
        case ">=": return a >= b;
      }
    }
  }
  throw new ExpressionError("Unevaluable expression");
}

/** Parse and evaluate an expression string in one step. */
export function evaluateExpression(src: string, scope?: EvalScope): number | boolean {
  return evaluate(parseExpression(src), scope);
}
