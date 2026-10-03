import { describe, expect, it } from "vitest";
import { letters, parseSequenceSpec } from "./sequence";

const seq = (spec: string, n = 4) => {
  const f = parseSequenceSpec(spec);
  return f ? Array.from({ length: n }, (_, i) => f(i)) : null;
};

describe("parseSequenceSpec", () => {
  it.each([
    ["1", ["1", "2", "3", "4"]],
    ["", ["1", "2", "3", "4"]],
    ["0,5", ["0", "5", "10", "15"]],
    ["-2,1", ["-2", "-1", "0", "1"]],
    ["007", ["007", "008", "009", "010"]],
    ["1.5,0.25", ["1.50", "1.75", "2.00", "2.25"]],
    ["0x0e", ["0x0e", "0x0f", "0x10", "0x11"]],
    ["0xFE", ["0xFE", "0xFF", "0x100", "0x101"]],
    ["y", ["y", "z", "aa", "ab"]],
    ["B,2", ["B", "D", "F", "H"]],
  ])("%s", (spec, expected) => {
    expect(seq(spec)).toEqual(expected);
  });

  it("rejects nonsense", () => {
    expect(seq("hello1")).toBeNull();
    expect(seq("1,x")).toBeNull();
  });
});

describe("letters", () => {
  it("is bijective base-26", () => {
    expect([0, 25, 26, 51, 52, 701, 702].map((n) => letters(n, false))).toEqual(["a", "z", "aa", "az", "ba", "zz", "aaa"]);
  });
});
