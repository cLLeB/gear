import { describe, expect, it } from "vitest";
import { aggregate, bins, columnKind, dateValue, formatDate, formatTick, linePath, loadTable, niceTicks, points, scale, stats, suggest, tableFromJson, trend, type Table } from "./model";

describe("charts model", () => {
  it("reads JSON in the usual shapes", () => {
    expect(tableFromJson('[{"a":1,"b":"x"},{"a":2,"c":true}]')).toEqual({ columns: ["a", "b", "c"], rows: [["1", "x", ""], ["2", "", "true"]] });
    expect(tableFromJson('{"month":["Jan","Feb"],"sales":[10,20]}')).toEqual({ columns: ["month", "sales"], rows: [["Jan", "10"], ["Feb", "20"]] });
    expect(tableFromJson('{"meta":1,"data":[{"x":1}]}')).toEqual({ columns: ["x"], rows: [["1"]] });
    expect(tableFromJson('[["h1","h2"],[1,2]]')).toEqual({ columns: ["h1", "h2"], rows: [["1", "2"]] });
    expect(tableFromJson("[3,1,2]")).toEqual({ columns: ["value"], rows: [["3"], ["1"], ["2"]] });
    expect(tableFromJson("{bad")).toMatch(/Not valid JSON/);
    expect(tableFromJson('{"a":1}')).toMatch(/list of records/);
    expect(tableFromJson("[]")).toMatch(/empty/);
  });

  it("reads CSV with a header and drops blank rows", () => {
    expect(loadTable("day,temp\n2026-01-01,3.5\n\n2026-01-02,4\n", "w.csv")).toEqual({ columns: ["day", "temp"], rows: [["2026-01-01", "3.5"], ["2026-01-02", "4"]] });
    expect(loadTable("only a header\n", "w.csv")).toMatch(/header row/);
    expect(loadTable(',b\n1,2\n', "w.csv")).toMatchObject({ columns: ["column 1", "b"] });
    expect(loadTable('[{"a":1}]', "data.txt")).toMatchObject({ columns: ["a"] });
  });

  it("recognises dates and column kinds", () => {
    expect(dateValue("2026-03-04")).toBe(Date.UTC(2026, 2, 4));
    expect(dateValue("2026-3")).toBe(Date.UTC(2026, 2, 1));
    expect(dateValue("2026")).toBe(Date.UTC(2026, 0, 1));
    expect(dateValue("2026-03-04T10:30:00Z")).toBe(Date.UTC(2026, 2, 4, 10, 30));
    expect(dateValue("hello")).toBeNull();
    expect(dateValue("12")).toBeNull();
    const rows = [["2026-01-01", "3", "a", "2019"], ["2026-01-02", "4.5", "b", "2020"], ["2026-01-03", "", "c", "2021"]];
    expect([0, 1, 2, 3].map((i) => columnKind(rows, i))).toEqual(["date", "number", "text", "date"]);
    // Large numbers that happen to have four digits are still numbers.
    expect(columnKind([["1200"], ["4500"], ["9999"]], 0)).toBe("number");
    expect(columnKind([[""], [""]], 0)).toBe("text");
  });

  it("chooses round ticks", () => {
    expect(niceTicks(0, 100)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(3, 47)).toEqual([0, 10, 20, 30, 40, 50]);
    expect(niceTicks(0.12, 0.47)).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
    expect(niceTicks(-5, 5)).toEqual([-6, -4, -2, 0, 2, 4, 6]);
    expect(niceTicks(7, 7)).toEqual([6, 6.5, 7, 7.5, 8]);
    expect(niceTicks(0, 0).length).toBeGreaterThan(1);
    expect([1234567890, 2500000, 45000, 999, 0.5, -1500000].map(formatTick)).toEqual(["1.23B", "2.5M", "45k", "999", "0.5", "-1.5M"]);
    const d = Date.UTC(2026, 2, 4, 10, 30);
    expect([formatDate(d, 5 * 365 * 86400000), formatDate(d, 200 * 86400000), formatDate(d, 10 * 86400000), formatDate(d, 3600000)]).toEqual(["2026", "2026-03", "03-04", "10:30"]);
  });

  it("aggregates by category", () => {
    const rows = [["a", "1"], ["b", "10"], ["a", "3"], ["", "5"], ["b", "x"]];
    expect(aggregate(rows, 0, 1, "sum")).toEqual([{ label: "a", value: 4 }, { label: "b", value: 10 }, { label: "(blank)", value: 5 }]);
    expect(aggregate(rows, 0, 1, "mean")[0].value).toBe(2);
    expect(aggregate(rows, 0, 1, "count").map((g) => g.value)).toEqual([2, 2, 1]);
    expect(aggregate(rows, 0, 1, "max")[0].value).toBe(3);
    expect(aggregate(rows, 0, 1, "min")[0].value).toBe(1);
  });

  it("builds points, bins, scales and paths", () => {
    const rows = [["3", "30"], ["1", "10"], ["2", ""], ["x", "5"]];
    expect(points(rows, 0, 1, "number")).toEqual([{ x: 1, y: 10 }, { x: 3, y: 30 }]);
    expect(points(rows, 0, 1, "text").map((p) => p.x)).toEqual([0, 1, 3]);
    expect(points([["2026-01-02", "1"], ["2026-01-01", "2"]], 0, 1, "date").map((p) => p.y)).toEqual([2, 1]);
    const b = bins([1, 2, 2, 3, 3, 3, 10], 3);
    expect(b.map((x) => x.count)).toEqual([6, 0, 1]);
    expect(b[0].from).toBe(1);
    expect(b[2].to).toBe(10);
    expect(bins([5, 5])).toEqual([{ from: 5, to: 5, count: 2 }]);
    expect(bins([])).toEqual([]);
    expect(bins(Array.from({ length: 1000 }, (_, i) => i)).length).toBe(11);
    const sx = scale(0, 10, 0, 100);
    const sy = scale(0, 5, 50, 0);
    expect(sx(5)).toBe(50);
    expect(sy(5)).toBe(0);
    expect(scale(3, 3, 0, 10)(3)).toBe(0);
    expect(linePath([{ x: 0, y: 0 }, { x: 10, y: 5 }], sx, sy)).toBe("M0.0,50.0L100.0,0.0");
  });

  it("summarises and fits a trend line", () => {
    expect(stats([4, 1, 3, 2])).toEqual({ count: 4, min: 1, max: 4, mean: 2.5, median: 2.5 });
    expect(stats([5, 1, 3])?.median).toBe(3);
    expect(stats([])).toBeNull();
    const t = trend([{ x: 1, y: 3 }, { x: 2, y: 5 }, { x: 3, y: 7 }]);
    expect(t?.slope).toBeCloseTo(2);
    expect(t?.intercept).toBeCloseTo(1);
    expect(t?.r2).toBeCloseTo(1);
    expect(trend([{ x: 1, y: 1 }, { x: 1, y: 2 }])).toBeNull();
    expect(trend([{ x: 1, y: 1 }])).toBeNull();
    expect(trend([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 2 }])?.r2).toBeCloseTo(0.25);
  });

  it("suggests a first chart", () => {
    const t = (columns: string[], rows: string[][]): Table => ({ columns, rows });
    expect(suggest(t(["day", "a", "b"], [["2026-01-01", "1", "2"], ["2026-01-02", "2", "3"]]))).toEqual({ type: "line", x: 0, ys: [1, 2] });
    expect(suggest(t(["name", "n"], [["x", "1"], ["y", "2"]]))).toEqual({ type: "bar", x: 0, ys: [1] });
    expect(suggest(t(["a", "b"], [["1.5", "2"], ["2.5", "3"]]))).toEqual({ type: "scatter", x: 0, ys: [1] });
    expect(suggest(t(["a"], [["1.5"], ["2.5"]]))).toEqual({ type: "histogram", x: 0, ys: [0] });
    expect(suggest(t(["a"], [["x"], ["y"]]))).toEqual({ type: "bar", x: 0, ys: [] });
  });
});
