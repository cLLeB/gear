let TABLE: Uint32Array | null = null;

function getTable(): Uint32Array {
  if (TABLE) return TABLE;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  TABLE = table;
  return table;
}

/**
 * Compute the CRC-32 (IEEE 802.3) checksum of a string or byte array, returned
 * as an unsigned 32-bit integer. Matches zlib/gzip CRC output.
 */
export function crc32(input: string | Uint8Array): number {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const table = getTable();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** CRC-32 as a zero-padded lowercase hex string. */
export function crc32Hex(input: string | Uint8Array): string {
  return crc32(input).toString(16).padStart(8, "0");
}
