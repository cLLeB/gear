// Constant folding and algebraic simplification for the expression language in
// expression.ts. It walks the AST bottom-up, evaluating any fully-constant
// subtree to a literal and applying the standard identity rules (`x + 0 → x`,
// `x * 1 → x`, `x * 0 → 0`, `true || x → true`, double negation, constant
// ternaries, …). Identities that would *drop* an operand are only applied when
// that operand is free of function calls, so a potential side effect is never
// optimized away. This powers inline "simplify expression" refactorings and is a
// building block for a constant-propagation pass.

import { evaluate, parseExpression, type Expr } from "./expression";

function num(value: number): Expr {
  return { kind: "num", value };
}

function isNum(e: Expr, value?: number): e is { kind: "num"; value: number } {
  return e.kind === "num" && (value === undefined || e.value === value);
}

function isBool(e: Expr, value?: boolean): e is { kind: "bool"; value: boolean } {
  return e.kind === "bool" && (value === undefined || e.value === value);
}

/** True when the subtree contains no function call (i.e. is side-effect free). */
function isPure(e: Expr): boolean {
  switch (e.kind) {
    case "num": case "bool": case "var": return true;
    case "unary": return isPure(e.operand);
    case "binary": return isPure(e.left) && isPure(e.right);
    case "ternary": return isPure(e.cond) && isPure(e.then) && isPure(e.else);
    case "call": return false;
  }
}

/** Fold constants and simplify an expression AST, returning a new AST. */
export function foldConstants(expr: Expr): Expr {
  const folded = foldChildren(expr);

  // If the whole (post-fold) subtree is constant, evaluate it to a literal.
  const constant = tryEvaluate(folded);
  if (constant !== null) return constant;

  return applyIdentities(folded);
}

function foldChildren(expr: Expr): Expr {
  switch (expr.kind) {
    case "num": case "bool": case "var": return expr;
    case "unary": return { ...expr, operand: foldConstants(expr.operand) };
    case "binary": return { ...expr, left: foldConstants(expr.left), right: foldConstants(expr.right) };
    case "ternary": return {
      ...expr,
      cond: foldConstants(expr.cond),
      then: foldConstants(expr.then),
      else: foldConstants(expr.else),
    };
    case "call": return { ...expr, args: expr.args.map(foldConstants) };
  }
}

/** Evaluate a fully-constant subtree to a literal, or null if it is not constant. */
function tryEvaluate(expr: Expr): Expr | null {
  try {
    const value = evaluate(expr);
    if (typeof value === "boolean") return { kind: "bool", value };
    if (Number.isFinite(value)) return num(value);
    return null; // don't fold to Infinity/NaN — keep the source form
  } catch {
    return null;
  }
}

function applyIdentities(expr: Expr): Expr {
  if (expr.kind === "unary") {
    // Double negation / double not collapse.
    if (expr.op === "-" && expr.operand.kind === "unary" && expr.operand.op === "-") return expr.operand.operand;
    if (expr.op === "!" && expr.operand.kind === "unary" && expr.operand.op === "!") return expr.operand.operand;
    return expr;
  }

  if (expr.kind === "ternary") {
    if (isBool(expr.cond)) return expr.cond.value ? expr.then : expr.else;
    if (isNum(expr.cond)) return expr.cond.value !== 0 ? expr.then : expr.else;
    return expr;
  }

  if (expr.kind !== "binary") return expr;
  const { op, left, right } = expr;

  switch (op) {
    case "+":
      if (isNum(right, 0)) return left;
      if (isNum(left, 0)) return right;
      break;
    case "-":
      if (isNum(right, 0)) return left;
      break;
    case "*":
      if (isNum(right, 1)) return left;
      if (isNum(left, 1)) return right;
      if (isNum(right, 0) && isPure(left)) return num(0);
      if (isNum(left, 0) && isPure(right)) return num(0);
      break;
    case "/":
      if (isNum(right, 1)) return left;
      break;
    case "**":
      if (isNum(right, 1)) return left;
      if (isNum(right, 0) && isPure(left)) return num(1);
      break;
    case "&&":
      if (isBool(left, true)) return right;
      if (isBool(left, false) && isPure(right)) return { kind: "bool", value: false };
      if (isBool(right, true)) return left;
      break;
    case "||":
      if (isBool(left, true) && isPure(right)) return { kind: "bool", value: true };
      if (isBool(left, false)) return right;
      if (isBool(right, false)) return left;
      break;
  }
  return expr;
}

// --- Rendering -------------------------------------------------------------

const PREC: Record<string, number> = {
  "||": 3, "&&": 4, "==": 5, "!=": 5, "<": 6, ">": 6, "<=": 6, ">=": 6,
  "+": 7, "-": 7, "*": 8, "/": 8, "%": 8, "**": 10,
};
const UNARY_PREC = 9;
const TERNARY_PREC = 1;

function precedence(e: Expr): number {
  if (e.kind === "binary") return PREC[e.op] ?? 0;
  if (e.kind === "ternary") return TERNARY_PREC;
  if (e.kind === "unary") return UNARY_PREC;
  return 20; // atoms bind tightest
}

/** Render an expression AST back to source, adding parentheses only as needed. */
export function renderExpr(expr: Expr): string {
  switch (expr.kind) {
    case "num": return String(expr.value);
    case "bool": return String(expr.value);
    case "var": return expr.name;
    case "call": return `${expr.name}(${expr.args.map(renderExpr).join(", ")})`;
    case "unary": return `${expr.op}${wrap(expr.operand, UNARY_PREC)}`;
    case "ternary":
      return `${wrap(expr.cond, TERNARY_PREC + 1)} ? ${renderExpr(expr.then)} : ${renderExpr(expr.else)}`;
    case "binary":
      return `${wrap(expr.left, precedence(expr))} ${expr.op} ${wrap(expr.right, precedence(expr) + 1)}`;
  }
}

function wrap(child: Expr, parentPrec: number): string {
  const rendered = renderExpr(child);
  return precedence(child) < parentPrec ? `(${rendered})` : rendered;
}

/** Parse, simplify, and re-render an expression string. */
export function simplifyExpression(src: string): string {
  return renderExpr(foldConstants(parseExpression(src)));
}
