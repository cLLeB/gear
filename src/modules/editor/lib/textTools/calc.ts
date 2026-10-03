// Inline calculator over the in-process expression engine (no eval): accepts
// the things people actually select — "1,234.5 * 3", "2^10", "15% of 80",
// "(a)=1+2" lines ending in "=" — and formats results without float noise.

import { evaluateExpression } from "@/lib/lang/expression";

const CONSTANTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

/** Normalise calculator-style input into the engine's syntax. */
export function normalizeExpression(src: string): string {
  let s = src.trim().replace(/=\s*$/, ""); // "2 + 2 =" → "2 + 2"
  s = s.replace(/(\d),(?=\d{3}\b)/g, "$1"); // thousands separators
  s = s.replace(/[×x](?=\s*[\d(.])/g, "*").replace(/÷/g, "/").replace(/−/g, "-");
  s = s.replace(/\^/g, "**");
  // "15% of 80" → (15/100)*80 ; "80 + 15%" → 80*(1+15/100)
  s = s.replace(/(\d+(?:\.\d+)?)\s*%\s*of\s+/gi, "($1/100)*");
  s = s.replace(/([\d.)]+)\s*([+-])\s*(\d+(?:\.\d+)?)%/g, "$1*(1$2$3/100)");
  s = s.replace(/(\d+(?:\.\d+)?)%/g, "($1/100)");
  return s;
}

/** Format a number for humans: no binary float noise, no exponent for normal sizes. */
export function formatResult(v: number | boolean): string {
  if (typeof v === "boolean") return String(v);
  if (!Number.isFinite(v)) return String(v);
  if (Number.isInteger(v) && Math.abs(v) < 1e21) return String(v);
  const rounded = Number.parseFloat(v.toPrecision(12));
  return Math.abs(rounded) >= 1e-6 && Math.abs(rounded) < 1e15 ? String(rounded) : rounded.toExponential();
}

const FUNCTIONS = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  ln: Math.log,
  log10: Math.log10,
  log2: Math.log2,
  exp: Math.exp,
  cbrt: Math.cbrt,
  trunc: Math.trunc,
  hypot: Math.hypot,
};

export function calculate(src: string): string {
  const value = evaluateExpression(normalizeExpression(src), { variables: CONSTANTS, functions: FUNCTIONS });
  return formatResult(value);
}

/** Sum of numbers found in a list of selections ("status bar sum"). */
export function sumNumbers(texts: readonly string[]): { sum: number; count: number } {
  let sum = 0;
  let count = 0;
  for (const t of texts) {
    for (const m of t.replace(/(\d),(?=\d{3}\b)/g, "$1").matchAll(/-?\d+(?:\.\d+)?/g)) {
      sum += Number(m[0]);
      count++;
    }
  }
  return { sum, count };
}
