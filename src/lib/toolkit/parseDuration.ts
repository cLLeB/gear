const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  sec: 1_000,
  m: 60_000,
  min: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/**
 * Parse a compact human duration such as "2h30m", "1d", or "500ms" into
 * milliseconds. Whitespace between segments is optional. Returns null when the
 * string contains no recognisable duration.
 */
export function parseDuration(input: string): number | null {
  const re = /(\d+(?:\.\d+)?)\s*(ms|sec|min|hr|[smhdw])/gi;
  let total = 0;
  let matched = false;
  let m: RegExpExecArray | null;

  while ((m = re.exec(input)) !== null) {
    const value = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    const factor = UNIT_MS[unit];
    if (factor === undefined) continue;
    total += value * factor;
    matched = true;
  }

  return matched ? total : null;
}
