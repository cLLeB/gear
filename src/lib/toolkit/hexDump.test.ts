import { describe, expect, it } from "vitest";
import { hexDump } from "./hexDump";

describe("hexDump", () => {
  it("dumps ascii with offset and gutter", () => {
    const out = hexDump("ABC");
    expect(out).toContain("41 42 43");
    expect(out).toContain("ABC");
    expect(out.startsWith("00000000")).toBe(true);
  });

  it("wraps at the given width", () => {
    const out = hexDump("abcdef", { width: 2 });
    expect(out.split("\n")).toHaveLength(3);
  });

  it("renders non-printables as dots", () => {
    const out = hexDump(new Uint8Array([0, 65, 10]), { showOffset: false });
    expect(out).toContain(".A.");
  });
});
