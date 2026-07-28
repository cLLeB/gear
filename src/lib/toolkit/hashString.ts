/**
 * djb2 string hash. Fast, non-cryptographic, good distribution for short keys.
 * Returns an unsigned 32-bit integer.
 */
export function djb2(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return hash >>> 0;
}

/**
 * FNV-1a 32-bit string hash. Non-cryptographic; useful for cache keys and
 * bucketing. Returns an unsigned 32-bit integer.
 */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Hash a string to a fixed-width lowercase hex string (FNV-1a). */
export function hashHex(input: string): string {
  return fnv1a(input).toString(16).padStart(8, "0");
}
