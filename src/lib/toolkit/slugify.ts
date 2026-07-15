export interface SlugifyOptions {
  /** Separator between words. Defaults to "-". */
  separator?: string;
  /** Lowercase the result. Defaults to true. */
  lower?: boolean;
  /** Maximum length of the slug (trimmed at a separator boundary). */
  maxLength?: number;
}

/**
 * Convert arbitrary text into a URL/branch/file-safe slug. Strips diacritics,
 * collapses non-alphanumeric runs into the separator, and trims edges.
 */
export function slugify(input: string, options: SlugifyOptions = {}): string {
  const { separator = "-", lower = true, maxLength } = options;

  let slug = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining marks
    .replace(/[^a-zA-Z0-9]+/g, separator);

  const sep = separator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  slug = slug.replace(new RegExp(`^${sep}+|${sep}+$`, "g"), "");
  if (lower) slug = slug.toLowerCase();

  if (maxLength && slug.length > maxLength) {
    slug = slug.slice(0, maxLength).replace(new RegExp(`${sep}+$`), "");
  }
  return slug;
}
