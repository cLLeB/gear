// `xxd`-style hex dump of bytes.

export function hexDump(bytes: Uint8Array, offset = 0, width = 16): string {
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += width) {
    const row = bytes.subarray(i, i + width);
    const hex = Array.from(row, (b) => b.toString(16).padStart(2, "0"));
    const groups: string[] = [];
    for (let g = 0; g < width; g += 2) groups.push((hex[g] ?? "  ") + (hex[g + 1] ?? "  "));
    const ascii = Array.from(row, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".")).join("");
    lines.push(`${(offset + i).toString(16).padStart(8, "0")}: ${groups.join(" ")}  ${ascii}`);
  }
  return lines.join("\n") + "\n";
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", ico: "image/x-icon",
  avif: "image/avif", bmp: "image/bmp", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", pdf: "application/pdf",
  json: "application/json", txt: "text/plain", css: "text/css", js: "text/javascript", html: "text/html", mp3: "audio/mpeg", wav: "audio/wav",
  mp4: "video/mp4", webm: "video/webm",
};

export function mimeForPath(path: string): string {
  return MIME[/\.([^.\\/]+)$/.exec(path)?.[1]?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

/** Guess text encoding / line endings / BOM from the first bytes. */
export function describeBytes(bytes: Uint8Array): { encoding: string; eol: string; binary: boolean } {
  let encoding = "UTF-8";
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) encoding = "UTF-8 with BOM";
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = "UTF-16 LE";
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = "UTF-16 BE";
  const sample = bytes.subarray(0, 8000);
  const binary = !encoding.startsWith("UTF-16") && sample.includes(0);
  if (!binary && encoding === "UTF-8") {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(sample.subarray(0, sample.length - 4));
    } catch {
      encoding = "not UTF-8 (Latin-1 / Windows-1252?)";
    }
  }
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 13) sample[i + 1] === 10 ? (crlf++, i++) : cr++;
    else if (sample[i] === 10) lf++;
  }
  const eol = crlf && lf ? "mixed (CRLF + LF)" : crlf ? "CRLF (Windows)" : cr && !lf ? "CR (classic Mac)" : lf ? "LF (Unix)" : "none";
  return { encoding: binary ? "binary" : encoding, eol, binary };
}
