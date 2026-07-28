import { describe, expect, it } from "vitest";
import { formatTable } from "./formatTable";

describe("formatTable", () => {
  it("aligns columns", () => {
    const out = formatTable([
      ["a", "111"],
      ["bbb", "2"],
    ]);
    expect(out).toBe("a    111\nbbb  2");
  });

  it("renders a header with separator", () => {
    const out = formatTable([["1", "2"]], { headers: ["x", "y"] });
    expect(out.split("\n")[1]).toBe("-  -");
  });

  it("supports right alignment", () => {
    const out = formatTable([["a", "1"], ["b", "22"]], { align: ["left", "right"] });
    expect(out).toBe("a   1\nb  22");
  });
});
