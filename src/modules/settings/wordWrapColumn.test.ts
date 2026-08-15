import { describe, expect, it } from "vitest";
import {
  clampWordWrapColumn,
  WORD_WRAP_COLUMN_DEFAULT,
  WORD_WRAP_COLUMN_MAX,
  WORD_WRAP_COLUMN_MIN,
} from "./store";

describe("clampWordWrapColumn", () => {
  it("rounds and clamps valid values", () => {
    expect(clampWordWrapColumn(79.6)).toBe(80);
    expect(clampWordWrapColumn(WORD_WRAP_COLUMN_MIN - 1)).toBe(
      WORD_WRAP_COLUMN_MIN,
    );
    expect(clampWordWrapColumn(WORD_WRAP_COLUMN_MAX + 1)).toBe(
      WORD_WRAP_COLUMN_MAX,
    );
  });

  it("falls back for non-finite values", () => {
    expect(clampWordWrapColumn(Number.NaN)).toBe(WORD_WRAP_COLUMN_DEFAULT);
    expect(clampWordWrapColumn(Number.POSITIVE_INFINITY)).toBe(
      WORD_WRAP_COLUMN_DEFAULT,
    );
    expect(clampWordWrapColumn(Number.NEGATIVE_INFINITY)).toBe(
      WORD_WRAP_COLUMN_DEFAULT,
    );
  });
});
