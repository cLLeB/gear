import { describe, expect, it } from "vitest";
import { chunk, groupBy, partition, uniqueBy } from "./collections";

describe("collections", () => {
  it("groups by key", () => {
    const g = groupBy([1, 2, 3, 4], (n) => n % 2);
    expect(g.get(0)).toEqual([2, 4]);
    expect(g.get(1)).toEqual([1, 3]);
  });

  it("chunks", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("throws on bad chunk size", () => {
    expect(() => chunk([1], 0)).toThrow();
  });

  it("dedupes by key keeping first", () => {
    expect(uniqueBy([{ id: 1 }, { id: 1 }, { id: 2 }], (x) => x.id)).toEqual([
      { id: 1 },
      { id: 2 },
    ]);
  });

  it("partitions", () => {
    expect(partition([1, 2, 3, 4], (n) => n > 2)).toEqual([[3, 4], [1, 2]]);
  });
});
