const PAIRS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
const OPENERS = new Set(["(", "[", "{"]);

export interface BalanceOptions {
  /** Ignore brackets inside single/double/back quotes. Defaults to true. */
  ignoreQuotes?: boolean;
}

/**
 * Check whether all (), [], and {} brackets in a string are balanced and
 * correctly nested. By default, brackets inside quotes are ignored.
 */
export function isBalanced(input: string, options: BalanceOptions = {}): boolean {
  const { ignoreQuotes = true } = options;
  const stack: string[] = [];
  let quote: string | null = null;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (ignoreQuotes) {
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
        continue;
      }
    }

    if (OPENERS.has(ch)) {
      stack.push(ch);
    } else if (ch in PAIRS) {
      if (stack.pop() !== PAIRS[ch]) return false;
    }
  }
  return stack.length === 0 && quote === null;
}
