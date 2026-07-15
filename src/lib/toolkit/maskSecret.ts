export interface MaskOptions {
  /** Visible characters kept at the start. Defaults to 4. */
  visibleStart?: number;
  /** Visible characters kept at the end. Defaults to 4. */
  visibleEnd?: number;
  /** Mask character. Defaults to "•". */
  maskChar?: string;
}

/**
 * Mask the middle of a secret so it can be shown safely (e.g. "sk-a…9f").
 * Short secrets are fully masked to avoid leaking a meaningful fraction.
 */
export function maskSecret(secret: string, options: MaskOptions = {}): string {
  const { visibleStart = 4, visibleEnd = 4, maskChar = "•" } = options;
  const keep = visibleStart + visibleEnd;

  if (secret.length <= keep) {
    return maskChar.repeat(Math.max(secret.length, 1));
  }
  const head = secret.slice(0, visibleStart);
  const tail = secret.slice(secret.length - visibleEnd);
  const masked = maskChar.repeat(Math.max(3, secret.length - keep));
  return `${head}${masked}${tail}`;
}
