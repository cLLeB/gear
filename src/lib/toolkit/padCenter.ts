/**
 * Center a string within `width` columns using `fill`. Extra padding favours
 * the right side. Strings already at or over the width are returned unchanged.
 */
export function padCenter(text: string, width: number, fill = " "): string {
  if (fill.length === 0) return text;
  const total = width - text.length;
  if (total <= 0) return text;
  const left = Math.floor(total / 2);
  const right = total - left;
  return buildPad(left, fill) + text + buildPad(right, fill);
}

function buildPad(count: number, fill: string): string {
  let out = "";
  while (out.length < count) out += fill;
  return out.slice(0, count);
}
