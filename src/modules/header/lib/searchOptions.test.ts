import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEARCH_FLAGS,
  formatSearchResults,
  isSearchQueryValid,
  SEARCH_FLAG_META,
  toggleSearchFlag,
} from "./searchOptions";

describe("toggleSearchFlag", () => {
  it("returns a new object rather than mutating", () => {
    const next = toggleSearchFlag(DEFAULT_SEARCH_FLAGS, "regex");
    expect(next.regex).toBe(true);
    expect(DEFAULT_SEARCH_FLAGS.regex).toBe(false);
    expect(next).not.toBe(DEFAULT_SEARCH_FLAGS);
  });

  it("leaves the other flags untouched", () => {
    const next = toggleSearchFlag(
      { caseSensitive: true, wholeWord: false, regex: false },
      "wholeWord",
    );
    expect(next).toEqual({
      caseSensitive: true,
      wholeWord: true,
      regex: false,
    });
  });

  it("covers every flag in the UI metadata", () => {
    for (const meta of SEARCH_FLAG_META) {
      expect(DEFAULT_SEARCH_FLAGS[meta.key]).toBe(false);
    }
    expect(SEARCH_FLAG_META).toHaveLength(
      Object.keys(DEFAULT_SEARCH_FLAGS).length,
    );
  });
});

describe("isSearchQueryValid", () => {
  it("accepts anything in literal mode", () => {
    expect(isSearchQueryValid("foo(", DEFAULT_SEARCH_FLAGS)).toBe(true);
  });

  it("rejects a half-typed regex", () => {
    expect(isSearchQueryValid("foo(", { ...DEFAULT_SEARCH_FLAGS, regex: true })).toBe(
      false,
    );
  });

  it("accepts a well-formed regex", () => {
    expect(
      isSearchQueryValid("^err(or)?$", { ...DEFAULT_SEARCH_FLAGS, regex: true }),
    ).toBe(true);
  });
});

describe("formatSearchResults", () => {
  const ok = { query: "x", valid: true };

  it("shows nothing for an empty query", () => {
    expect(formatSearchResults({ index: 0, count: 3 }, { query: "", valid: true })).toBe(
      "",
    );
  });

  it("calls out an invalid pattern", () => {
    expect(formatSearchResults(null, { query: "x(", valid: false })).toBe(
      "Bad pattern",
    );
  });

  it("reports an empty result set", () => {
    expect(formatSearchResults({ index: -1, count: 0 }, ok)).toBe("No results");
    expect(formatSearchResults(null, ok)).toBe("No results");
  });

  it("renders a 1-based ordinal", () => {
    expect(formatSearchResults({ index: 0, count: 17 }, ok)).toBe("1/17");
    expect(formatSearchResults({ index: 16, count: 17 }, ok)).toBe("17/17");
  });

  it("drops the ordinal when the engine could not track it", () => {
    expect(formatSearchResults({ index: -1, count: 4000 }, ok)).toBe("4000");
  });
});
