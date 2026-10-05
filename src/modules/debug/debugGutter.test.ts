import { describe, expect, it } from "vitest";
import { inlineHints } from "./debugGutter";

describe("inline values", () => {
  it("annotates lines that use locals, up to the paused line", () => {
    const src = ["def area(w, h):", "    # w is width", "    result = w * h", "    return result"];
    const hints = inlineHints((n) => src[n - 1], 3, new Map([["w", "3"], ["h", "4"], ["result", "12"]]));
    expect([...hints]).toEqual([
      [1, "w = 3, h = 4"],
      [3, "result = 12, w = 3, h = 4"],
    ]);
  });
});
