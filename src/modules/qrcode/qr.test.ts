import { describe, expect, it } from "vitest";
import { addErrorCorrection, alignmentPositions, byteCapacity, dataCodewords, encodeData, encodeQr, formatBits, minVersion, rawDataModules, rsRemainder, toSvg, versionBits, type Level, type QrCode } from "./qr";

const LEVELS: Level[] = ["L", "M", "Q", "H"];

// --- An independent reader, used only to check what the encoder produced. ---

function gfMul(a: number, b: number): number {
  let r = 0;
  for (let x = a, y = b; y; y >>= 1) {
    if (y & 1) r ^= x;
    x = x & 0x80 ? ((x << 1) ^ 0x11d) & 0xff : x << 1;
  }
  return r;
}

/** Syndromes of a Reed–Solomon block: all zero when the block is consistent. */
function syndromes(block: number[], eccLen: number): number[] {
  const out: number[] = [];
  let root = 1;
  for (let i = 0; i < eccLen; i++) {
    out.push(block.reduce((acc, b) => gfMul(acc, root) ^ b, 0));
    root = gfMul(root, 2);
  }
  return out;
}

function readFormat(qr: QrCode): { level: Level; mask: number } {
  let bits = 0;
  const cells: [number, number][] = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  cells.forEach(([x, y], i) => {
    if (qr.modules[y][x]) bits |= 1 << i;
  });
  const data = (bits ^ 0x5412) >>> 10;
  return { level: (["M", "L", "H", "Q"] as Level[])[data >>> 3], mask: data & 7 };
}

const MASKS: ((x: number, y: number) => boolean)[] = [(x, y) => (x + y) % 2 === 0, (_x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0, (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0];

/** Which modules carry data, worked out from the standard's layout rules. */
function isFunction(version: number, x: number, y: number): boolean {
  const size = version * 4 + 17;
  if (x === 6 || y === 6) return true;
  if ((x < 9 && y < 9) || (x >= size - 8 && y < 9) || (x < 9 && y >= size - 8)) return true;
  if (version >= 7 && ((x >= size - 11 && y < 6) || (y >= size - 11 && x < 6))) return true;
  const align = alignmentPositions(version);
  const n = align.length;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      if (Math.abs(x - align[i]) <= 2 && Math.abs(y - align[j]) <= 2) return true;
    }
  return false;
}

function decode(qr: QrCode): { text: string; level: Level; cleanBlocks: boolean } {
  const { level, mask } = readFormat(qr);
  const size = qr.size;
  const bits: number[] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!isFunction(qr.version, x, y)) bits.push(Number(qr.modules[y][x] !== MASKS[mask](x, y)));
      }
  }
  const raw = Math.floor(rawDataModules(qr.version) / 8);
  const all: number[] = [];
  for (let i = 0; i < raw; i++) all.push(bits.slice(i * 8, i * 8 + 8).reduce((a, b) => (a << 1) | b, 0));
  const dataLen = dataCodewords(qr.version, level);
  const eccTotal = raw - dataLen;
  // The reader does not use the encoder's block table: it tries every way of
  // splitting the error-correction bytes and keeps the one whose blocks check out.
  let numBlocks = 0;
  for (let b = 1; b <= 81 && !numBlocks; b++) if (eccTotal % b === 0 && eccTotal / b >= 7 && eccTotal / b <= 30 && tryBlocks(all, raw, dataLen, b)) numBlocks = b;
  const cleanBlocks = numBlocks > 0;
  if (!cleanBlocks) return { text: "", level, cleanBlocks };
  const eccLen = eccTotal / numBlocks;
  const blocks = deinterleave(all, raw, dataLen, numBlocks);
  const data = blocks.flatMap((blk) => blk.slice(0, blk.length - eccLen));
  const dbits: number[] = [];
  for (const b of data) for (let i = 7; i >= 0; i--) dbits.push((b >>> i) & 1);
  const take = (at: number, n: number) => dbits.slice(at, at + n).reduce((a, b) => (a << 1) | b, 0);
  const lenBits = qr.version <= 9 ? 8 : 16;
  const mode = take(0, 4);
  const len = take(4, lenBits);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = take(4 + lenBits + i * 8, 8);
  return { text: mode === 4 ? new TextDecoder().decode(out) : `<mode ${mode}>`, level, cleanBlocks };
}

function deinterleave(all: number[], raw: number, dataLen: number, numBlocks: number): number[][] {
  const eccLen = (raw - dataLen) / numBlocks;
  const shortLen = Math.floor(raw / numBlocks);
  const numShort = numBlocks - (raw % numBlocks);
  const blocks: number[][] = Array.from({ length: numBlocks }, () => []);
  let k = 0;
  for (let i = 0; i < shortLen + 1; i++)
    for (let j = 0; j < numBlocks; j++) {
      // Short blocks have no byte at the last data position.
      if (i === shortLen - eccLen && j < numShort) continue;
      if (k < all.length) blocks[j].push(all[k++]);
    }
  return blocks;
}

function tryBlocks(all: number[], raw: number, dataLen: number, numBlocks: number): boolean {
  const eccLen = (raw - dataLen) / numBlocks;
  return deinterleave(all, raw, dataLen, numBlocks).every((blk) => syndromes(blk, eccLen).every((s) => s === 0));
}

describe("QR encoder", () => {
  it("matches the standard's capacity table at the ends and in the middle", () => {
    expect(LEVELS.map((l) => dataCodewords(1, l))).toEqual([19, 16, 13, 9]);
    expect(LEVELS.map((l) => dataCodewords(2, l))).toEqual([34, 28, 22, 16]);
    expect(LEVELS.map((l) => dataCodewords(7, l))).toEqual([156, 124, 88, 66]);
    expect(LEVELS.map((l) => dataCodewords(10, l))).toEqual([274, 216, 154, 122]);
    expect(LEVELS.map((l) => dataCodewords(25, l))).toEqual([1276, 1000, 718, 538]);
    expect(LEVELS.map((l) => dataCodewords(40, l))).toEqual([2956, 2334, 1666, 1276]);
    expect(LEVELS.map((l) => byteCapacity(1, l))).toEqual([17, 14, 11, 7]);
    expect(LEVELS.map((l) => byteCapacity(40, l))).toEqual([2953, 2331, 1663, 1273]);
    expect(rawDataModules(1)).toBe(208);
    expect(rawDataModules(40)).toBe(29648);
  });

  it("every version and level splits into whole blocks", () => {
    for (let v = 1; v <= 40; v++)
      for (const l of LEVELS) {
        const n = dataCodewords(v, l);
        expect(n, `v${v}-${l}`).toBeGreaterThan(0);
        expect(addErrorCorrection(new Array(n).fill(0), v, l).length, `v${v}-${l}`).toBe(Math.floor(rawDataModules(v) / 8));
      }
  });

  it("uses the standard's fixed values", () => {
    // Annex C of the standard: level M with mask 5 gives 100000011001110 before masking… and this after.
    expect(formatBits("M", 5).toString(2).padStart(15, "0")).toBe("100000011001110");
    expect(formatBits("L", 0).toString(2).padStart(15, "0")).toBe("111011111000100");
    // Annex D: version 7.
    expect(versionBits(7).toString(2).padStart(18, "0")).toBe("000111110010010100");
    expect(alignmentPositions(1)).toEqual([]);
    expect(alignmentPositions(2)).toEqual([6, 18]);
    expect(alignmentPositions(7)).toEqual([6, 22, 38]);
    expect(alignmentPositions(32)).toEqual([6, 34, 60, 86, 112, 138]);
    expect(alignmentPositions(40)).toEqual([6, 30, 58, 86, 114, 142, 170]);
  });

  it("computes the Reed–Solomon example from the standard's tutorial", () => {
    // "HELLO WORLD" at 1-M: 16 data codewords and their 10 error-correction codewords.
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    const out = addErrorCorrection(data, 1, "M");
    expect(out.slice(16)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
    expect(rsRemainder([0, 0, 0], [1, 2, 3])).toEqual([0, 0, 0]);
  });

  it("pads the data stream as the standard says", () => {
    const cw = encodeData(new TextEncoder().encode("hi"), 1, "L");
    expect(cw).toHaveLength(19);
    // 0100 | 00000010 | 'h' 'i' | 0000 terminator, then alternating pad bytes.
    expect(cw.slice(0, 4)).toEqual([0x40, 0x26, 0x86, 0x90]);
    expect(cw.slice(4, 8)).toEqual([0xec, 0x11, 0xec, 0x11]);
  });

  it("picks the smallest version that fits", () => {
    expect(minVersion(17, "L")).toBe(1);
    expect(minVersion(18, "L")).toBe(2);
    expect(minVersion(2953, "L")).toBe(40);
    expect(minVersion(2954, "L")).toBeNull();
    expect(encodeQr("x".repeat(3000), "L")).toBeNull();
    expect(encodeQr("", "H")).toMatchObject({ version: 1, size: 21 });
  });

  it("draws the fixed patterns", () => {
    const qr = encodeQr("https://example.org", "M") as QrCode;
    const row = (y: number, from: number, n: number) => qr.modules[y].slice(from, from + n).map(Number).join("");
    expect(row(0, 0, 7)).toBe("1111111");
    expect(row(1, 0, 7)).toBe("1000001");
    expect(row(2, 0, 7)).toBe("1011101");
    expect(row(3, 0, 8)).toBe("10111010");
    expect(row(6, 0, 7)).toBe("1111111");
    expect(row(0, qr.size - 7, 7)).toBe("1111111");
    expect(row(qr.size - 1, 0, 7)).toBe("1111111");
    // The timing pattern alternates and the dark module is always set.
    expect(qr.modules[6].slice(8, qr.size - 8).map(Number).join("")).toMatch(/^(10)*1$/);
    expect(qr.modules[qr.size - 8][8]).toBe(true);
  });

  it("round-trips text through an independent reader at every level and several sizes", () => {
    const samples = ["A", "https://example.org/a?b=c&d=é", "WIFI:T:WPA;S:My network;P:pa55 word;;", "日本語のテキスト 🎉", "x".repeat(120), "long ".repeat(110), "y".repeat(1200)];
    for (const text of samples)
      for (const level of LEVELS) {
        const qr = encodeQr(text, level) as QrCode;
        const read = decode(qr);
        expect(read.level, `${text.slice(0, 12)} ${level}`).toBe(level);
        expect(read.cleanBlocks, `${text.slice(0, 12)} ${level} v${qr.version}`).toBe(true);
        expect(read.text, `${text.slice(0, 12)} ${level} v${qr.version}`).toBe(text);
      }
  });

  it("round-trips with every mask", () => {
    for (let mask = 0; mask < 8; mask++) {
      const qr = encodeQr("mask test 123", "Q", mask) as QrCode;
      expect(qr.mask).toBe(mask);
      expect(decode(qr).text).toBe("mask test 123");
    }
  });

  it("writes an SVG with a quiet zone", () => {
    const qr = encodeQr("A", "L") as QrCode;
    const svg = toSvg(qr, { dark: "#123456" });
    expect(svg).toContain('viewBox="0 0 29 29"');
    expect(svg).toContain('fill="#123456"');
    expect(svg).toContain("M4,4h7v1h-7z");
    expect(toSvg(qr, { border: 0 })).toContain('viewBox="0 0 21 21"');
  });
});
