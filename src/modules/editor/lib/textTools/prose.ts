// Prose and Markdown helpers: a write-good style linter, ordered-list
// renumbering, a local link checker, and HTML → Markdown conversion.

export interface ProseIssue {
  from: number;
  to: number;
  kind: "repeat" | "weasel" | "passive" | "long" | "spacing" | "cliche" | "adverb";
  message: string;
}

const WEASEL = ["very", "really", "quite", "extremely", "basically", "actually", "simply", "just", "fairly", "rather", "somewhat", "various", "a number of", "clearly", "obviously", "of course"];
const CLICHES = ["at the end of the day", "in order to", "due to the fact that", "at this point in time", "it goes without saying", "needless to say", "for all intents and purposes", "in the event that", "the fact that", "a lot of"];
const IRREGULAR = "been|done|gone|seen|known|shown|given|taken|written|made|found|built|sent|kept|held|left|lost|paid|put|read|run|set|told|thought|understood|chosen|driven|eaten|forgotten|hidden|broken|spoken|stolen|thrown";

export function lintProse(text: string, maxSentenceWords = 30): ProseIssue[] {
  const out: ProseIssue[] = [];
  for (const m of text.matchAll(/\b(\w+)\s+\1\b/gi)) {
    // "had had" and "that that" are often correct.
    if (/^(had|that)$/i.test(m[1])) continue;
    out.push({ from: m.index!, to: m.index! + m[0].length, kind: "repeat", message: `Repeated word "${m[1]}"` });
  }
  for (const w of WEASEL) {
    for (const m of text.matchAll(new RegExp(`\\b${w}\\b`, "gi"))) out.push({ from: m.index!, to: m.index! + m[0].length, kind: "weasel", message: `"${m[0]}" weakens the sentence` });
  }
  for (const c of CLICHES) {
    for (const m of text.matchAll(new RegExp(`\\b${c}\\b`, "gi"))) out.push({ from: m.index!, to: m.index! + m[0].length, kind: "cliche", message: `Wordy: "${m[0]}"` });
  }
  for (const m of text.matchAll(new RegExp(`\\b(am|are|is|was|were|be|been|being)\\s+(\\w+ed|${IRREGULAR})\\b`, "gi"))) {
    out.push({ from: m.index!, to: m.index! + m[0].length, kind: "passive", message: `Passive voice: "${m[0]}"` });
  }
  for (const m of text.matchAll(/[^ \n]( {2,})(?=[^ \n])/g)) {
    const at = m.index! + 1;
    out.push({ from: at, to: at + m[1].length, kind: "spacing", message: "Multiple spaces" });
  }
  for (const m of text.matchAll(/[^.!?\n]+[.!?]/g)) {
    const words = m[0].trim().split(/\s+/).length;
    if (words > maxSentenceWords) out.push({ from: m.index!, to: m.index! + m[0].length, kind: "long", message: `Long sentence (${words} words)` });
  }
  return out.sort((a, b) => a.from - b.from);
}

/** Renumber every ordered list (respecting nesting and the first number). */
export function renumberLists(markdown: string): string {
  const lines = markdown.split("\n");
  const counters = new Map<number, number>();
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = /^(\s*)(\d+)([.)])(\s+)/.exec(line);
    if (!m) {
      if (line.trim() === "") continue;
      const indent = /^\s*/.exec(line)![0].length;
      // A non-list line at a shallower indent ends deeper lists.
      for (const k of [...counters.keys()]) if (k >= indent && !/^\s*[-*+]\s/.test(line)) counters.delete(k);
      continue;
    }
    const indent = m[1].length;
    for (const k of [...counters.keys()]) if (k > indent) counters.delete(k);
    const n = counters.has(indent) ? counters.get(indent)! + 1 : Number(m[2]);
    counters.set(indent, n);
    lines[i] = `${m[1]}${n}${m[3]}${m[4]}${line.slice(m[0].length)}`;
  }
  return lines.join("\n");
}

export interface MdLink {
  text: string;
  target: string;
  line: number;
}

/** Inline links/images and reference definitions, outside code. */
export function extractLinks(markdown: string): MdLink[] {
  const out: MdLink[] = [];
  let inFence = false;
  markdown.split("\n").forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) return;
    const clean = line.replace(/`[^`]*`/g, (m) => " ".repeat(m.length));
    for (const m of clean.matchAll(/!?\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g)) out.push({ text: m[1], target: m[2], line: i + 1 });
    const ref = /^\s*\[([^\]]+)\]:\s*<?(\S+?)>?(\s|$)/.exec(clean);
    if (ref) out.push({ text: ref[1], target: ref[2], line: i + 1 });
  });
  return out;
}

/** GitHub-style heading anchor. */
export function slugifyHeading(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

export function headingAnchors(markdown: string): Set<string> {
  const seen = new Map<string, number>();
  const out = new Set<string>();
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const base = slugifyHeading(m[1]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n ? `${base}-${n}` : base);
  }
  return out;
}

// ── HTML → Markdown ───────────────────────────────────────────────────────

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");

/** Convert common HTML (headings, emphasis, links, lists, code, tables, quotes) to Markdown. */
export function htmlToMarkdown(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/\r/g, "");
  // Code blocks first so their content is left alone.
  const blocks: string[] = [];
  s = s.replace(/<pre[^>]*>\s*(?:<code(?:\s+class="[^"]*?(?:language|lang)-([\w+-]+)[^"]*")?[^>]*>)?([\s\S]*?)(?:<\/code>)?\s*<\/pre>/gi, (_m, lang: string | undefined, code: string) => {
    blocks.push(`\n\n\`\`\`${lang ?? ""}\n${decode(code.replace(/<[^>]+>/g, "")).replace(/\n$/, "")}\n\`\`\`\n\n`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  s = s.replace(/<table[\s\S]*?<\/table>/gi, (table) => {
    const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) => [...r[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => decode(c[1].replace(/<[^>]+>/g, "")).trim().replace(/\|/g, "\\|")));
    if (!rows.length) return "";
    const width = Math.max(...rows.map((r) => r.length));
    const pad = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
    return `\n\n${[pad(rows[0]), `| ${Array(width).fill("---").join(" | ")} |`, ...rows.slice(1).map(pad)].join("\n")}\n\n`;
  });
  s = s
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, n: string, t: string) => `\n\n${"#".repeat(Number(n))} ${t.replace(/\s+/g, " ").trim()}\n\n`)
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, "_$2_")
    .replace(/<(del|s|strike)\b[^>]*>([\s\S]*?)<\/\1>/gi, "~~$2~~")
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_m, c: string) => `\`${decode(c.replace(/<[^>]+>/g, ""))}\``)
    .replace(/<img[^>]*?src="([^"]*)"[^>]*?(?:alt="([^"]*)")?[^>]*>/gi, (_m, src: string, alt?: string) => `![${alt ?? ""}](${src})`)
    .replace(/<a[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, t: string) => `[${t.replace(/\s+/g, " ").trim()}](${href})`)
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, q: string) => `\n\n${q.replace(/<\/?p[^>]*>/gi, "\n").trim().split("\n").map((l) => `> ${l.trim()}`).join("\n")}\n\n`)
    .replace(/<hr[^>]*>/gi, "\n\n---\n\n")
    .replace(/<br\s*\/?>/gi, "  \n");
  // Lists, innermost first.
  for (let guard = 0; guard < 10 && /<(ul|ol)[^>]*>/i.test(s); guard++) {
    s = s.replace(/<(ul|ol)([^>]*)>((?:(?!<(?:ul|ol)[\s>])[\s\S])*?)<\/\1>/gi, (_m, kind: string, attrs: string, inner: string) => {
      let n = Number(/start="(\d+)"/.exec(attrs)?.[1] ?? 1);
      const items = [...inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((li) => {
        const body = li[1].replace(/<\/?p[^>]*>/gi, "").trim().split("\n").map((l, i) => (i ? `   ${l}` : l)).join("\n");
        return `${kind.toLowerCase() === "ol" ? `${n++}.` : "-"} ${body}`;
      });
      return `\n${items.join("\n")}\n`;
    });
  }
  s = s
    .replace(/<\/?(p|div|section|article|header|footer|main)[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  s = decode(s)
    .replace(/\u0000(\d+)\u0000/g, (_m, i: string) => blocks[Number(i)])
    .replace(/[ \t]+\n/g, (m) => (m.startsWith("  ") ? "  \n" : "\n"))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return `${s}\n`;
}
