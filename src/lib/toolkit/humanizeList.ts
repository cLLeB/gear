export interface HumanizeListOptions {
  /** "and" (conjunction) or "or" (disjunction). Defaults to conjunction. */
  type?: "conjunction" | "disjunction";
  /** BCP-47 locale. */
  locale?: string;
}

/**
 * Join a list of strings into a grammatical phrase using Intl.ListFormat:
 * ["a","b","c"] -> "a, b, and c". Falls back gracefully for 0/1 items.
 */
export function humanizeList(items: readonly string[], options: HumanizeListOptions = {}): string {
  const { type = "conjunction", locale } = options;
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  const formatter = new Intl.ListFormat(locale, { style: "long", type });
  return formatter.format(items as string[]);
}
