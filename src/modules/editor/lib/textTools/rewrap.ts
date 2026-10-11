// Re-flow a paragraph or comment block to a column, the way VS Code's Rewrap
// and Vim's `gq` do: the line prefix (indent + comment marker such as //, #,
// *, --, ;, or Markdown >) is detected and repeated, list items get a hanging
// indent, and blank lines separate paragraphs that are wrapped independently.

import { stringWidth } from "@/lib/toolkit/stringWidth";

const PREFIX_RE = /^(\s*(?:\/\/+!?|#+(?!\w)|--|;+|\*(?!\*)|\/\*+|>+)?\s*)/;
const BULLET_RE = /^([-*+]|\d+[.)])\s+/;

function prefixOf(line: string): string {
  return PREFIX_RE.exec(line)?.[1] ?? "";
}

function wrapWords(words: string[], first: string, rest: string, width: number): string[] {
  const out: string[] = [];
  let cur = first;
  let curHasWord = false;
  for (const w of words) {
    const candidate = curHasWord ? `${cur} ${w}` : cur + w;
    if (curHasWord && stringWidth(candidate) > width) {
      out.push(cur.replace(/\s+$/, ""));
      cur = rest + w;
    } else cur = candidate;
    curHasWord = true;
  }
  if (curHasWord) out.push(cur.replace(/\s+$/, ""));
  return out;
}

export function rewrap(lines: readonly string[], width: number): string[] {
  const out: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length === 0) return;
    const prefix = prefixOf(para[0]);
    let body = para.map((l) => l.slice(Math.min(prefixOf(l).length, l.length))).join(" ").replace(/\s+/g, " ").trim();
    // A "/* text" opener: keep the opener on the first line, continue with " * ".
    const continuation = /\/\*+\s*$/.test(prefix) ? prefix.replace(/\/\*+/, " *") : prefix;
    let first = prefix;
    let rest = continuation;
    const bullet = BULLET_RE.exec(body);
    if (bullet) {
      first = prefix + bullet[0];
      rest = continuation + " ".repeat(bullet[0].length);
      body = body.slice(bullet[0].length);
    }
    out.push(...wrapWords(body.split(" ").filter(Boolean), first, rest, width));
    para = [];
  };
  for (const line of lines) {
    const prefix = prefixOf(line);
    const content = line.slice(prefix.length).trim();
    const startsItem = BULLET_RE.test(content);
    const sameBlock = para.length === 0 || prefixOf(para[0]).trim() === prefix.trim();
    const closer = /^\s*\*+\/\s*$/.test(line);
    if (content === "" || closer || !sameBlock) {
      flush();
      if (content === "" || closer) {
        out.push(line.replace(/\s+$/, ""));
        continue;
      }
    }
    if (startsItem) flush();
    para.push(line);
  }
  flush();
  return out;
}
