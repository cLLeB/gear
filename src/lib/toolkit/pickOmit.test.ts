import { describe, expect, it } from "vitest";
import { omit, pick } from "./pickOmit";

describe("pickOmit", () => {
  const obj = { a: 1, b: 2, c: 3 };

  it("picks keys", () => {
    expect(pick(obj, ["a", "c"])).toEqual({ a: 1, c: 3 });
  });

  it("ignores missing keys", () => {
    expect(pick(obj, ["a", "z" as keyof typeof obj])).toEqual({ a: 1 });
  });

  it("omits keys", () => {
    expect(omit(obj, ["b"])).toEqual({ a: 1, c: 3 });
  });

  it("does not mutate the source", () => {
    omit(obj, ["a"]);
    expect(obj).toEqual({ a: 1, b: 2, c: 3 });
  });
});
