export interface CommandSegment {
  command: string;
  /** The operator that FOLLOWS this segment, or null for the last one. */
  operator: "&&" | "||" | ";" | "|" | "&" | null;
}

/**
 * Split a shell command line into segments at top-level operators (&&, ||, ;,
 * |, &), ignoring operators that appear inside single or double quotes.
 */
export function splitCommandChain(line: string): CommandSegment[] {
  const segments: CommandSegment[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let i = 0;

  const push = (operator: CommandSegment["operator"]) => {
    const command = current.trim();
    if (command || operator) segments.push({ command, operator });
    current = "";
  };

  while (i < line.length) {
    const ch = line[i];
    const next = line[i + 1];

    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      i += 1;
    } else if ((ch === "&" && next === "&") || (ch === "|" && next === "|")) {
      push(ch === "&" ? "&&" : "||");
      i += 2;
    } else if (ch === ";" || ch === "|" || ch === "&") {
      push(ch as CommandSegment["operator"]);
      i += 1;
    } else {
      current += ch;
      i += 1;
    }
  }
  if (current.trim()) push(null);
  return segments;
}
