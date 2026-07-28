/**
 * Unicode-safe base64 encode/decode that works in both browser and Node-ish
 * environments without relying on Buffer. Encodes via UTF-8 first.
 */
export function encodeBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoaSafe(binary);
}

export function decodeBase64(input: string): string {
  const binary = atobSafe(input);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function btoaSafe(binary: string): string {
  if (typeof btoa === "function") return btoa(binary);
  let out = "";
  for (let i = 0; i < binary.length; i += 3) {
    const a = binary.charCodeAt(i);
    const b = i + 1 < binary.length ? binary.charCodeAt(i + 1) : NaN;
    const c = i + 2 < binary.length ? binary.charCodeAt(i + 2) : NaN;
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | (Number.isNaN(b) ? 0 : b >> 4)];
    out += Number.isNaN(b) ? "=" : B64[((b & 15) << 2) | (Number.isNaN(c) ? 0 : c >> 6)];
    out += Number.isNaN(c) ? "=" : B64[c & 63];
  }
  return out;
}

function atobSafe(input: string): string {
  if (typeof atob === "function") return atob(input);
  const clean = input.replace(/=+$/, "");
  let out = "";
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const idx = B64.indexOf(char);
    if (idx === -1) continue;
    value = (value << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((value >> bits) & 0xff);
    }
  }
  return out;
}
