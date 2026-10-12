import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { crc32, extract, isText, readArchive, safeTarget, totals, treeRows } from "./zip";

const enc = new TextEncoder();

/** Builds a small zip by hand, so the reader is checked against the format itself. */
function makeZip(files: { name: string; data: Uint8Array; deflate?: boolean; utf8?: boolean }[], comment = ""): Uint8Array {
  const chunks: number[] = [];
  const central: number[] = [];
  const le16 = (n: number) => [n & 255, (n >> 8) & 255];
  const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  // 2026-03-04 05:06:08
  const time = (5 << 11) | (6 << 5) | 4;
  const date = ((2026 - 1980) << 9) | (3 << 5) | 4;
  for (const f of files) {
    const name = [...enc.encode(f.name)];
    const body = f.deflate ? new Uint8Array(deflateRawSync(f.data)) : f.data;
    const head = [...le16(20), ...le16(f.utf8 ? 0x800 : 0), ...le16(f.deflate ? 8 : 0), ...le16(time), ...le16(date), ...le32(crc32(f.data)), ...le32(body.length), ...le32(f.data.length), ...le16(name.length), ...le16(0)];
    const offset = chunks.length;
    chunks.push(...le32(0x04034b50), ...head, ...name, ...body);
    central.push(...le32(0x02014b50), ...le16(20), ...head, ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(offset), ...name);
  }
  const cdOffset = chunks.length;
  const c = [...enc.encode(comment)];
  chunks.push(...central, ...le32(0x06054b50), ...le16(0), ...le16(0), ...le16(files.length), ...le16(files.length), ...le32(central.length), ...le32(cdOffset), ...le16(c.length), ...c);
  return new Uint8Array(chunks);
}

const hello = enc.encode("Hello, zip!\n");
const big = enc.encode("line of text that repeats\n".repeat(400));
const zip = makeZip(
  [
    { name: "docs/", data: new Uint8Array() },
    { name: "docs/readme.txt", data: hello },
    { name: "docs/big.txt", data: big, deflate: true },
    { name: "src/deep/a.bin", data: new Uint8Array([0, 1, 2, 255]) },
    { name: "naïve.txt", data: enc.encode("x"), utf8: true },
  ],
  "made by hand",
);

describe("zip reader", () => {
  it("computes CRC-32", () => {
    expect(crc32(enc.encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("reads the directory", () => {
    const a = readArchive(zip);
    expect(a.comment).toBe("made by hand");
    expect(a.entries.map((e) => e.name)).toEqual(["docs/", "docs/readme.txt", "docs/big.txt", "src/deep/a.bin", "naïve.txt"]);
    expect(a.entries[0].dir).toBe(true);
    expect(a.entries[1]).toMatchObject({ size: 12, compressedSize: 12, method: 0, encrypted: false, dir: false });
    expect(a.entries[2].method).toBe(8);
    expect(a.entries[2].compressedSize).toBeLessThan(a.entries[2].size / 10);
    const d = a.entries[1].modified;
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([2026, 3, 4, 5, 6, 8]);
  });

  it("extracts stored and deflated entries and checks them", async () => {
    const a = readArchive(zip);
    expect(new TextDecoder().decode(await extract(zip, a.entries[1]))).toBe("Hello, zip!\n");
    expect(await extract(zip, a.entries[2])).toEqual(big);
    expect([...(await extract(zip, a.entries[3]))]).toEqual([0, 1, 2, 255]);
    // One flipped byte in the stored data must be noticed.
    const broken = zip.slice();
    broken[a.entries[1].offset + 30 + "docs/readme.txt".length] ^= 0xff;
    await expect(extract(broken, a.entries[1])).rejects.toThrow(/checksum/);
    await expect(extract(zip, { ...a.entries[1], encrypted: true })).rejects.toThrow(/password/);
    await expect(extract(zip, { ...a.entries[1], method: 12 })).rejects.toThrow(/compression method/);
  });

  it("rejects files that are not usable zips", () => {
    expect(() => readArchive(enc.encode("just some text that is long enough to scan"))).toThrow(/not a zip/);
    expect(() => readArchive(new Uint8Array())).toThrow(/not a zip/);
    expect(() => readArchive(zip.subarray(40))).toThrow(/damaged|incomplete/);
    const z64 = zip.slice();
    const eocd = z64.length - 22 - "made by hand".length;
    z64[eocd + 10] = 0xff;
    z64[eocd + 11] = 0xff;
    expect(() => readArchive(z64)).toThrow(/Zip64/);
  });

  it("lays the entries out as a tree with folder totals", () => {
    const { entries } = readArchive(zip);
    const rows = treeRows(entries);
    expect(rows.map((r) => `${"  ".repeat(r.depth)}${r.name}${r.dir ? "/" : ""}`)).toEqual(["docs/", "  big.txt", "  readme.txt", "src/", "  deep/", "    a.bin", "naïve.txt"]);
    expect(rows[0]).toMatchObject({ size: 12 + big.length, files: 2 });
    // "src" is never listed in the archive itself, but still appears.
    expect(rows[3]).toMatchObject({ entry: null, files: 1, size: 4 });
    expect(treeRows(entries, new Set(["docs", "src"])).map((r) => r.name)).toEqual(["docs", "src", "naïve.txt"]);
    expect(treeRows(entries, new Set(["docs"]), "READ").map((r) => r.path)).toEqual(["docs", "docs/readme.txt"]);
    expect(totals(entries)).toMatchObject({ files: 4, size: 12 + big.length + 4 + 1 });
    expect(totals(entries).ratio).toBeGreaterThan(0.9);
    expect(totals([])).toEqual({ files: 0, size: 0, compressedSize: 0, ratio: 0 });
  });

  it("tells text from binary", () => {
    expect(isText(hello)).toBe(true);
    expect(isText(enc.encode("héllo ✓"))).toBe(true);
    expect(isText(new Uint8Array([0x50, 0x4b, 0, 1]))).toBe(false);
    expect(isText(new Uint8Array([0xff, 0xfe, 0xfd, 0x80, 0x81, 0x82, 0x83, 0x84]))).toBe(false);
    expect(isText(new Uint8Array())).toBe(true);
  });

  it("refuses entry names that would escape the destination", () => {
    expect(safeTarget("C:/out/", "a/b.txt")).toBe("C:/out/a/b.txt");
    expect(safeTarget("/out", "./a//b.txt")).toBe("/out/a/b.txt");
    expect(safeTarget("/out", "a\\b.txt")).toBe("/out/a/b.txt");
    expect(safeTarget("/out", "../evil.txt")).toBeNull();
    expect(safeTarget("/out", "a/../../evil.txt")).toBeNull();
    expect(safeTarget("/out", "/etc/passwd")).toBeNull();
    expect(safeTarget("/out", "C:/Windows/x.dll")).toBeNull();
    expect(safeTarget("/out", "a/b:stream")).toBeNull();
    expect(safeTarget("/out", "")).toBeNull();
  });
});
