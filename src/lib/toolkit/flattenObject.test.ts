import { describe, expect, it } from "vitest";
import { flattenObject, unflattenObject } from "./flattenObject";

describe("flattenObject", () => {
  it("flattens nested keys", () => {
    expect(flattenObject({ a: { b: { c: 1 } }, d: 2 })).toEqual({
      "a.b.c": 1,
      d: 2,
    });
  });

  it("indexes arrays", () => {
    expect(flattenObject({ list: [10, 20] })).toEqual({
      "list.0": 10,
      "list.1": 20,
    });
  });

  it("round-trips", () => {
    const nested = { a: { b: 1 }, c: 2 };
    expect(unflattenObject(flattenObject(nested))).toEqual(nested);
  });
});
