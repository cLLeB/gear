// A flat, depth-annotated outline for "Go to symbol": code symbols from the
// in-process extractor, Markdown headings for prose files.

import { extractSymbols, type DocumentSymbol } from "@/lib/lang/symbols";

export interface OutlineItem {
  name: string;
  kind: string;
  depth: number;
  from: number;
  /** Names of enclosing symbols, e.g. "MyClass" for a method. */
  container: string;
}

export function markdownHeadings(source: string): OutlineItem[] {
  const out: OutlineItem[] = [];
  const stack: Array<{ level: number; name: string }> = [];
  let inFence = false;
  let offset = 0;
  for (const line of source.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = !inFence ? /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line) : null;
    if (m) {
      const level = m[1].length;
      while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
      out.push({
        name: m[2],
        kind: `h${level}`,
        depth: stack.length,
        from: offset,
        container: stack.map((s) => s.name).join(" › "),
      });
      stack.push({ level, name: m[2] });
    }
    offset += line.length + 1;
  }
  return out;
}

export function documentOutline(source: string, languageId: string): OutlineItem[] {
  if (languageId === "markdown" || languageId === "md") return markdownHeadings(source);
  const out: OutlineItem[] = [];
  const walk = (nodes: DocumentSymbol[], depth: number, container: string[]) => {
    for (const n of nodes) {
      out.push({ name: n.name, kind: n.kind, depth, from: n.from, container: container.join(" › ") });
      walk(n.children, depth + 1, [...container, n.name]);
    }
  };
  walk(extractSymbols(source, languageId), 0, []);
  return out;
}
