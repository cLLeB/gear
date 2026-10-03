import { describe, expect, it } from "vitest";
import { incrementAt } from "./increment";

const bump = (line: string, offset: number, delta = 1) => {
  const r = incrementAt(line, offset, delta);
  return r ? line.slice(0, r.from) + r.text + line.slice(r.to) : null;
};

describe("incrementAt", () => {
  it("increments the integer under or after the cursor", () => {
    expect(bump("width: 41px", 8)).toBe("width: 42px");
    expect(bump("width: 41px", 0)).toBe("width: 42px");
    expect(bump("x = 9", 4, -10)).toBe("x = -1");
  });

  it("keeps zero padding and float precision", () => {
    expect(bump("frame_007.png", 7)).toBe("frame_008.png");
    expect(bump("opacity 0.95", 9)).toBe("opacity 0.96");
    expect(bump("v -0.01", 3, 2)).toBe("v 0.01");
  });

  it("handles hex with case and width, and binary", () => {
    expect(bump("color 0xFF", 7)).toBe("color 0x00");
    expect(bump("mask 0x0f", 6)).toBe("mask 0x10");
    expect(bump("bits 0b0111", 6)).toBe("bits 0b1000");
  });

  it("steps ISO dates by day across month ends", () => {
    expect(bump("due 2026-01-31", 5)).toBe("due 2026-02-01");
    expect(bump("due 2024-03-01", 5, -1)).toBe("due 2024-02-29");
  });

  it("treats a minus after an operand as subtraction", () => {
    expect(bump("i-1", 2)).toBe("i-2");
  });

  it("handles big integers exactly", () => {
    expect(bump("id 9007199254740993", 4)).toBe("id 9007199254740994");
  });

  it("returns null when there is nothing to the right", () => {
    expect(bump("abc 1 def", 6)).toBeNull();
  });
});
