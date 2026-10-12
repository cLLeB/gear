import { describe, expect, it } from "vitest";
import { inkRuns, lineAtY, minimapLayout, ratioForSliderTop } from "./minimap";

describe("inkRuns", () => {
  it("returns column runs of non-blank text", () => {
    expect(inkRuns("  const x = 1;", 4)).toEqual([2, 7, 8, 9, 10, 11, 12, 14]);
    expect(inkRuns("", 4)).toEqual([]);
    expect(inkRuns("   \t ", 4)).toEqual([]);
  });

  it("expands tabs to the next tab stop", () => {
    expect(inkRuns("\tif", 4)).toEqual([4, 6]);
    expect(inkRuns("a\tb", 4)).toEqual([0, 1, 4, 5]);
    expect(inkRuns("\t\tx", 2)).toEqual([4, 5]);
  });

  it("stops at the column limit", () => {
    expect(inkRuns("x".repeat(500), 4, 120)).toEqual([0, 120]);
    expect(inkRuns(`${" ".repeat(130)}late`, 4, 120)).toEqual([]);
  });
});

describe("minimapLayout", () => {
  it("draws a short file from the top with the slider over the visible lines", () => {
    const l = minimapLayout(50, 600, 11, 30, 0.4);
    expect(l).toEqual({ start: 1, rows: 50, sliderTop: 30, sliderHeight: 60, inkHeight: 150 });
  });

  it("scrolls a long file through the strip in step with the editor", () => {
    // 600px / 3px = 200 rows for a 1000-line file.
    expect(minimapLayout(1000, 600, 1, 40, 0).start).toBe(1);
    expect(minimapLayout(1000, 600, 481, 520, 0.5).start).toBe(401);
    const end = minimapLayout(1000, 600, 961, 1000, 1);
    expect(end.start).toBe(801);
    expect(end.sliderTop + end.sliderHeight).toBe(end.inkHeight);
  });

  it("keeps the slider inside the strip and grabbable", () => {
    const tiny = minimapLayout(1000, 600, 500, 500, 0.5);
    expect(tiny.sliderHeight).toBe(12);
    const all = minimapLayout(10, 600, 1, 10, 0);
    expect(all).toMatchObject({ sliderTop: 0, sliderHeight: 30, inkHeight: 30 });
    expect(minimapLayout(1000, 600, 1, 40, -3).start).toBe(1);
    expect(minimapLayout(1000, 600, 1, 40, 9).start).toBe(801);
  });
});

describe("pointer mapping", () => {
  it("maps a y offset to a document line, clamped to the drawn rows", () => {
    const l = minimapLayout(1000, 600, 481, 520, 0.5);
    expect(lineAtY(0, l)).toBe(401);
    expect(lineAtY(7, l)).toBe(403);
    expect(lineAtY(5000, l)).toBe(600);
    expect(lineAtY(-20, l)).toBe(401);
  });

  it("turns a slider position back into a scroll ratio", () => {
    const l = minimapLayout(1000, 600, 1, 40, 0);
    expect(ratioForSliderTop(0, l)).toBe(0);
    expect(ratioForSliderTop(l.inkHeight - l.sliderHeight, l)).toBe(1);
    expect(ratioForSliderTop(240, l)).toBe(0.5);
    expect(ratioForSliderTop(-50, l)).toBe(0);
    expect(ratioForSliderTop(9999, l)).toBe(1);
    // Everything visible: nowhere to travel.
    expect(ratioForSliderTop(10, minimapLayout(10, 600, 1, 10, 0))).toBe(0);
  });
});
