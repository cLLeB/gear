import { describe, expect, it } from "vitest";
import { highlightRuns, rankPicks, type QuickPickItem } from "./rank";

const items: QuickPickItem<string>[] = [
  { label: "Git: Push", value: "push", keywords: ["upload"] },
  { label: "Git: Pull", value: "pull" },
  { label: "Checkout branch", value: "co", description: "switch git branch" },
  { label: "Toggle sidebar", value: "side" },
];

describe("rankPicks", () => {
  it("returns everything in order for an empty query", () => {
    expect(rankPicks("", items).map((r) => r.item.value)).toEqual([
      "push",
      "pull",
      "co",
      "side",
    ]);
  });

  it("ranks label matches above description/keyword matches", () => {
    const ranked = rankPicks("branch", items).map((r) => r.item.value);
    expect(ranked[0]).toBe("co");
    const viaKeyword = rankPicks("upload", items).map((r) => r.item.value);
    expect(viaKeyword).toEqual(["push"]);
  });

  it("requires every space-separated term to match", () => {
    const ranked = rankPicks("git pus", items).map((r) => r.item.value);
    expect(ranked).toEqual(["push"]);
  });

  it("reports label positions for highlighting", () => {
    const [top] = rankPicks("tsb", items);
    expect(top.item.value).toBe("side");
    expect(top.labelPositions.length).toBe(3);
  });

  it("drops non-matching items", () => {
    expect(rankPicks("zzz", items)).toEqual([]);
  });
});

describe("highlightRuns", () => {
  it("groups adjacent matched characters", () => {
    expect(highlightRuns("hello", [0, 1, 4])).toEqual([
      { text: "he", match: true },
      { text: "ll", match: false },
      { text: "o", match: true },
    ]);
  });

  it("returns one unmatched run with no positions", () => {
    expect(highlightRuns("abc", [])).toEqual([{ text: "abc", match: false }]);
  });
});
