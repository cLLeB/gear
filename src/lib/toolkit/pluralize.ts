/**
 * Return the singular or plural form based on count. When no plural is given,
 * a naive English rule is applied (adds -s / -es / -ies).
 */
export function pluralize(count: number, singular: string, plural?: string): string {
  if (Math.abs(count) === 1) return singular;
  if (plural) return plural;

  if (/(?:s|x|z|ch|sh)$/i.test(singular)) return `${singular}es`;
  if (/[^aeiou]y$/i.test(singular)) return `${singular.slice(0, -1)}ies`;
  return `${singular}s`;
}

/** Prefix the count: pluralizeWithCount(3, "file") -> "3 files". */
export function pluralizeWithCount(count: number, singular: string, plural?: string): string {
  return `${count} ${pluralize(count, singular, plural)}`;
}
