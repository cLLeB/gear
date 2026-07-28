// A bytecode compiler and stack virtual machine for the expression language in
// expression.ts. Where `evaluate` walks the AST directly, this compiles the AST
// once into a flat instruction sequence that a small stack machine executes —
// the standard "compile then run" split that lets an expression be evaluated
// repeatedly (e.g. a spreadsheet cell, a filter predicate) without re-walking the
// tree, and demonstrates short-circuit control flow via jump backpatching. The VM
// is verified to produce identical results to the tree-walking evaluator.

import { type EvalScope, type Expr, ExpressionError, parseExpression } from "./expression";

type Instr =
  | { op: "push"; value: number | boolean }
  | { op: "load"; name: string }
  | { op: "toBool" }
  | { op: "pop" }
  | { op: "unary"; operator: string }
  | { op: "binary"; operator: string }
  | { op: "call"; name: string; argc: number }
  | { op: "jumpIfFalseKeep"; target: number }
  | { op: "jumpIfTrueKeep"; target: number }
  | { op: "jumpIfFalse"; target: number }
  | { op: "jump"; target: number };

const BUILTINS: Record<string, (...a: number[]) => number> = {
  abs: Math.abs, min: Math.min, max: Math.max, sqrt: Math.sqrt, floor: Math.floor,
  ceil: Math.ceil, round: Math.round, pow: Math.pow, log: Math.log, sign: Math.sign,
};

// --- Compiler --------------------------------------------------------------

class Compiler {
  private readonly code: Instr[] = [];

  compile(expr: Expr): Instr[] {
    this.emitExpr(expr);
    return this.code;
  }

  private emit(instr: Instr): number {
    this.code.push(instr);
    return this.code.length - 1;
  }

  private emitExpr(expr: Expr): void {
    switch (expr.kind) {
      case "num": this.emit({ op: "push", value: expr.value }); break;
      case "bool": this.emit({ op: "push", value: expr.value }); break;
      case "var": this.emit({ op: "load", name: expr.name }); break;
      case "unary":
        this.emitExpr(expr.operand);
        this.emit({ op: "unary", operator: expr.op });
        break;
      case "call":
        for (const arg of expr.args) this.emitExpr(arg);
        this.emit({ op: "call", name: expr.name, argc: expr.args.length });
        break;
      case "ternary": this.emitTernary(expr); break;
      case "binary": this.emitBinary(expr); break;
    }
  }

  private emitBinary(expr: Expr & { kind: "binary" }): void {
    if (expr.op === "&&" || expr.op === "||") { this.emitLogical(expr); return; }
    this.emitExpr(expr.left);
    this.emitExpr(expr.right);
    this.emit({ op: "binary", operator: expr.op });
  }

  private emitLogical(expr: Expr & { kind: "binary" }): void {
    // Short-circuit: `a && b` keeps a's (boolean) value if it decides the result.
    this.emitExpr(expr.left);
    this.emit({ op: "toBool" });
    const jump = this.emit(
      expr.op === "&&" ? { op: "jumpIfFalseKeep", target: -1 } : { op: "jumpIfTrueKeep", target: -1 },
    );
    this.emit({ op: "pop" });
    this.emitExpr(expr.right);
    this.emit({ op: "toBool" });
    this.patch(jump, this.code.length);
  }

  private emitTernary(expr: Expr & { kind: "ternary" }): void {
    this.emitExpr(expr.cond);
    const toElse = this.emit({ op: "jumpIfFalse", target: -1 });
    this.emitExpr(expr.then);
    const toEnd = this.emit({ op: "jump", target: -1 });
    this.patch(toElse, this.code.length);
    this.emitExpr(expr.else);
    this.patch(toEnd, this.code.length);
  }

  private patch(index: number, target: number): void {
    const instr = this.code[index];
    if ("target" in instr) instr.target = target;
  }
}

/** Compile an expression AST into bytecode. */
export function compile(expr: Expr): Instr[] {
  return new Compiler().compile(expr);
}

// --- Virtual machine -------------------------------------------------------

function toNum(v: number | boolean): number {
  return typeof v === "boolean" ? (v ? 1 : 0) : v;
}

function toBool(v: number | boolean): boolean {
  return typeof v === "boolean" ? v : v !== 0;
}

/** Execute a compiled program against a scope. */
export function execute(program: Instr[], scope: EvalScope = {}): number | boolean {
  const vars = scope.variables ?? {};
  const fns = { ...BUILTINS, ...(scope.functions ?? {}) };
  const stack: Array<number | boolean> = [];
  let pc = 0;

  while (pc < program.length) {
    const instr = program[pc];
    switch (instr.op) {
      case "push": stack.push(instr.value); pc++; break;
      case "load":
        if (!(instr.name in vars)) throw new ExpressionError(`Undefined variable '${instr.name}'`);
        stack.push(vars[instr.name]); pc++; break;
      case "toBool": stack.push(toBool(stack.pop()!)); pc++; break;
      case "pop": stack.pop(); pc++; break;
      case "unary": {
        const v = stack.pop()!;
        stack.push(instr.operator === "-" ? -toNum(v) : !toBool(v));
        pc++; break;
      }
      case "binary": {
        const b = stack.pop()!;
        const a = stack.pop()!;
        stack.push(applyBinary(instr.operator, a, b));
        pc++; break;
      }
      case "call": {
        const fn = fns[instr.name];
        if (!fn) throw new ExpressionError(`Unknown function '${instr.name}'`);
        const args: number[] = [];
        for (let i = 0; i < instr.argc; i++) args.unshift(toNum(stack.pop()!));
        stack.push(fn(...args));
        pc++; break;
      }
      case "jumpIfFalseKeep": pc = toBool(stack[stack.length - 1]) ? pc + 1 : instr.target; break;
      case "jumpIfTrueKeep": pc = toBool(stack[stack.length - 1]) ? instr.target : pc + 1; break;
      case "jumpIfFalse": pc = toBool(stack.pop()!) ? pc + 1 : instr.target; break;
      case "jump": pc = instr.target; break;
    }
  }

  if (stack.length !== 1) throw new ExpressionError("VM ended with an unbalanced stack");
  return stack[0];
}

function applyBinary(op: string, la: number | boolean, lb: number | boolean): number | boolean {
  const a = toNum(la);
  const b = toNum(lb);
  switch (op) {
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
    default: throw new ExpressionError(`Unknown operator '${op}'`);
  }
}

/** Parse, compile, and run an expression string on the stack VM. */
export function runExpression(src: string, scope?: EvalScope): number | boolean {
  return execute(compile(parseExpression(src)), scope);
}
