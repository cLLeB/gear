import { describe, expect, it } from "vitest";
import { sortBy } from "./sortBy";

interface Row {
  name: string;
  age: number;
}

describe("sortBy", () => {
  const rows: Row[] = [
    { name: "b", age: 30 },
    { name: "a", age: 30 },
    { name: "c", age: 20 },
  ];

  it("sorts by a single key", () => {
    expect(sortBy(rows, (r) => r.name).map((r) => r.name)).toEqual(["a", "b", "c"]);
  });

  it("sorts by multiple keys", () => {
    const sorted = sortBy(rows, { by: (r) => r.age }, { by: (r) => r.name });
    expect(sorted.map((r) => r.name)).toEqual(["c", "a", "b"]);
  });

  it("supports descending", () => {
    const sorted = sortBy(rows, { by: (r) => r.age, desc: true });
    expect(sorted[0].age).toBe(30);
  });

  it("does not mutate input", () => {
    const copy = [...rows];
    sortBy(rows, (r) => r.name);
    expect(rows).toEqual(copy);
  });
});
