export interface TruncateMiddleOptions {
  /** Ellipsis string inserted at the cut point. Defaults to "…". */
  ellipsis?: string;
}

/**
 * Shorten a string to `max` characters by removing the middle, keeping the
 * head and tail visible. Ideal for file paths where both ends carry meaning.
 */
export function truncateMiddle(
  input: string,
  max: number,
  options: TruncateMiddleOptions = {},
): string {
  const { ellipsis = "…" } = options;
  if (max <= 0) return "";
  if (input.length <= max) return input;
  if (max <= ellipsis.length) return ellipsis.slice(0, max);

  const keep = max - ellipsis.length;
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return input.slice(0, head) + ellipsis + input.slice(input.length - tail);
}
