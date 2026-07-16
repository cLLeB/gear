/** Longest common leading substring shared by all input strings. */
export function longestCommonPrefix(strings: readonly string[]): string {
  if (strings.length === 0) return "";
  let prefix = strings[0];
  for (let i = 1; i < strings.length; i++) {
    const s = strings[i];
    let j = 0;
    while (j < prefix.length && j < s.length && prefix[j] === s[j]) j++;
    prefix = prefix.slice(0, j);
    if (!prefix) break;
  }
  return prefix;
}

/**
 * Longest common directory prefix of a set of "/"-separated paths, returned
 * without a trailing slash. Backslashes are normalised to slashes first.
 */
export function commonPathPrefix(paths: readonly string[]): string {
  if (paths.length === 0) return "";
  const split = paths.map((p) => p.replace(/\\/g, "/").split("/"));
  const first = split[0];
  const common: string[] = [];

  for (let i = 0; i < first.length; i++) {
    const segment = first[i];
    if (split.every((parts) => parts[i] === segment)) common.push(segment);
    else break;
  }
  return common.join("/");
}
