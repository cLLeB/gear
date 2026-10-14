// Links in Markdown docs: every link and image (inline, reference, HTML,
// autolinks) outside code, the heading anchors GitHub generates, and which
// links point at files, headings or references that do not exist.

export type LinkKind = "inline" | "image" | "reference" | "html" | "autolink";

export interface Link {
  target: string;
  text: string;
  kind: LinkKind;
  line: number;
  column: number;
}

/** Lines of the document with fenced code blocks and inline code blanked out (offsets kept). */
function withoutCode(md: string): string[] {
  const lines = md.split(/\r?\n/);
  let fence: string | null = null;
  return lines.map((line) => {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      return " ".repeat(line.length);
    }
    if (m) {
      fence = m[1];
      return " ".repeat(line.length);
    }
    // Indented code (4 spaces) after a blank line is rare in docs with links; inline code is common.
    return line.replace(/(`+)(?:(?!\1).)+?\1/g, (s) => " ".repeat(s.length)).replace(/<!--.*?-->/g, (s) => " ".repeat(s.length));
  });
}

/** Every link in a Markdown document, with its 1-based line and column. */
export function extractLinks(md: string): Link[] {
  const out: Link[] = [];
  const lines = withoutCode(md);
  const defs = referenceDefinitions(md);
  lines.forEach((line, i) => {
    const push = (target: string, text: string, kind: LinkKind, col: number) => out.push({ target: target.trim(), text, kind, line: i + 1, column: col + 1 });
    // Inline links and images: [text](target "title") / ![alt](target)
    for (const m of line.matchAll(/(!?)\[((?:[^\]\\]|\\.)*)\]\(\s*(<[^>]*>|(?:[^\s()]|\([^\s()]*\))+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g)) {
      push(m[3].replace(/^<|>$/g, ""), m[2], m[1] ? "image" : "inline", m.index ?? 0);
    }
    // Reference links: [text][ref], [ref][], and [ref] when ref is defined.
    for (const m of line.matchAll(/(!?)\[((?:[^\]\\]|\\.)+)\](?:\[([^\]]*)\])?(?!\(|:)/g)) {
      const label = (m[3] === undefined || m[3] === "" ? m[2] : m[3]).trim().toLowerCase().replace(/\s+/g, " ");
      if (m[3] === undefined && !defs.has(label)) continue;
      if (/^[ xX]$/.test(m[2])) continue;
      push(defs.get(label) ?? `[${label}]`, m[2], "reference", m.index ?? 0);
    }
    // HTML: <a href="..."> and <img src="...">
    for (const m of line.matchAll(/<(?:a\s[^>]*?href|img\s[^>]*?src)\s*=\s*["']([^"']+)["']/gi)) push(m[1], "", m[0].toLowerCase().startsWith("<img") ? "image" : "html", m.index ?? 0);
    // Autolinks: <https://...>
    for (const m of line.matchAll(/<((?:https?|mailto):[^>\s]+)>/g)) push(m[1], m[1], "autolink", m.index ?? 0);
  });
  return out;
}

/** `[label]: target` definitions, by lower-cased label. */
export function referenceDefinitions(md: string): Map<string, string> {
  const defs = new Map<string, string>();
  for (const m of md.matchAll(/^ {0,3}\[([^\]]+)\]:\s*<?([^\s>]+)>?/gm)) defs.set(m[1].trim().toLowerCase().replace(/\s+/g, " "), m[2]);
  return defs;
}

/** The anchor GitHub gives a heading: lower case, punctuation dropped, spaces to hyphens. */
export function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, (c) => (c === "_" ? "_" : ""))
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** Every anchor a document defines: headings (with -1, -2 for repeats), explicit ids and names. */
export function anchors(md: string): Set<string> {
  const out = new Set<string>();
  const counts = new Map<string, number>();
  const lines = withoutCode(md);
  const raw = md.split(/\r?\n/);
  lines.forEach((line, i) => {
    let heading: string | null = null;
    const atx = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (atx) heading = raw[i].replace(/^\s{0,3}#{1,6}\s+/, "").replace(/\s+#+\s*$/, "");
    else if (i + 1 < lines.length && /^\s{0,3}(=+|-+)\s*$/.test(lines[i + 1]) && line.trim() && !/^\s{0,3}([-*+]|\d+\.)\s/.test(line)) heading = raw[i];
    if (heading !== null) {
      const custom = /\{#([\w-]+)\}\s*$/.exec(heading);
      if (custom) out.add(custom[1]);
      const base = slug(heading.replace(/\{#[\w-]+\}\s*$/, ""));
      const n = counts.get(base) ?? 0;
      counts.set(base, n + 1);
      out.add(n ? `${base}-${n}` : base);
    }
    for (const m of raw[i].matchAll(/<(?:a|span|div|h\d)\s[^>]*?(?:id|name)\s*=\s*["']([^"']+)["']/gi)) out.add(m[1]);
  });
  return out;
}

export type Target = { kind: "external"; url: string } | { kind: "local"; path: string; anchor: string | null } | { kind: "anchor"; anchor: string } | { kind: "skip"; why: string } | { kind: "undefined-reference"; label: string };

const norm = (p: string) => {
  const parts: string[] = [];
  for (const seg of p.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (parts.length && parts[parts.length - 1] !== "..") parts.pop();
      else parts.push("..");
    } else parts.push(seg);
  }
  return parts.join("/");
};

/** What a link points at, relative paths resolved against the linking file (workspace-relative, `/` separators). */
export function resolveTarget(from: string, target: string): Target {
  const t = target.trim();
  if (/^\[.*\]$/.test(t)) return { kind: "undefined-reference", label: t.slice(1, -1) };
  if (/^https?:\/\//i.test(t)) return { kind: "external", url: t };
  if (/^(mailto|tel|data|javascript|ftp|file|vscode|app):/i.test(t) || /^\/\//.test(t)) return { kind: "skip", why: "not checked" };
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return { kind: "skip", why: "other scheme" };
  if (t.startsWith("#")) return { kind: "anchor", anchor: decodeURIComponent(t.slice(1)) };
  const [pathPart, ...rest] = t.split("#");
  const anchor = rest.length ? decodeURIComponent(rest.join("#")) : null;
  let p = pathPart.split("?")[0];
  try {
    p = decodeURI(p);
  } catch {
    // Keep it as written.
  }
  const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
  const path = p.startsWith("/") ? norm(p) : norm(`${dir}/${p}`);
  return { kind: "local", path, anchor };
}

export type ProblemKind = "missing-file" | "case-mismatch" | "missing-anchor" | "undefined-reference" | "outside" | "broken-url" | "redirect";

export interface Problem {
  file: string;
  link: Link;
  kind: ProblemKind;
  message: string;
}

export interface Workspace {
  /** Workspace-relative file paths. */
  files: Set<string>;
  /** Anchors of each Markdown file (looked up lazily). */
  anchorsOf: (path: string) => Set<string> | null;
}

/** Checks one file's links against the workspace (external URLs are left for later). */
export function checkFile(file: string, md: string, ws: Workspace): { problems: Problem[]; external: { link: Link; url: string }[] } {
  const problems: Problem[] = [];
  const external: { link: Link; url: string }[] = [];
  const lower = new Map<string, string>();
  for (const f of ws.files) lower.set(f.toLowerCase(), f);
  const dirs = new Set<string>();
  for (const f of ws.files) {
    const parts = f.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  const ownAnchors = anchors(md);
  for (const link of extractLinks(md)) {
    const t = resolveTarget(file, link.target);
    const add = (kind: ProblemKind, message: string) => problems.push({ file, link, kind, message });
    if (t.kind === "external") external.push({ link, url: t.url });
    else if (t.kind === "undefined-reference") add("undefined-reference", `No definition for the reference [${t.label}].`);
    else if (t.kind === "anchor") {
      if (t.anchor && !ownAnchors.has(t.anchor) && !ownAnchors.has(t.anchor.toLowerCase())) add("missing-anchor", `No heading in this file has the anchor #${t.anchor}.${suggest(t.anchor, ownAnchors)}`);
    } else if (t.kind === "local") {
      if (t.path.startsWith("..")) {
        add("outside", `Points outside the workspace (${t.path}).`);
        continue;
      }
      const target = t.path.replace(/\/$/, "");
      if (!target) continue;
      const exists = ws.files.has(target) || dirs.has(target);
      if (!exists) {
        const ci = lower.get(target.toLowerCase());
        if (ci) add("case-mismatch", `The file is ${ci}; the link's capitalisation differs, which breaks on Linux and on GitHub.`);
        else add("missing-file", `${target} does not exist.`);
        continue;
      }
      if (t.anchor && /\.(md|markdown|mdx)$/i.test(target)) {
        const a = ws.anchorsOf(target);
        if (a && !a.has(t.anchor) && !a.has(t.anchor.toLowerCase())) add("missing-anchor", `${target} has no heading with the anchor #${t.anchor}.${suggest(t.anchor, a)}`);
      }
    }
  }
  return { problems, external };
}

/** A close anchor name, as a hint. */
function suggest(want: string, have: Set<string>): string {
  let best = "";
  let bestD = Infinity;
  for (const h of have) {
    const d = distance(want.toLowerCase(), h);
    if (d < bestD) (bestD = d), (best = h);
  }
  return best && bestD <= Math.max(2, Math.floor(want.length / 4)) ? ` Did you mean #${best}?` : "";
}

export function distance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

export const CURL_MARK = "@@gear@@";

/** Arguments for one curl run that checks several URLs (HEAD, redirects followed); bodies go to `nullDevice`. */
export function curlArgs(urls: string[], nullDevice: string, head = true): string[] {
  const args = ["-s", "-L", "--max-time", "12", "--connect-timeout", "6", "-A", "Mozilla/5.0 (Gear link check)", "-Z", "--parallel-max", "8", "-w", `${CURL_MARK}%{http_code}\\t%{num_redirects}\\t%{url_effective}\\t%{url}\\n`];
  if (head) args.push("-I");
  else args.push("-r", "0-0");
  for (const u of urls) args.push("-o", nullDevice, u);
  return args;
}

export interface UrlResult {
  url: string;
  status: number;
  redirects: number;
  final: string;
}

export function parseCurl(out: string): UrlResult[] {
  const res: UrlResult[] = [];
  for (const line of out.split(/\r?\n/)) {
    const i = line.indexOf(CURL_MARK);
    if (i < 0) continue;
    const [status, redirects, final, url] = line.slice(i + CURL_MARK.length).split("\t");
    res.push({ url: url ?? final, status: Number(status) || 0, redirects: Number(redirects) || 0, final });
  }
  return res;
}

/** What a URL's result means; null when it is fine. */
export function judgeUrl(r: UrlResult): { kind: ProblemKind; message: string } | null {
  if (r.status === 0) return { kind: "broken-url", message: "No answer (the host is unreachable, the name does not resolve, or it timed out)." };
  if (r.status === 404 || r.status === 410) return { kind: "broken-url", message: `${r.status} — the page is gone.` };
  if (r.status >= 500) return { kind: "broken-url", message: `${r.status} — the server failed.` };
  if (r.status >= 400 && r.status !== 401 && r.status !== 403 && r.status !== 429) return { kind: "broken-url", message: `${r.status}.` };
  if (r.redirects > 0 && stripSlash(r.final) !== stripSlash(r.url) && !sameButHttps(r.url, r.final)) return { kind: "redirect", message: `Redirects to ${r.final}; link there directly.` };
  return null;
}

const stripSlash = (u: string) => u.replace(/\/+$/, "").replace(/#.*$/, "");
const sameButHttps = (a: string, b: string) => stripSlash(a.replace(/^http:/, "https:")) === stripSlash(b);
