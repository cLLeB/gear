// Digests of text (UTF-8): SHA family through WebCrypto, plus MD5 and CRC32
// which WebCrypto does not offer but people still need for checksums, cache
// keys and legacy APIs.

const enc = new TextEncoder();

const toHex = (bytes: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

// RFC 1321. Operates on 32-bit words with wrap-around arithmetic.
const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

export function md5(input: string | Uint8Array): string {
  const msg = typeof input === "string" ? enc.encode(input) : input;
  const len = msg.length;
  const padded = new Uint8Array(((len + 8) >> 6) * 64 + 64);
  padded.set(msg);
  padded[len] = 0x80;
  const bits = len * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bits >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bits / 2 ** 32), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  for (let off = 0; off < padded.length; off += 64) {
    const M = Array.from({ length: 16 }, (_, i) => view.getUint32(off + i * 4, true));
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const tmp = d;
      d = c;
      c = b;
      const sum = (a + f + K[i] + M[g]) >>> 0;
      b = (b + ((sum << S[i]) | (sum >>> (32 - S[i])))) >>> 0;
      a = tmp;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  const out = new DataView(new ArrayBuffer(16));
  [a0, b0, c0, d0].forEach((w, i) => out.setUint32(i * 4, w, true));
  return toHex(out.buffer);
}

let crcTable: Uint32Array | null = null;
export function crc32(input: string): string {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of enc.encode(input)) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
}

export type HashAlgorithm = "MD5" | "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512" | "CRC32";
export const HASH_ALGORITHMS: HashAlgorithm[] = ["SHA-256", "SHA-1", "SHA-512", "SHA-384", "MD5", "CRC32"];

export async function hashText(text: string, algo: HashAlgorithm): Promise<string> {
  if (algo === "MD5") return md5(text);
  if (algo === "CRC32") return crc32(text);
  return toHex(await crypto.subtle.digest(algo, enc.encode(text)));
}

export async function allHashes(text: string): Promise<Array<{ algo: HashAlgorithm; digest: string }>> {
  return Promise.all(HASH_ALGORITHMS.map(async (algo) => ({ algo, digest: await hashText(text, algo) })));
}
