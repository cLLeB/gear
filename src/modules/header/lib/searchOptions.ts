/**
 * Shared search modifiers for the inline find bar. The terminal (xterm's
 * SearchAddon) and the editor (CodeMirror's SearchQuery) both accept the same
 * three switches, so they live here rather than being duplicated per target.
 */

export type SearchFlags = {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
};

export type SearchFlagKey = keyof SearchFlags;

export const DEFAULT_SEARCH_FLAGS: SearchFlags = {
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};

export const SEARCH_FLAG_META: {
  key: SearchFlagKey;
  short: string;
  label: string;
}[] = [
  { key: "caseSensitive", short: "Aa", label: "Match case" },
  { key: "wholeWord", short: "ab", label: "Match whole word" },
  { key: "regex", short: ".*", label: "Use regular expression" },
];

export function toggleSearchFlag(
  flags: SearchFlags,
  key: SearchFlagKey,
): SearchFlags {
  return { ...flags, [key]: !flags[key] };
}

/**
 * A half-typed regex ("foo(") throws inside both search engines and, in
 * xterm's case, leaves the previous decorations stranded. Queries are checked
 * before they are handed over.
 */
export function isSearchQueryValid(query: string, flags: SearchFlags): boolean {
  if (!flags.regex) return true;
  try {
    new RegExp(query);
    return true;
  } catch {
    return false;
  }
}

export type SearchResults = { index: number; count: number } | null;

/**
 * Counter shown beside the field. xterm reports `index === -1` once the match
 * count blows past its highlight limit, so the ordinal is dropped there rather
 * than rendering a misleading "0 of N".
 */
export function formatSearchResults(
  results: SearchResults,
  opts: { query: string; valid: boolean },
): string {
  if (!opts.query) return "";
  if (!opts.valid) return "Bad pattern";
  if (!results || results.count === 0) return "No results";
  if (results.index < 0) return `${results.count}`;
  return `${results.index + 1}/${results.count}`;
}
