import { describe, expect, it } from "vitest";
import type { BenchSample } from "@/modules/tools/paneHandle";
import { formatMs, histogram, parseHeaders, percentile, report, settingsProblem, summarize, timeline } from "./model";

const s = (ms: number, status = 200, at = ms, error: string | null = null): BenchSample => ({ ms, status, bytes: 100, error, at_ms: at });

describe("load test model", () => {
  it("interpolates percentiles", () => {
    const xs = [10, 20, 30, 40, 50];
    expect(percentile(xs, 0)).toBe(10);
    expect(percentile(xs, 50)).toBe(30);
    expect(percentile(xs, 100)).toBe(50);
    expect(percentile(xs, 90)).toBeCloseTo(46);
    expect(percentile([7], 99)).toBe(7);
    expect(percentile([], 50)).toBe(0);
  });

  it("summarises a run", () => {
    const samples = [s(10), s(20), s(30), s(40, 500), s(100, 0, 100, "timed out"), s(50, 404)];
    const sum = summarize(samples, 2000);
    expect(sum).toMatchObject({ requests: 6, ok: 4, failed: 2, rps: 3, min: 10, max: 100, bytes: 600 });
    expect(sum.mean).toBeCloseTo(250 / 6);
    expect(sum.p50).toBeCloseTo(35);
    expect(sum.statuses[0]).toEqual([200, 3]);
    expect(sum.errors).toEqual([["timed out", 1]]);
    expect(summarize([], 0)).toMatchObject({ requests: 0, rps: 0, mean: 0, p99: 0, stdev: 0 });
  });

  it("builds a histogram that covers every sample", () => {
    const samples = Array.from({ length: 200 }, (_, i) => s(10 + (i % 50)));
    samples.push(s(5000));
    const h = histogram(samples, 10);
    expect(h).toHaveLength(10);
    expect(h.reduce((a, b) => a + b.count, 0)).toBe(201);
    expect(h[0].from).toBe(10);
    // The outlier lands in the last bucket instead of stretching the scale.
    expect(h[9].to).toBe(5000);
    expect(h[8].to).toBeLessThan(100);
    expect(histogram([s(5), s(5)])).toEqual([{ from: 5, to: 5, count: 2 }]);
    expect(histogram([])).toEqual([]);
  });

  it("counts completions per second, including empty seconds", () => {
    const t = timeline([s(10, 200, 100), s(30, 200, 900), s(20, 500, 2500)]);
    expect(t).toEqual([
      { second: 0, count: 2, failed: 0, mean: 20 },
      { second: 1, count: 0, failed: 0, mean: 0 },
      { second: 2, count: 1, failed: 1, mean: 20 },
    ]);
    expect(timeline([])).toEqual([]);
  });

  it("formats times and parses headers", () => {
    expect([0.5, 12.34, 150.4, 2500].map(formatMs)).toEqual(["0.50 ms", "12.3 ms", "150 ms", "2.50 s"]);
    expect(parseHeaders("Authorization: Bearer a:b\n\nbad line\n X-Id :  7 \n: none")).toEqual({ Authorization: "Bearer a:b", "X-Id": "7" });
  });

  it("checks the settings before a run", () => {
    const ok = { url: "http://localhost:3000/", method: "GET", total: 100, concurrency: 10, timeoutMs: 10000 };
    expect(settingsProblem(ok)).toBeNull();
    expect(settingsProblem({ ...ok, url: "localhost:3000" })).toMatch(/http/);
    expect(settingsProblem({ ...ok, total: 0 })).toMatch(/Requests/);
    expect(settingsProblem({ ...ok, total: 1.5 })).toMatch(/Requests/);
    expect(settingsProblem({ ...ok, concurrency: 65 })).toMatch(/Concurrency/);
    expect(settingsProblem({ ...ok, total: 5, concurrency: 10 })).toMatch(/higher/);
    expect(settingsProblem({ ...ok, timeoutMs: 50 })).toMatch(/timeout/);
  });

  it("writes a report", () => {
    const settings = { url: "http://localhost:3000/", method: "GET", total: 4, concurrency: 2, timeoutMs: 10000 };
    const text = report(summarize([s(10), s(20), s(30), s(40, 0)], 1000), settings, 1000);
    expect(text).toContain("GET http://localhost:3000/");
    expect(text).toContain("4 requests, 2 at a time, in 1.00 s");
    expect(text).toContain("Throughput   4.0 req/s");
    expect(text).toContain("Failed       1 (25.0%)");
    expect(text).toContain("200: 3, no response: 1");
  });
});
