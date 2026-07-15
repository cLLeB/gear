import { describe, expect, it } from "vitest";
import { randomId, uuidv4 } from "./randomId";

describe("randomId", () => {
  it("has the requested length", () => {
    expect(randomId(20)).toHaveLength(20);
  });

  it("uses only alphanumeric chars", () => {
    expect(randomId(50)).toMatch(/^[0-9A-Za-z]+$/);
  });

  it("is very likely unique", () => {
    const set = new Set(Array.from({ length: 100 }, () => randomId(16)));
    expect(set.size).toBe(100);
  });
});

describe("uuidv4", () => {
  it("matches the v4 shape", () => {
    expect(uuidv4()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
