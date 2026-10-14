import { describe, expect, it } from "vitest";
import { buildIco, exifBlock, faviconSnippet, fitSize, imageInfo, readExif, stripJpegMetadata } from "./model";

const bytes = (...parts: (number[] | Uint8Array | string)[]) => {
  const arr: number[] = [];
  for (const p of parts) {
    if (typeof p === "string") for (const ch of p) arr.push(ch.charCodeAt(0));
    else arr.push(...p);
  }
  return new Uint8Array(arr);
};
const be16 = (n: number) => [(n >> 8) & 255, n & 255];
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >> 8) & 255];
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];

type Entry = { tag: number; type: 2 | 3 | 4 | 5; value: string | number | number[] };

/** A little-endian TIFF with IFD0, an EXIF IFD and a GPS IFD. */
function tiff(ifd0: Entry[], exif: Entry[], gps: Entry[]): Uint8Array {
  const out: number[] = [...bytes("II"), ...le16(42), ...le32(8)];
  const ifds: Entry[][] = [ifd0, exif, gps];
  // Lay out: IFD0, EXIF IFD, GPS IFD, then the data area.
  const ifdSize = (e: Entry[]) => 2 + e.length * 12 + 4;
  const offsets = [8, 8 + ifdSize(ifd0 as Entry[]) + 24, 0];
  offsets[2] = offsets[1] + ifdSize(exif);
  // Pointers in IFD0 (they are part of ifd0 entries, patched here).
  ifd0.push({ tag: 0x8769, type: 4, value: offsets[1] }, { tag: 0x8825, type: 4, value: offsets[2] });
  offsets[1] = 8 + ifdSize(ifd0);
  offsets[2] = offsets[1] + ifdSize(exif);
  ifd0[ifd0.length - 2].value = offsets[1];
  ifd0[ifd0.length - 1].value = offsets[2];
  let data = offsets[2] + ifdSize(gps);
  const dataArea: number[] = [];
  for (const entries of ifds) {
    out.push(...le16(entries.length));
    for (const e of entries) {
      out.push(...le16(e.tag), ...le16(e.type));
      if (e.type === 2) {
        const s = [...bytes(String(e.value)), 0];
        out.push(...le32(s.length));
        if (s.length <= 4) out.push(...s, ...Array(4 - s.length).fill(0));
        else (out.push(...le32(data)), dataArea.push(...s), (data += s.length));
      } else if (e.type === 3) out.push(...le32(1), ...le16(e.value as number), 0, 0);
      else if (e.type === 4) out.push(...le32(1), ...le32(e.value as number));
      else {
        const vals = Array.isArray(e.value) ? e.value : [e.value as number];
        out.push(...le32(vals.length), ...le32(data));
        for (const v of vals) {
          const den = Number.isInteger(v) ? 1 : 1000000;
          dataArea.push(...le32(Math.round(v * den)), ...le32(den));
          data += 8;
        }
      }
    }
    out.push(...le32(0));
  }
  return new Uint8Array([...out, ...dataArea]);
}

const exifTiff = tiff(
  [
    { tag: 0x010f, type: 2, value: "Canon" },
    { tag: 0x0110, type: 2, value: "Canon EOS R6" },
    { tag: 0x0112, type: 3, value: 6 },
    { tag: 0x0131, type: 2, value: "Photo editor 2.1" },
  ],
  [
    { tag: 0x829a, type: 5, value: 0.004 },
    { tag: 0x829d, type: 5, value: 2.8 },
    { tag: 0x8827, type: 3, value: 400 },
    { tag: 0x9003, type: 2, value: "2026:03:04 05:06:07" },
    { tag: 0x920a, type: 5, value: 50 },
    { tag: 0xa434, type: 2, value: "RF50mm F1.8 STM" },
  ],
  [
    { tag: 0x0001, type: 2, value: "N" },
    { tag: 0x0002, type: 5, value: [51, 30, 0] },
    { tag: 0x0003, type: 2, value: "W" },
    { tag: 0x0004, type: 5, value: [0, 7, 30] },
  ],
);

const app1 = bytes([0xff, 0xe1], be16(2 + 6 + exifTiff.length), "Exif\0\0", exifTiff);
const com = bytes([0xff, 0xfe], be16(2 + 5), "hello");
const app2 = bytes([0xff, 0xe2], be16(2 + 4), "ICC!");
const sof = bytes([0xff, 0xc2], be16(17), [8], be16(600), be16(800), [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
const sos = bytes([0xff, 0xda], be16(8), [1, 1, 0, 0, 63, 0], [1, 2, 3, 4], [0xff, 0xd9]);
const jpeg = bytes([0xff, 0xd8], app1, com, app2, sof, sos);

describe("image tools", () => {
  it("reads JPEG size and EXIF", () => {
    expect(imageInfo(jpeg)).toEqual({ format: "jpeg", width: 800, height: 600, progressive: true, bitDepth: 8 });
    expect(exifBlock(jpeg)).toBe(2 + 10);
    const e = readExif(jpeg);
    expect(e).not.toBeNull();
    const f = Object.fromEntries((e?.fields ?? []).map((x) => [x.label, x.value]));
    expect(f).toMatchObject({
      Camera: "Canon EOS R6",
      Lens: "RF50mm F1.8 STM",
      Taken: "2026-03-04 05:06:07",
      Exposure: "1/250 s",
      Aperture: "f/2.8",
      ISO: "400",
      "Focal length": "50 mm",
      Software: "Photo editor 2.1",
      Orientation: "Rotated 90° right",
    });
    expect(e?.orientation).toBe(6);
    expect(e?.gps?.lat).toBeCloseTo(51.5, 6);
    expect(e?.gps?.lon).toBeCloseTo(-0.125, 6);
    expect(e?.privacy).toEqual(expect.arrayContaining(["Camera", "Taken", "Location", "Software"]));
    expect(readExif(bytes([0xff, 0xd8], sof, sos))).toBeNull();
  });

  it("strips JPEG metadata but keeps the colour profile and image data", () => {
    const { bytes: out, removed } = stripJpegMetadata(jpeg);
    expect(removed).toBe(2);
    expect(readExif(out)).toBeNull();
    expect(out.length).toBe(jpeg.length - app1.length - com.length);
    expect([...out.subarray(2, 2 + app2.length)]).toEqual([...app2]);
    expect([...out.subarray(-sos.length)]).toEqual([...sos]);
    expect(imageInfo(out)).toMatchObject({ width: 800, height: 600 });
    expect(() => stripJpegMetadata(bytes("GIF89a"))).toThrow(/Not a JPEG/);
  });

  it("reads PNG, GIF, WebP, BMP, ICO and SVG headers", () => {
    const png = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], be32(13), "IHDR", be32(1920), be32(1080), [8, 6, 0, 0, 0], [0, 0, 0, 0], be32(8), "acTL", [0, 0, 0, 2, 0, 0, 0, 0], [0, 0, 0, 0], be32(0), "IDAT", [0, 0, 0, 0]);
    expect(imageInfo(png)).toEqual({ format: "png", width: 1920, height: 1080, alpha: true, animated: true, bitDepth: 8 });
    const gif = bytes("GIF89a", le16(320), le16(200), [0], [0x00, 0x21, 0xf9, 4], [0x00, 0x21, 0xf9, 4]);
    expect(imageInfo(gif)).toEqual({ format: "gif", width: 320, height: 200, animated: true });
    const webpX = bytes("RIFF", le32(30), "WEBP", "VP8X", le32(10), [0x12, 0, 0, 0], [0x7f, 0x02, 0x00], [0xdf, 0x01, 0x00]);
    expect(imageInfo(webpX)).toEqual({ format: "webp", width: 640, height: 480, animated: true, alpha: true });
    const bits = (99) | (49 << 14) | (1 << 28);
    const webpL = bytes("RIFF", le32(30), "WEBP", "VP8L", le32(10), [0x2f], le32(bits), [0, 0, 0, 0, 0]);
    expect(imageInfo(webpL)).toEqual({ format: "webp", width: 100, height: 50, alpha: true });
    const bmp = bytes("BM", Array(16).fill(0), le32(64), le32(-32 >>> 0), le16(1), le16(24));
    expect(imageInfo(bmp)).toEqual({ format: "bmp", width: 64, height: 32, bitDepth: 24 });
    const ico = buildIco([
      { size: 16, png: new Uint8Array(10) },
      { size: 256, png: new Uint8Array(20) },
    ]);
    expect(imageInfo(ico)).toEqual({ format: "ico", width: 256, height: 256 });
    expect(imageInfo(bytes('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 16">'))).toEqual({ format: "svg", width: 24, height: 16 });
    expect(imageInfo(bytes('<svg width="100px" height="50" viewBox="0 0 24 16">'))).toEqual({ format: "svg", width: 100, height: 50 });
    expect(imageInfo(bytes("plain text"))).toBeNull();
  });

  it("builds an .ico from PNGs", () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([4, 5]);
    const ico = buildIco([
      { size: 16, png: a },
      { size: 256, png: b },
    ]);
    const dv = new DataView(ico.buffer);
    expect([dv.getUint16(0, true), dv.getUint16(2, true), dv.getUint16(4, true)]).toEqual([0, 1, 2]);
    expect([ico[6], ico[7], ico[22], ico[23]]).toEqual([16, 16, 0, 0]);
    expect(dv.getUint32(6 + 8, true)).toBe(3);
    expect(dv.getUint32(6 + 12, true)).toBe(38);
    expect(dv.getUint32(22 + 12, true)).toBe(41);
    expect([...ico.subarray(38)]).toEqual([1, 2, 3, 4, 5]);
  });

  it("fits sizes and writes the favicon snippet", () => {
    expect(fitSize(4000, 3000, 1200, null)).toEqual({ width: 1200, height: 900 });
    expect(fitSize(4000, 3000, 1200, 600)).toEqual({ width: 800, height: 600 });
    expect(fitSize(100, 50, 1200, 600)).toEqual({ width: 100, height: 50 });
    const { html, manifest } = faviconSnippet("My App", "#112233");
    expect(html).toContain('href="/favicon.ico"');
    expect(html).toContain('content="#112233"');
    expect(JSON.parse(manifest)).toMatchObject({ name: "My App", icons: [{ sizes: "192x192" }, { sizes: "512x512" }] });
  });
});

describe("dominant colours", () => {
  it("finds the main colours and their share", async () => {
    const { dominantColors } = await import("./model");
    const px: number[] = [];
    for (let i = 0; i < 300; i++) px.push(250, 10, 10, 255);
    for (let i = 0; i < 100; i++) px.push(10, 10, 240, 255);
    for (let i = 0; i < 50; i++) px.push(0, 0, 0, 0);
    const out = dominantColors(new Uint8Array(px), 4);
    expect(out.map((c) => c.hex)).toEqual(["#fa0a0a", "#0a0af0"]);
    expect(out[0].share).toBeCloseTo(0.75, 5);
    expect(dominantColors(new Uint8Array([0, 0, 0, 0]))).toEqual([]);
  });
});
