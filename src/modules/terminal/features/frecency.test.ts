import { describe, expect, it } from "vitest";
import { frecencyScore, matchesKeywords, MAX_TOTAL_RANK, rankDirs, recordVisit } from "./frecency";

const NOW = 1_000_000_000_000;

describe("recordVisit", () => {
  it("adds new directories and bumps existing ones", () => {
    let db = recordVisit([], "/repo/", NOW);
    db = recordVisit(db, "/repo", NOW + 5);
    expect(db).toEqual([{ path: "/repo", rank: 2, last: NOW + 5 }]);
  });

  it("ages the database past the rank budget", () => {
    const db = [
      { path: "/a", rank: MAX_TOTAL_RANK, last: NOW },
      { path: "/b", rank: 1, last: NOW },
    ];
    const next = recordVisit(db, "/a", NOW);
    expect(next.map((e) => e.path)).toEqual(["/a"]);
    expect(next[0].rank).toBeCloseTo((MAX_TOTAL_RANK + 1) * 0.9);
  });
});

describe("rankDirs", () => {
  it("weights recency over raw visit counts", () => {
    const db = [
      { path: "/old/popular", rank: 10, last: NOW - 30 * 86_400_000 },
      { path: "/fresh", rank: 2, last: NOW - 60_000 },
    ];
    expect(frecencyScore(db[0], NOW)).toBe(2.5);
    expect(frecencyScore(db[1], NOW)).toBe(8);
    expect(rankDirs(db, NOW).map((e) => e.path)).toEqual(["/fresh", "/old/popular"]);
  });

  it("filters by keywords", () => {
    const db = [
      { path: "/home/me/src/gear", rank: 1, last: NOW },
      { path: "/home/me/gear/docs", rank: 1, last: NOW },
    ];
    expect(rankDirs(db, NOW, ["gear"]).map((e) => e.path)).toEqual(["/home/me/src/gear"]);
  });
});

describe("matchesKeywords", () => {
  it("requires order and a final-component match for the last keyword", () => {
    expect(matchesKeywords("/home/me/src/gear", ["src", "ge"])).toBe(true);
    expect(matchesKeywords("/home/me/src/gear", ["gear", "src"])).toBe(false);
    expect(matchesKeywords("/home/me/gear/docs", ["gear"])).toBe(false);
    expect(matchesKeywords("C:\\Users\\me\\proj", ["proj"])).toBe(true);
  });
});
