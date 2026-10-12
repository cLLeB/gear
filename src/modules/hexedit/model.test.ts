import { describe, expect, it } from "vitest";
import { applyEdit, findBytes, hex2, inspect, invert, offsetLabel, parseNeedle, parseOffset, printable, rowCount, typeNibble, type Edit } from "./model";

const bytes = (...b: number[]) => new Uint8Array(b);

describe("hex editor model", () => {
  it("formats bytes and offsets", () => {
    expect([0, 10, 255].map(hex2)).toEqual(["00", "0A", "FF"]);
    expect(offsetLabel(0x1a0, 1000)).toBe("000001A0");
    expect(offsetLabel(1, 0x1_0000_0000)).toBe("000000000001");
    expect([0x41, 0x1f, 0x7f, 0x20].map(printable)).toEqual(["A", "·", "·", " "]);
    expect([0, 15, 16, 17].map(rowCount)).toEqual([1, 1, 2, 2]);
  });

  it("applies and undoes every kind of edit", () => {
    const data = bytes(1, 2, 3, 4);
    const edits: Edit[] = [
      { kind: "set", at: 1, before: 2, after: 0xff },
      { kind: "insert", at: 2, bytes: [9, 8] },
      { kind: "delete", at: 0, bytes: [1, 2] },
      { kind: "insert", at: 4, bytes: [7] },
    ];
    expect([...applyEdit(data, edits[0])]).toEqual([1, 255, 3, 4]);
    expect([...applyEdit(data, edits[1])]).toEqual([1, 2, 9, 8, 3, 4]);
    expect([...applyEdit(data, edits[2])]).toEqual([3, 4]);
    expect([...applyEdit(data, edits[3])]).toEqual([1, 2, 3, 4, 7]);
    for (const e of edits) expect([...applyEdit(applyEdit(data, e), invert(e))]).toEqual([1, 2, 3, 4]);
    expect([...data]).toEqual([1, 2, 3, 4]);
  });

  it("types a byte one hex digit at a time", () => {
    const data = bytes(0xab);
    const first = typeNibble(data, 0, 0x1, true);
    expect(first).toEqual({ kind: "set", at: 0, before: 0xab, after: 0x1b });
    expect(typeNibble(applyEdit(data, first), 0, 0xf, false).after).toBe(0x1f);
  });

  it("reads a search needle as hex or as text", () => {
    expect(parseNeedle("48 65 6c")).toEqual({ bytes: [0x48, 0x65, 0x6c], kind: "hex" });
    expect(parseNeedle("0x48,0x65")).toEqual({ bytes: [0x48, 0x65], kind: "hex" });
    expect(parseNeedle("DEADBEEF")?.bytes).toEqual([0xde, 0xad, 0xbe, 0xef]);
    // An odd number of digits cannot be bytes.
    expect(parseNeedle("abc")).toEqual({ bytes: [0x61, 0x62, 0x63], kind: "text" });
    expect(parseNeedle('"cafe"')).toEqual({ bytes: [0x63, 0x61, 0x66, 0x65], kind: "text" });
    expect(parseNeedle("héllo")?.bytes).toEqual([0x68, 0xc3, 0xa9, 0x6c, 0x6c, 0x6f]);
    expect(parseNeedle("  ")).toBeNull();
  });

  it("finds bytes forwards and backwards, wrapping round", () => {
    const data = bytes(1, 2, 3, 1, 2, 3, 9);
    expect(findBytes(data, [1, 2], 0)).toBe(0);
    expect(findBytes(data, [1, 2], 1)).toBe(3);
    expect(findBytes(data, [1, 2], 4)).toBe(0);
    expect(findBytes(data, [1, 2], 2, true)).toBe(0);
    expect(findBytes(data, [1, 2], 0, true)).toBe(0);
    expect(findBytes(data, [3, 9], 6, true)).toBe(5);
    expect(findBytes(data, [9], 6)).toBe(6);
    expect(findBytes(data, [7], 0)).toBe(-1);
    expect(findBytes(data, [], 0)).toBe(-1);
    expect(findBytes(bytes(1), [1, 2], 0)).toBe(-1);
  });

  it("parses offsets", () => {
    expect(parseOffset("1024", 0, 5000)).toBe(1024);
    expect(parseOffset("0x400", 0, 5000)).toBe(1024);
    expect(parseOffset("400h", 0, 5000)).toBe(1024);
    expect(parseOffset("+16", 100, 5000)).toBe(116);
    expect(parseOffset("-0x10", 100, 5000)).toBe(84);
    expect(parseOffset("5000", 0, 5000)).toBeNull();
    expect(parseOffset("-1", 0, 5000)).toBeNull();
    expect(parseOffset("zz", 0, 5000)).toBeNull();
  });

  it("decodes the bytes at the cursor in either byte order", () => {
    const data = bytes(0x00, 0x00, 0x80, 0x3f, 0xff, 0xff, 0xff, 0xff, 0x41);
    const get = (at: number, le: boolean, label: string) => inspect(data, at, le).find((r) => r.label === label)?.value;
    expect(get(0, true, "float32")).toBe("1");
    expect(get(0, true, "uint32")).toBe("1065353216");
    expect(get(0, false, "uint16")).toBe("0");
    expect(get(2, false, "uint16")).toBe("32831");
    expect(get(4, true, "int32")).toBe("-1");
    expect(get(4, true, "uint8")).toBe("255");
    expect(get(4, true, "int8")).toBe("-1");
    expect(get(0, true, "uint64")).toBe("18446744070479937536");
    expect(get(8, true, "char")).toBe("A");
    expect(get(8, true, "uint16")).toBeUndefined();
    expect(inspect(data, 9, true)).toEqual([]);
    // 2024-01-01T00:00:00Z as a little-endian 32-bit timestamp.
    expect(inspect(bytes(0x80, 0x00, 0x92, 0x65), 0, true).find((r) => r.label === "unix time")?.value).toBe("2024-01-01T00:00:00.000Z");
  });
});
