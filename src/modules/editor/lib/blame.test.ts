import { describe, expect, it } from "vitest";
import {
  blameHue,
  blameLabel,
  blameTooltip,
  commitForLine,
  formatBlameAge,
  shortAuthor,
  type BlameCommit,
  type BlameResult,
} from "./blame";

const NOW = 1_800_000_000;

function commit(over: Partial<BlameCommit> = {}): BlameCommit {
  return {
    sha: "1111111111111111111111111111111111111111",
    author: "Ada Lovelace",
    authorTime: NOW - 3600,
    summary: "add the thing",
    uncommitted: false,
    ...over,
  };
}

describe("formatBlameAge", () => {
  it("collapses anything under a minute", () => {
    expect(formatBlameAge(NOW, NOW)).toBe("now");
    expect(formatBlameAge(NOW - 59, NOW)).toBe("now");
  });

  it("steps through minutes, hours, days, months and years", () => {
    expect(formatBlameAge(NOW - 60, NOW)).toBe("1m");
    expect(formatBlameAge(NOW - 3600, NOW)).toBe("1h");
    expect(formatBlameAge(NOW - 86_400 * 3, NOW)).toBe("3d");
    expect(formatBlameAge(NOW - 86_400 * 45, NOW)).toBe("1mo");
    expect(formatBlameAge(NOW - 86_400 * 400, NOW)).toBe("1y");
  });

  it("never renders a negative age for clock skew", () => {
    expect(formatBlameAge(NOW + 10_000, NOW)).toBe("now");
  });
});

describe("shortAuthor", () => {
  it("uses the first name when it fits", () => {
    expect(shortAuthor("Ada Lovelace")).toBe("Ada");
  });

  it("falls back to initials for a long first name", () => {
    expect(shortAuthor("Bartholomew Cubbins")).toBe("BC");
  });

  it("handles an empty author", () => {
    expect(shortAuthor("   ")).toBe("?");
  });

  it("truncates a single long name with no surname", () => {
    expect(shortAuthor("Bartholomewwww")).toBe("B");
  });
});

describe("blameLabel", () => {
  it("is blank without a commit", () => {
    expect(blameLabel(null, NOW)).toBe("");
  });

  it("marks working-tree lines", () => {
    expect(blameLabel(commit({ uncommitted: true }), NOW)).toBe("uncommitted");
  });

  it("pairs a short author with an age", () => {
    expect(blameLabel(commit(), NOW)).toBe("Ada 1h");
  });
});

describe("blameTooltip", () => {
  it("is blank without a commit", () => {
    expect(blameTooltip(null)).toBe("");
  });

  it("explains an uncommitted line", () => {
    expect(blameTooltip(commit({ uncommitted: true }))).toBe("Not committed yet");
  });

  it("carries the abbreviated sha and the summary", () => {
    const text = blameTooltip(commit());
    expect(text).toContain("11111111");
    expect(text).toContain("Ada Lovelace");
    expect(text).toContain("add the thing");
  });
});

describe("commitForLine", () => {
  const blame: BlameResult = {
    commits: [commit({ sha: "a".repeat(40) }), commit({ sha: "b".repeat(40) })],
    lines: [0, 0, 1],
  };

  it("resolves a 1-based line", () => {
    expect(commitForLine(blame, 1)?.sha).toBe("a".repeat(40));
    expect(commitForLine(blame, 3)?.sha).toBe("b".repeat(40));
  });

  it("returns null outside the blamed range", () => {
    expect(commitForLine(blame, 0)).toBeNull();
    expect(commitForLine(blame, 4)).toBeNull();
    expect(commitForLine(null, 1)).toBeNull();
  });

  it("returns null when the index points past the commit table", () => {
    expect(commitForLine({ commits: [], lines: [0] }, 1)).toBeNull();
  });
});

describe("blameHue", () => {
  it("is stable for the same sha", () => {
    expect(blameHue("abc")).toBe(blameHue("abc"));
  });

  it("stays inside the hue circle", () => {
    for (const sha of ["a".repeat(40), "0", "deadbeef", ""]) {
      const hue = blameHue(sha);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });
});
