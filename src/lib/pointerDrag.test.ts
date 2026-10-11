import { describe, expect, it } from "vitest";
import { dragLabel, exceedsDragThreshold } from "./pointerDrag";

describe("pointer drag", () => {
  it("only starts a drag once the pointer has really moved", () => {
    expect(exceedsDragThreshold(0, 0)).toBe(false);
    expect(exceedsDragThreshold(3, 4)).toBe(false);
    expect(exceedsDragThreshold(-5, 0)).toBe(false);
    expect(exceedsDragThreshold(4, 4)).toBe(true);
    expect(exceedsDragThreshold(0, -6)).toBe(true);
  });

  it("labels the badge with the file name, a count, or the dragged element's text", () => {
    expect(dragLabel(["/w/src/a.ts"], "ignored")).toBe("a.ts");
    expect(dragLabel(["C:\\w\\src\\dir\\"], "")).toBe("dir");
    expect(dragLabel(["/w/a", "/w/b", "/w/c"], "")).toBe("3 items");
    expect(dragLabel([], "  my   tab \n")).toBe("my tab");
    expect(dragLabel([], "x".repeat(60))).toHaveLength(40);
  });
});
