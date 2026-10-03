import { describe, expect, it } from "vitest";
import { convertTimestamp, epochToDate, nanoid, ulid, ulidTime, uuidV4, uuidV7 } from "./ids";

const zeros = (b: Uint8Array) => b.fill(0);
const ones = (b: Uint8Array) => b.fill(255);

describe("uuid", () => {
  it("sets version and variant bits", () => {
    expect(uuidV4(zeros)).toBe("00000000-0000-4000-8000-000000000000");
    expect(uuidV4(ones)).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
    expect(uuidV4()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("v7 embeds the timestamp and sorts by time", () => {
    const id = uuidV7(0x0123456789ab, zeros);
    expect(id).toBe("01234567-89ab-7000-8000-000000000000");
    expect(uuidV7(1000) < uuidV7(2000)).toBe(true);
  });
});

describe("ulid", () => {
  it("encodes time and decodes it back", () => {
    const id = ulid(1_469_918_176_385, zeros);
    expect(id).toBe("01ARYZ6S410000000000000000");
    expect(ulidTime(id)).toBe(1_469_918_176_385);
    expect(ulidTime("not-a-ulid")).toBeNull();
  });
});

describe("nanoid", () => {
  it("has the requested length and URL-safe alphabet", () => {
    expect(nanoid(10)).toMatch(/^[A-Za-z0-9_-]{10}$/);
  });
});

describe("timestamps", () => {
  it("detects epoch units by magnitude", () => {
    expect(epochToDate("1700000000")?.unit).toBe("s");
    expect(epochToDate("1700000000000")?.unit).toBe("ms");
    expect(epochToDate("1700000000000000")?.unit).toBe("us");
    expect(epochToDate("abc")).toBeNull();
  });

  it("toggles epoch ⇄ ISO", () => {
    expect(convertTimestamp("1700000000")).toBe("2023-11-14T22:13:20.000Z");
    expect(convertTimestamp("2023-11-14T22:13:20Z")).toBe("1700000000");
    expect(convertTimestamp("2023-11-14T22:13:20.123Z")).toBe("1700000000123");
    expect(convertTimestamp("hello")).toBeNull();
  });
});
