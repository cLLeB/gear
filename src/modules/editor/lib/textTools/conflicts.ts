// Git merge-conflict blocks: parse them (including diff3's ||||||| base
// section) and compute resolutions, the model behind VS Code's
// "Accept Current | Accept Incoming | Accept Both" code lenses.

export interface ConflictBlock {
  /** Offsets spanning the whole block, from "<<<<<<<" to the end of ">>>>>>>" line. */
  from: number;
  to: number;
  current: string;
  base: string | null;
  incoming: string;
  currentLabel: string;
  incomingLabel: string;
  /** Offset of the start line, for decorations. */
  startLine: number;
}

export type Resolution = "current" | "incoming" | "both" | "base";

export function parseConflicts(doc: string): ConflictBlock[] {
  const out: ConflictBlock[] = [];
  const lines = doc.split("\n");
  let offset = 0;
  const lineStart: number[] = [];
  for (const l of lines) {
    lineStart.push(offset);
    offset += l.length + 1;
  }
  for (let i = 0; i < lines.length; i++) {
    const open = /^<{7}(?: (.*))?$/.exec(lines[i]);
    if (!open) continue;
    let mid = -1;
    let baseIdx = -1;
    let end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^<{7}( |$)/.test(lines[j])) break; // nested/unterminated: give up on this one
      if (baseIdx === -1 && mid === -1 && /^\|{7}( |$)/.test(lines[j])) baseIdx = j;
      else if (mid === -1 && /^={7}$/.test(lines[j])) mid = j;
      else if (mid !== -1 && /^>{7}( |$)/.test(lines[j])) {
        end = j;
        break;
      }
    }
    if (mid === -1 || end === -1) continue;
    const slice = (a: number, b: number) => (b > a ? `${lines.slice(a, b).join("\n")}\n` : "");
    const currentEnd = baseIdx !== -1 ? baseIdx : mid;
    out.push({
      from: lineStart[i],
      to: end + 1 < lines.length ? lineStart[end + 1] : doc.length,
      current: slice(i + 1, currentEnd),
      base: baseIdx !== -1 ? slice(baseIdx + 1, mid) : null,
      incoming: slice(mid + 1, end),
      currentLabel: open[1]?.trim() || "current",
      incomingLabel: /^>{7} ?(.*)$/.exec(lines[end])![1].trim() || "incoming",
      startLine: i + 1,
    });
    i = end;
  }
  return out;
}

export function resolve(block: ConflictBlock, how: Resolution): string {
  switch (how) {
    case "current":
      return block.current;
    case "incoming":
      return block.incoming;
    case "base":
      return block.base ?? "";
    case "both":
      return block.current + block.incoming;
  }
}

/** Resolve every conflict in a document the same way. */
export function resolveAll(doc: string, how: Resolution): { text: string; count: number } {
  const blocks = parseConflicts(doc);
  let text = "";
  let last = 0;
  for (const b of blocks) {
    text += doc.slice(last, b.from) + resolve(b, how);
    last = b.to;
  }
  return { text: text + doc.slice(last), count: blocks.length };
}
