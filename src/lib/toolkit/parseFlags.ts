import { parseArgv } from "./parseArgv";

export interface ParsedFlags {
  positionals: string[];
  flags: Record<string, string | boolean | (string | boolean)[]>;
}

/**
 * Parse a command line into positionals and flags. Supports --key=value,
 * --key value, --bool, -abc bundled short flags, and "--" to end flag parsing.
 * Repeated flags collapse into arrays.
 */
export function parseFlags(input: string | string[]): ParsedFlags {
  const tokens = Array.isArray(input) ? input : parseArgv(input);
  const positionals: string[] = [];
  const flags: ParsedFlags["flags"] = {};
  let noMoreFlags = false;

  const add = (key: string, value: string | boolean) => {
    const existing = flags[key];
    if (existing === undefined) flags[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else flags[key] = [existing, value];
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (noMoreFlags || token === "-" || !token.startsWith("-")) {
      positionals.push(token);
      continue;
    }
    if (token === "--") {
      noMoreFlags = true;
      continue;
    }
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      if (eq !== -1) {
        add(token.slice(2, eq), token.slice(eq + 1));
      } else {
        const key = token.slice(2);
        const next = tokens[i + 1];
        if (next !== undefined && !next.startsWith("-")) add(key, tokens[++i]);
        else add(key, true);
      }
    } else {
      for (const ch of token.slice(1)) add(ch, true);
    }
  }
  return { positionals, flags };
}
