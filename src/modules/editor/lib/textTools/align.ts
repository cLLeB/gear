// Align a block of lines on their first shared operator — `=`, `:`, `=>`,
// `->`, `|` or a trailing `//` comment — like VS Code's Better Align. The
// operator is chosen automatically (the one most lines have, in priority
// order) unless given; strings are skipped when looking for it.

const CANDIDATES = ["=>", "->", ":=", "+=", "-=", "=", ":", "//", "#", "|"] as const;

/** Index of `op` in `line` outside quotes, as a standalone operator. */
export function findOperator(line: string, op: string): number {
  let q: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === "\\") i++;
      else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      q = c;
      continue;
    }
    if (!line.startsWith(op, i)) continue;
    // Don't treat ==, ===, <=, >=, !=, => as "=" or :: as ":".
    if (op === "=" && (/[=!<>+\-*/%&|^:]/.test(line[i - 1] ?? "") || /[=>]/.test(line[i + 1] ?? ""))) continue;
    if (op === ":" && (line[i - 1] === ":" || line[i + 1] === ":" || /^\/\//.test(line.slice(i + 1)))) continue;
    if (op === "#" && i > 0 && !/\s/.test(line[i - 1])) continue;
    return i;
  }
  return -1;
}

export function pickOperator(lines: readonly string[]): string | null {
  let best: string | null = null;
  let bestCount = 1;
  for (const op of CANDIDATES) {
    const count = lines.filter((l) => findOperator(l, op) > 0).length;
    if (count > bestCount) {
      best = op;
      bestCount = count;
    }
  }
  return best;
}

export function alignLines(lines: readonly string[], op = pickOperator(lines)): string[] {
  if (!op) return [...lines];
  const parts = lines.map((l) => {
    const i = findOperator(l, op);
    return i <= 0 ? null : { left: l.slice(0, i).replace(/\s+$/, ""), right: l.slice(i + op.length).replace(/^\s+/, "") };
  });
  const width = Math.max(...parts.map((p) => (p ? p.left.length : 0)));
  // ":" hugs the key (key:   value); everything else is padded before.
  return lines.map((l, k) => {
    const p = parts[k];
    if (!p) return l;
    if (op === ":") return `${p.left}:${" ".repeat(width - p.left.length + 1)}${p.right}`.replace(/\s+$/, "");
    return `${p.left}${" ".repeat(width - p.left.length)} ${op} ${p.right}`.replace(/\s+$/, "");
  });
}
