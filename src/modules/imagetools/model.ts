// Images without a library: the format and size from the file header, the
// EXIF metadata of JPEGs (camera, exposure, date, GPS position), and .ico
// files assembled from PNGs for a favicon set.

export type ImageFormat = "png" | "jpeg" | "gif" | "webp" | "bmp" | "ico" | "svg" | "avif" | "tiff";

export interface ImageInfo {
  format: ImageFormat;
  width: number;
  height: number;
  /** PNG: has an alpha channel or transparency chunk. */
  alpha?: boolean;
  /** GIF / PNG (APNG) / WebP: more than one frame. */
  animated?: boolean;
  /** JPEG: progressive encoding. */
  progressive?: boolean;
  /** Bits per channel (PNG) or per pixel (BMP). */
  bitDepth?: number;
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u32le = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

/** Reads the format and pixel size from the first bytes of an image file. */
export function imageInfo(b: Uint8Array): ImageInfo | null {
  if (b.length >= 24 && u32be(b, 0) === 0x89504e47 && ascii(b, 12, 4) === "IHDR") {
    const colorType = b[25];
    let animated = false;
    let alpha = colorType === 4 || colorType === 6;
    // Walk the chunks up to the image data for acTL (APNG) and tRNS.
    for (let i = 8; i + 8 <= b.length; ) {
      const len = u32be(b, i);
      const type = ascii(b, i + 4, 4);
      if (type === "acTL") animated = true;
      if (type === "tRNS") alpha = true;
      if (type === "IDAT" || type === "IEND") break;
      i += 12 + len;
    }
    return { format: "png", width: u32be(b, 16), height: u32be(b, 20), alpha, animated, bitDepth: b[24] };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length; ) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = u16be(b, i + 2);
      // Start-of-frame markers: C0–CF except C4 (DHT), C8 (JPG) and CC (DAC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { format: "jpeg", height: u16be(b, i + 5), width: u16be(b, i + 7), progressive: marker === 0xc2 || marker === 0xc6 || marker === 0xca || marker === 0xce, bitDepth: b[i + 4] };
      }
      if (marker === 0xda) break;
      i += 2 + len;
    }
    return null;
  }
  if (b.length >= 10 && ascii(b, 0, 3) === "GIF") {
    let frames = 0;
    for (let i = 0; i < b.length - 2 && frames < 2; i++) if (b[i] === 0x00 && b[i + 1] === 0x21 && b[i + 2] === 0xf9) frames++;
    return { format: "gif", width: u16le(b, 6), height: u16le(b, 8), animated: frames > 1 };
  }
  if (b.length >= 30 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") {
    const chunk = ascii(b, 12, 4);
    if (chunk === "VP8X") return { format: "webp", width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)), animated: (b[20] & 0x02) !== 0, alpha: (b[20] & 0x10) !== 0 };
    if (chunk === "VP8L") {
      const bits = u32le(b, 21);
      return { format: "webp", width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff), alpha: ((bits >> 28) & 1) === 1 };
    }
    if (chunk === "VP8 ") return { format: "webp", width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
    return null;
  }
  if (b.length >= 26 && b[0] === 0x42 && b[1] === 0x4d) {
    const h = u32le(b, 22) | 0;
    return { format: "bmp", width: u32le(b, 18) | 0, height: Math.abs(h), bitDepth: u16le(b, 28) };
  }
  if (b.length >= 6 && u16le(b, 0) === 0 && u16le(b, 2) === 1 && u16le(b, 4) > 0) {
    // The largest icon in the file.
    let best = { w: 0, h: 0 };
    for (let n = 0; n < u16le(b, 4) && 6 + n * 16 + 16 <= b.length; n++) {
      const w = b[6 + n * 16] || 256;
      const h = b[7 + n * 16] || 256;
      if (w * h > best.w * best.h) best = { w, h };
    }
    return { format: "ico", width: best.w, height: best.h };
  }
  if (b.length >= 12 && ascii(b, 4, 4) === "ftyp" && /avif|avis/.test(ascii(b, 8, 4))) {
    // The ispe box carries the size.
    for (let i = 12; i + 20 <= b.length && i < 4096; i++) if (ascii(b, i, 4) === "ispe") return { format: "avif", width: u32be(b, i + 8), height: u32be(b, i + 12) };
    return { format: "avif", width: 0, height: 0 };
  }
  if (b.length >= 8 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 42) || (b[0] === 0x4d && b[1] === 0x4d && b[3] === 42))) {
    const t = readTiff(b, 0);
    return { format: "tiff", width: Number(t.ifd0.get(0x0100) ?? 0), height: Number(t.ifd0.get(0x0101) ?? 0) };
  }
  const head = new TextDecoder().decode(b.subarray(0, 4096));
  if (/<svg[\s>]/i.test(head)) {
    const tag = /<svg\b[^>]*>/i.exec(head)?.[0] ?? "";
    const attr = (n: string) => Number.parseFloat(new RegExp(`\\b${n}\\s*=\\s*["']?([\\d.]+)`, "i").exec(tag)?.[1] ?? "");
    const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(tag);
    return { format: "svg", width: attr("width") || Number(vb?.[1] ?? 0), height: attr("height") || Number(vb?.[2] ?? 0) };
  }
  return null;
}

// --- EXIF ------------------------------------------------------------------

type TagValue = number | string | number[];

interface Tiff {
  ifd0: Map<number, TagValue>;
  exif: Map<number, TagValue>;
  gps: Map<number, TagValue>;
}

/** Reads the TIFF structure EXIF is stored in, starting at `base`. */
function readTiff(b: Uint8Array, base: number): Tiff {
  const le = b[base] === 0x49;
  const r16 = (i: number) => (le ? u16le(b, base + i) : u16be(b, base + i));
  const r32 = (i: number) => (le ? u32le(b, base + i) : u32be(b, base + i));
  const size = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];
  const readIfd = (offset: number): Map<number, TagValue> => {
    const out = new Map<number, TagValue>();
    if (offset <= 0 || base + offset + 2 > b.length) return out;
    const count = r16(offset);
    for (let n = 0; n < count && n < 500; n++) {
      const e = offset + 2 + n * 12;
      if (base + e + 12 > b.length) break;
      const tag = r16(e);
      const type = r16(e + 2);
      const num = r32(e + 4);
      const bytes = (size[type] ?? 1) * num;
      const at = bytes <= 4 ? e + 8 : r32(e + 8);
      if (base + at + bytes > b.length || num > 100000) continue;
      const vals: number[] = [];
      let str: string | null = null;
      for (let k = 0; k < Math.min(num, 64); k++) {
        switch (type) {
          case 1:
          case 7:
            vals.push(b[base + at + k]);
            break;
          case 2:
            str = new TextDecoder().decode(b.subarray(base + at, base + at + num)).replace(/\0+$/, "").trim();
            k = num;
            break;
          case 3:
            vals.push(r16(at + k * 2));
            break;
          case 4:
            vals.push(r32(at + k * 4));
            break;
          case 9:
            vals.push(r32(at + k * 4) | 0);
            break;
          case 5:
          case 10: {
            const num1 = type === 5 ? r32(at + k * 8) : r32(at + k * 8) | 0;
            const den = type === 5 ? r32(at + k * 8 + 4) : r32(at + k * 8 + 4) | 0;
            vals.push(den === 0 ? 0 : num1 / den);
            break;
          }
        }
      }
      out.set(tag, str ?? (vals.length === 1 ? vals[0] : vals));
    }
    return out;
  };
  const ifd0 = readIfd(r32(4));
  const exifPtr = ifd0.get(0x8769);
  const gpsPtr = ifd0.get(0x8825);
  return { ifd0, exif: typeof exifPtr === "number" ? readIfd(exifPtr) : new Map(), gps: typeof gpsPtr === "number" ? readIfd(gpsPtr) : new Map() };
}

export interface Exif {
  /** Readable rows, in display order. */
  fields: { label: string; value: string }[];
  /** Decimal degrees, when the photo carries a position. */
  gps: { lat: number; lon: number; altitude?: number } | null;
  /** 1–8; 1 is upright. */
  orientation: number;
  /** Fields that identify a person, device or place. */
  privacy: string[];
}

const ORIENTATION = ["", "Upright", "Mirrored", "Rotated 180°", "Mirrored vertically", "Mirrored, rotated 90° left", "Rotated 90° right", "Mirrored, rotated 90° right", "Rotated 90° left"];

/** Finds the EXIF block of a JPEG (APP1), a PNG (eXIf chunk) or a WebP (EXIF chunk). */
export function exifBlock(b: Uint8Array): number | null {
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 10 < b.length; ) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      const len = u16be(b, i + 2);
      if (marker === 0xe1 && ascii(b, i + 4, 6) === "Exif\0\0") return i + 10;
      if (marker === 0xda) return null;
      i += 2 + len;
    }
    return null;
  }
  if (u32be(b, 0) === 0x89504e47) {
    for (let i = 8; i + 8 <= b.length; ) {
      const len = u32be(b, i);
      if (ascii(b, i + 4, 4) === "eXIf") return i + 8;
      if (ascii(b, i + 4, 4) === "IDAT") return null;
      i += 12 + len;
    }
    return null;
  }
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") {
    for (let i = 12; i + 8 <= b.length; ) {
      const len = u32le(b, i + 4);
      if (ascii(b, i, 4) === "EXIF") return ascii(b, i + 8, 6) === "Exif\0\0" ? i + 14 : i + 8;
      i += 8 + len + (len & 1);
    }
  }
  return null;
}

export function readExif(b: Uint8Array): Exif | null {
  const base = exifBlock(b);
  if (base === null || base + 8 > b.length) return null;
  if (!((b[base] === 0x49 && b[base + 1] === 0x49) || (b[base] === 0x4d && b[base + 1] === 0x4d))) return null;
  const t = readTiff(b, base);
  const fields: { label: string; value: string }[] = [];
  const privacy: string[] = [];
  const s = (m: Map<number, TagValue>, tag: number) => {
    const v = m.get(tag);
    return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
  };
  const n = (m: Map<number, TagValue>, tag: number) => {
    const v = m.get(tag);
    return typeof v === "number" ? v : Array.isArray(v) && typeof v[0] === "number" ? v[0] : null;
  };
  const push = (label: string, value: string | null | undefined, sensitive = false) => {
    if (!value) return;
    fields.push({ label, value });
    if (sensitive) privacy.push(label);
  };
  const make = s(t.ifd0, 0x010f);
  const model = s(t.ifd0, 0x0110);
  push("Camera", model.toLowerCase().startsWith(make.toLowerCase()) ? model : [make, model].filter(Boolean).join(" "), true);
  push("Lens", s(t.exif, 0xa434), false);
  const date = s(t.exif, 0x9003) || s(t.ifd0, 0x0132);
  push("Taken", date ? date.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3") + (s(t.exif, 0x9011) ? ` ${s(t.exif, 0x9011)}` : "") : "", true);
  const exposure = n(t.exif, 0x829a);
  if (exposure) push("Exposure", exposure >= 1 ? `${Number(exposure.toFixed(1))} s` : `1/${Math.round(1 / exposure)} s`);
  const f = n(t.exif, 0x829d);
  if (f) push("Aperture", `f/${Number(f.toFixed(1))}`);
  const iso = n(t.exif, 0x8827);
  if (iso) push("ISO", String(iso));
  const focal = n(t.exif, 0x920a);
  if (focal) push("Focal length", `${Number(focal.toFixed(1))} mm${n(t.exif, 0xa405) ? ` (${n(t.exif, 0xa405)} mm full-frame)` : ""}`);
  const flash = n(t.exif, 0x9209);
  if (flash !== null) push("Flash", flash & 1 ? "Fired" : "Did not fire");
  const w = n(t.exif, 0xa002);
  const h = n(t.exif, 0xa003);
  if (w && h) push("Pixel size", `${w} × ${h}`);
  push("Software", s(t.ifd0, 0x0131), true);
  push("Artist", s(t.ifd0, 0x013b), true);
  push("Copyright", s(t.ifd0, 0x8298));
  push("Description", s(t.ifd0, 0x010e));
  push("Owner", s(t.exif, 0xa430), true);
  push("Serial number", s(t.exif, 0xa431) || s(t.exif, 0xa435), true);
  const orientation = n(t.ifd0, 0x0112) ?? 1;
  if (orientation > 1) push("Orientation", ORIENTATION[orientation] ?? String(orientation));
  let gps: Exif["gps"] = null;
  const lat = t.gps.get(0x0002);
  const lon = t.gps.get(0x0004);
  if (Array.isArray(lat) && Array.isArray(lon) && lat.length === 3 && lon.length === 3) {
    const deg = (v: number[]) => v[0] + v[1] / 60 + v[2] / 3600;
    const la = deg(lat) * (s(t.gps, 0x0001).toUpperCase() === "S" ? -1 : 1);
    const lo = deg(lon) * (s(t.gps, 0x0003).toUpperCase() === "W" ? -1 : 1);
    if (Number.isFinite(la) && Number.isFinite(lo) && !(la === 0 && lo === 0)) {
      const alt = n(t.gps, 0x0006);
      gps = { lat: la, lon: lo, altitude: alt === null ? undefined : alt * (n(t.gps, 0x0005) === 1 ? -1 : 1) };
      push("Location", `${la.toFixed(6)}, ${lo.toFixed(6)}${gps.altitude !== undefined ? ` · ${Math.round(gps.altitude)} m` : ""}`, true);
    }
  }
  return { fields, gps, orientation, privacy };
}

/**
 * The JPEG with its metadata segments (EXIF, XMP, comments, Photoshop IRB)
 * removed, keeping the colour profile and the image data byte for byte.
 */
export function stripJpegMetadata(b: Uint8Array): { bytes: Uint8Array; removed: number } {
  if (b[0] !== 0xff || b[1] !== 0xd8) throw new Error("Not a JPEG file.");
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let removed = 0;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) throw new Error("The JPEG is damaged.");
    const marker = b[i + 1];
    if (marker === 0xda) break;
    const len = u16be(b, i + 2);
    const seg = b.subarray(i, i + 2 + len);
    // APP1 (EXIF / XMP), APP13 (Photoshop), COM; keep APP0 (JFIF), APP2 (ICC profile), APP14 (Adobe colour).
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe || (marker >= 0xe3 && marker <= 0xec) || marker === 0xef;
    if (drop) removed++;
    else parts.push(seg);
    i += 2 + len;
  }
  parts.push(b.subarray(i));
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return { bytes: out, removed };
}

// --- ICO -------------------------------------------------------------------

/** An .ico file holding the given PNG images (each up to 256 px square). */
export function buildIco(images: { size: number; png: Uint8Array }[]): Uint8Array {
  const header = 6 + images.length * 16;
  const total = header + images.reduce((a, i) => a + i.png.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, 0, true);
  dv.setUint16(2, 1, true);
  dv.setUint16(4, images.length, true);
  let offset = header;
  images.forEach((img, n) => {
    const e = 6 + n * 16;
    out[e] = img.size >= 256 ? 0 : img.size;
    out[e + 1] = img.size >= 256 ? 0 : img.size;
    out[e + 2] = 0;
    out[e + 3] = 0;
    dv.setUint16(e + 4, 1, true);
    dv.setUint16(e + 6, 32, true);
    dv.setUint32(e + 8, img.png.length, true);
    dv.setUint32(e + 12, offset, true);
    out.set(img.png, offset);
    offset += img.png.length;
  });
  return out;
}

export const FAVICON_SET: { name: string; size: number }[] = [
  { name: "favicon-16x16.png", size: 16 },
  { name: "favicon-32x32.png", size: 32 },
  { name: "apple-touch-icon.png", size: 180 },
  { name: "android-chrome-192x192.png", size: 192 },
  { name: "android-chrome-512x512.png", size: 512 },
];

/** The HTML and web manifest that go with the favicon set. */
export function faviconSnippet(appName: string, themeColor: string): { html: string; manifest: string } {
  const html = [
    '<link rel="icon" href="/favicon.ico" sizes="48x48">',
    '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">',
    '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
    '<link rel="manifest" href="/site.webmanifest">',
    `<meta name="theme-color" content="${themeColor}">`,
  ].join("\n");
  const manifest = JSON.stringify(
    {
      name: appName,
      short_name: appName,
      icons: [
        { src: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
        { src: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
      ],
      theme_color: themeColor,
      background_color: themeColor,
      display: "standalone",
    },
    null,
    2,
  );
  return { html, manifest };
}

/** Width and height that fit in a box, keeping the aspect ratio. */
export function fitSize(w: number, h: number, maxW: number | null, maxH: number | null): { width: number; height: number } {
  let s = 1;
  if (maxW && w > maxW) s = Math.min(s, maxW / w);
  if (maxH && h > maxH) s = Math.min(s, maxH / h);
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

export const MIME: Record<ImageFormat, string> = { png: "image/png", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", ico: "image/x-icon", svg: "image/svg+xml", avif: "image/avif", tiff: "image/tiff" };

/**
 * The main colours of an image (RGBA pixels, already downscaled), by
 * k-means with a fixed start so the result is stable. Transparent pixels
 * are ignored. Returns hex colours with their share, largest first.
 */
export function dominantColors(pixels: Uint8ClampedArray | Uint8Array, k = 6): { hex: string; share: number }[] {
  const pts: [number, number, number][] = [];
  for (let i = 0; i + 3 < pixels.length; i += 4) if (pixels[i + 3] >= 128) pts.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
  if (!pts.length) return [];
  const dist = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  // Farthest-point start: the first pixel, then each next centre is the pixel farthest from those chosen.
  const centres: number[][] = [pts[0].slice()];
  while (centres.length < k) {
    let best = -1;
    let bestD = 0;
    for (let i = 0; i < pts.length; i += Math.max(1, Math.floor(pts.length / 4000))) {
      const d = Math.min(...centres.map((c) => dist(pts[i], c)));
      if (d > bestD) (bestD = d), (best = i);
    }
    if (best < 0 || bestD < 100) break;
    centres.push(pts[best].slice());
  }
  const assign = new Array<number>(pts.length).fill(0);
  for (let iter = 0; iter < 12; iter++) {
    const sums = centres.map(() => [0, 0, 0, 0]);
    pts.forEach((p, i) => {
      let bi = 0;
      let bd = Infinity;
      centres.forEach((c, ci) => {
        const d = dist(p, c);
        if (d < bd) (bd = d), (bi = ci);
      });
      assign[i] = bi;
      sums[bi][0] += p[0];
      sums[bi][1] += p[1];
      sums[bi][2] += p[2];
      sums[bi][3]++;
    });
    centres.forEach((c, ci) => {
      if (sums[ci][3]) for (let j = 0; j < 3; j++) c[j] = sums[ci][j] / sums[ci][3];
    });
  }
  const counts = centres.map(() => 0);
  for (const a of assign) counts[a]++;
  const hex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
  return centres
    .map((c, i) => ({ hex: hex(c), share: counts[i] / pts.length }))
    .filter((c) => c.share > 0)
    .sort((a, b) => b.share - a.share);
}
