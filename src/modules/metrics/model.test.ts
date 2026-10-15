import { describe, expect, it } from "vitest";
import { formatNumber, histogramQuantile, humanize, lint, parseExposition, parseSampleLine, rate, seriesOf } from "./model";

const text = [
  "# HELP http_requests_total Requests served.",
  "# TYPE http_requests_total counter",
  'http_requests_total{method="GET",code="200"} 1027 1700000000000',
  'http_requests_total{method="POST",code="500"} 3',
  "# HELP request_duration_seconds How long requests took.",
  "# TYPE request_duration_seconds histogram",
  'request_duration_seconds_bucket{le="0.1"} 50',
  'request_duration_seconds_bucket{le="0.5"} 90',
  'request_duration_seconds_bucket{le="1"} 99',
  'request_duration_seconds_bucket{le="+Inf"} 100',
  "request_duration_seconds_sum 23.5",
  "request_duration_seconds_count 100",
  "# TYPE rpc_latency summary",
  'rpc_latency{quantile="0.5"} 0.012',
  'rpc_latency{quantile="0.99"} 0.3',
  "rpc_latency_sum 1.5",
  "rpc_latency_count 40",
  "# HELP temp A gauge with a tricky label.",
  "# TYPE temp gauge",
  'temp{path="C:\\\\dir",note="say \\"hi\\"\\nbye"} -Inf',
  "process_open_fds 12",
  "this is not a sample",
  "",
].join("\n");

describe("metrics", () => {
  it("reads sample lines", () => {
    expect(parseSampleLine('a_b{x="1", y="q\\"z"} 1.5e3 123 # {trace_id="abc"} 1')).toEqual({ name: "a_b", labels: { x: "1", y: 'q"z' }, value: 1500, timestamp: 123 });
    expect(parseSampleLine("up NaN").value).toBeNaN();
    expect(parseSampleLine('{"my.metric", job="x"} 2')).toEqual({ name: "my.metric", labels: { job: "x" }, value: 2, timestamp: null });
    expect(() => parseSampleLine('x{a="1} 2')).toThrow(/Unterminated/);
    expect(() => parseSampleLine("x abc")).toThrow(/not a number/);
  });

  it("groups samples into families with series and label cardinality", () => {
    const e = parseExposition(text);
    expect(e.families.map((f) => `${f.name}:${f.type}:${f.series}`)).toEqual(["http_requests_total:counter:2", "request_duration_seconds:histogram:1", "rpc_latency:summary:1", "temp:gauge:1", "process_open_fds:untyped:1"]);
    expect(e.samples).toBe(14);
    expect(e.errors).toEqual([{ line: 22, text: "this is not a sample", message: expect.stringContaining("not a number") }]);
    expect(e.families[0].labels).toEqual(new Map([["method", 2], ["code", 2]]));
    expect(e.families[3].samples[0].labels).toEqual({ path: "C:\\dir", note: 'say "hi"\nbye' });
    expect(e.openMetrics).toBe(false);
  });

  it("matches OpenMetrics counters declared without _total", () => {
    const e = parseExposition(["# TYPE jobs counter", "# UNIT jobs jobs", "jobs_total 5", "jobs_created 1.7e9", "# EOF"].join("\n"));
    expect(e.openMetrics).toBe(true);
    expect(e.families).toHaveLength(1);
    expect(seriesOf(e.families[0])).toEqual([{ key: "", labels: {}, value: 5, sum: null, buckets: [], quantiles: [] }]);
  });

  it("folds histograms and summaries into series and estimates percentiles", () => {
    const e = parseExposition(text);
    const [h] = seriesOf(e.families[1]);
    expect(h.value).toBe(100);
    expect(h.sum).toBe(23.5);
    expect(h.buckets.map((b) => b.le)).toEqual([0.1, 0.5, 1, Infinity]);
    expect(histogramQuantile(0.5, h.buckets)).toBeCloseTo(0.1);
    expect(histogramQuantile(0.9, h.buckets)).toBeCloseTo(0.5);
    expect(histogramQuantile(0.95, h.buckets)).toBeCloseTo(0.5 + 0.5 * (5 / 9));
    expect(histogramQuantile(0.999, h.buckets)).toBe(1);
    expect(histogramQuantile(0.5, [{ le: 1, count: 3 }])).toBeNaN();
    const [s] = seriesOf(e.families[2]);
    expect(s).toMatchObject({ value: 40, sum: 1.5, quantiles: [{ q: 0.5, value: 0.012 }, { q: 0.99, value: 0.3 }] });
  });

  it("computes rates across restarts", () => {
    expect(rate(100, 160, 30)).toBe(2);
    expect(rate(100, 30, 10)).toBe(3);
    expect(rate(1, 2, 0)).toBeNaN();
  });

  it("lints names, units and cardinality", () => {
    const e = parseExposition(
      [
        "# TYPE jobs counter",
        "jobs 4",
        "# HELP latency_ms x",
        "# TYPE latency_ms gauge",
        ...Array.from({ length: 5 }, (_, i) => `latency_ms{user="${i}"} 1`),
        "# HELP Bad_Name x",
        "# TYPE Bad_Name histogram",
        'Bad_Name_bucket{le="1"} 5',
        'Bad_Name_bucket{le="2"} 3',
        "dup 1",
        "dup 2",
      ].join("\n"),
    );
    expect(lint(e, 3).map((l) => `${l.family}: ${l.message}`)).toEqual([
      "jobs: No HELP text.",
      "jobs: Counter names should end in _total.",
      "latency_ms: Use base units: seconds, not ms.",
      "latency_ms: Label user has 5 distinct values; high-cardinality labels (IDs, paths, emails) multiply storage.",
      "Bad_Name: Metric names should be snake_case.",
      'Bad_Name: A histogram series has no le="+Inf" bucket.',
      "dup: No HELP text.",
      "dup: The same series appears more than once.",
    ]);
  });

  it("formats numbers and units", () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
    expect(formatNumber(0.000012)).toBe("1.200e-5");
    expect(formatNumber(Infinity)).toBe("+Inf");
    const e = parseExposition(text);
    expect(humanize(0.0042, e.families[1])).toBe("4.2 ms");
    expect(humanize(3 * 1024 * 1024, { ...e.families[1], name: "heap_bytes", unit: null })).toBe("3.0 MiB");
    expect(humanize(5, e.families[0])).toBeNull();
  });
});
