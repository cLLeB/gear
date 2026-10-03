// Text encoders/decoders for selections, the DevUtils / VS Code "Encode
// Decode" set. All are UTF-8 correct (atob/btoa alone mangle non-ASCII) and
// throw on malformed input so the caller can report it instead of silently
// producing garbage.

export type Codec = { encode: (s: string) => string; decode: (s: string) => string };

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 === 1) throw new Error("Not valid Base64");
  const bin = atob(clean.padEnd(clean.length + ((4 - (clean.length % 4)) % 4), "="));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export const base64: Codec = {
  encode: (s) => bytesToBase64(enc.encode(s)),
  decode: (s) => dec.decode(base64ToBytes(s)),
};

export const base64url: Codec = {
  encode: (s) => base64.encode(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  decode: (s) => {
    if (/[+/]/.test(s)) throw new Error("Not valid Base64URL");
    return base64.decode(s.replace(/-/g, "+").replace(/_/g, "/"));
  },
};

export const url: Codec = {
  encode: (s) => encodeURIComponent(s),
  decode: (s) => decodeURIComponent(s.replace(/\+/g, " ")),
};

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®",
  trade: "™", hellip: "…", mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  euro: "€", pound: "£", yen: "¥", cent: "¢", deg: "°", times: "×", divide: "÷", laquo: "«", raquo: "»",
};

export const html: Codec = {
  encode: (s) =>
    s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!),
  decode: (s) =>
    s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, ent: string) => {
      if (ent[0] === "#") {
        const cp = ent[1].toLowerCase() === "x" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
        return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
      }
      return NAMED[ent.toLowerCase()] ?? m;
    }),
};

export const jsonString: Codec = {
  encode: (s) => JSON.stringify(s).slice(1, -1),
  decode: (s) => {
    const body = s.startsWith('"') && s.endsWith('"') && s.length >= 2 ? s.slice(1, -1) : s;
    return JSON.parse(`"${body}"`) as string;
  },
};

export const unicodeEscape: Codec = {
  encode: (s) =>
    [...s]
      .map((ch) => {
        const cp = ch.codePointAt(0)!;
        if (cp < 0x80) return ch;
        if (cp <= 0xffff) return `\\u${cp.toString(16).padStart(4, "0")}`;
        // Astral characters as a surrogate pair, the form JS/JSON/Java accept.
        return ch
          .split("")
          .map((u) => `\\u${u.charCodeAt(0).toString(16).padStart(4, "0")}`)
          .join("");
      })
      .join(""),
  decode: (s) =>
    s
      .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\x([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))),
};

export const hex: Codec = {
  encode: (s) => [...enc.encode(s)].map((b) => b.toString(16).padStart(2, "0")).join(""),
  decode: (s) => {
    const clean = s.replace(/^0x/i, "").replace(/[\s:-]/g, "");
    if (!/^([0-9a-fA-F]{2})*$/.test(clean)) throw new Error("Not valid hex");
    return dec.decode(Uint8Array.from(clean.match(/../g) ?? [], (h) => parseInt(h, 16)));
  },
};

export const CODECS = {
  base64: { label: "Base64", codec: base64 },
  base64url: { label: "Base64URL", codec: base64url },
  url: { label: "URL", codec: url },
  html: { label: "HTML entities", codec: html },
  jsonString: { label: "JSON string", codec: jsonString },
  unicode: { label: "Unicode escapes", codec: unicodeEscape },
  hex: { label: "Hex", codec: hex },
} as const;

export type CodecId = keyof typeof CODECS;
