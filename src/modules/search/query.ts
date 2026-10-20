// Find in files: the pattern sent to the workspace grep from the search
// view's toggles, the hits grouped by file, and the match ranges to highlight.

import type { GrepHit } from "@/modules/ai/lib/native";

export interface SearchOptions {
  text: string;
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface BuiltQuery {
  pattern: string;
  caseInsensitive: boolean;
  /** For highlighting matches in result lines. */
  matcher: RegExp;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The grep pattern for these options, or an error message for an invalid regex. */
export function buildQuery(o: SearchOptions): BuiltQuery | { error: string } | null {
  if (!o.text) return null;
  let body = o.regex ? o.text : escapeRegex(o.text);
  if (o.wholeWord) body = `\\b(?:${body})\\b`;
  try {
    return { pattern: body, caseInsensitive: !o.matchCase, matcher: new RegExp(body, o.matchCase ? "g" : "gi") };
  } catch (e) {
    return { error: e instanceof Error ? e.message.replace(/^Invalid regular expression: (\/.*\/[a-z]*: )?/, "") : String(e) };
  }
}

export interface FileGroup {
  path: string;
  rel: string;
  hits: GrepHit[];
}

/** Hits grouped by file, files in the order grep reported them. */
export function groupHits(hits: GrepHit[]): FileGroup[] {
  const m = new Map<string, FileGroup>();
  for (const h of hits) {
    const g = m.get(h.path) ?? { path: h.path, rel: h.rel, hits: [] };
    g.hits.push(h);
    m.set(h.path, g);
  }
  return [...m.values()];
}

/** [start, end) ranges of the matches in `line`, for highlighting. */
export function matchRanges(line: string, matcher: RegExp, limit = 20): [number, number][] {
  const re = new RegExp(matcher.source, matcher.flags.includes("g") ? matcher.flags : `${matcher.flags}g`);
  const out: [number, number][] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) && out.length < limit) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    out.push([m.index, m.index + m[0].length]);
  }
  return out;
}

/** Comma-separated include globs from the "files to include" box. */
export function parseGlobs(input: string): string[] {
  return input
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
}
