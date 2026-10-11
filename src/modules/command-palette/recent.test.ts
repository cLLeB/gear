import { describe, expect, it } from "vitest";
import { recencyBonus, recordRecent } from "./recent";

describe("recordRecent", () => {
  it("moves an id to the front without duplicating it", () => {
    expect(recordRecent(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
  });

  it("caps the list length", () => {
    expect(recordRecent(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
  });
});

describe("recencyBonus", () => {
  it("is largest for the most recent id and zero for unknown ids", () => {
    const list = ["x", "y", "z"];
    expect(recencyBonus(list, "x")).toBeGreaterThan(recencyBonus(list, "y"));
    expect(recencyBonus(list, "z")).toBeGreaterThan(0);
    expect(recencyBonus(list, "nope")).toBe(0);
  });
});
