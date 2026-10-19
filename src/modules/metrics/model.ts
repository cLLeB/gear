// Prometheus text exposition (0.0.4) and OpenMetrics: what a /metrics
// endpoint serves, read into metric families with their series, label
// cardinality, histogram percentiles, per-second rates between two scrapes,
// and the naming problems `promtool check metrics` reports.

export type MetricType = "counter" | "gauge" | "histogram" | "summary" | "gaugehistogram" | "info" | "stateset" | "untyped" | "unknown";

export interface Sample {
  /** The sample's own name (`http_requests_total`, `latency_bucket`). */
  name: string;
  labels: Record<string, string>;
  value: number;
  timestamp: number | null;
}

export interface Family {
  name: string;
  type: MetricType;
  help: string | null;
  unit: string | null;
  samples: Sample[];
  /** Distinct series, not counting histogram buckets or summary quantiles. */
  series: number;
  /** Label name → number of distinct values. */
  labels: Map<string, number>;
}

export interface Exposition {
  families: Family[];
  samples: number;
  openMetrics: boolean;
  /** Lines that could not be read, with their line numbers. */
  errors: { line: number; text: string; message: string }[];
}

const SUFFIXES: Record<string, string[]> = {
  histogram: ["_bucket", "_sum", "_count", "_created"],
  gaugehistogram: ["_bucket", "_gsum", "_gcount"],
  summary: ["_sum", "_count", "_created"],
  counter: ["_total", "_created"],
  info: ["_info"],
};

function unescape(s: string, help: boolean): string {
  return s.replace(help ? /\\([\\n])/g : /\\([\\n"])/g, (_, c: string) => (c === "n" ? "\n" : c));
}

export function parseValue(s: string): number {
  if (s === "+Inf" || s === "Inf" || s === "inf" || s === "+inf") return Infinity;
  if (s === "-Inf" || s === "-inf") return -Infinity;
  if (s === "NaN" || s === "nan") return NaN;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s) && !/^0x[0-9a-f]+$/i.test(s)) throw new Error(`"${s}" is not a number`);
  return Number(s);
}

/** Reads one sample line: `name{a="1",b="x\"y"} 12.5 1700000000000 # {trace_id="…"} 1`. */
export function parseSampleLine(line: string): Sample {
  let i = 0;
  const nameMatch = /^[a-zA-Z_:][a-zA-Z0-9_:]*/.exec(line);
  let name: string;
  const labels: Record<string, string> = {};
  if (nameMatch) {
    name = nameMatch[0];
    i = name.length;
  } else if (line[0] === "{") name = "";
  else throw new Error("Expected a metric name");
  if (line[i] === "{") {
    i++;
    for (;;) {
      while (line[i] === " " || line[i] === ",") i++;
      if (line[i] === "}") {
        i++;
        break;
      }
      // OpenMetrics 2 / UTF-8 names may be quoted.
      let key: string;
      if (line[i] === '"') {
        const end = findQuote(line, i + 1);
        key = unescape(line.slice(i + 1, end), false);
        i = end + 1;
        if (line[i] !== "=") {
          if (!name) name = key;
          continue;
        }
      } else {
        const k = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(line.slice(i));
        if (!k) throw new Error("Expected a label name");
        key = k[0];
        i += key.length;
      }
      while (line[i] === " ") i++;
      if (line[i] !== "=") throw new Error(`Expected = after label ${key}`);
      i++;
      while (line[i] === " ") i++;
      if (line[i] !== '"') throw new Error(`Expected a quoted value for label ${key}`);
      const end = findQuote(line, i + 1);
      labels[key] = unescape(line.slice(i + 1, end), false);
      i = end + 1;
    }
  }
  if (!name) throw new Error("Expected a metric name");
  const rest = line.slice(i).replace(/\s+#\s.*$/, "").trim().split(/\s+/);
  if (!rest[0]) throw new Error("Missing value");
  const ts = rest[1] !== undefined ? Number(rest[1]) : null;
  return { name, labels, value: parseValue(rest[0]), timestamp: ts !== null && Number.isFinite(ts) ? ts : null };
}

function findQuote(s: string, from: number): number {
  for (let j = from; j < s.length; j++) {
    if (s[j] === "\\") j++;
    else if (s[j] === '"') return j;
  }
  throw new Error("Unterminated label value");
}

/** The family a sample belongs to, given the families declared so far. */
function familyOf(sampleName: string, declared: Map<string, Family>): string {
  if (declared.has(sampleName)) {
    const f = declared.get(sampleName) as Family;
    if (f.type !== "counter" && f.type !== "info") return sampleName;
  }
  for (const [type, sufs] of Object.entries(SUFFIXES)) {
    for (const suf of sufs) {
      if (!sampleName.endsWith(suf)) continue;
      const base = sampleName.slice(0, -suf.length);
      if (declared.get(base)?.type === type) return base;
    }
  }
  return sampleName;
}

const SERIES_SKIP = new Set(["le", "quantile"]);
const seriesKey = (s: Sample) =>
  Object.entries(s.labels)
    .filter(([k]) => !SERIES_SKIP.has(k))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(",");

export function parseExposition(text: string): Exposition {
  const families = new Map<string, Family>();
  const errors: Exposition["errors"] = [];
  let openMetrics = false;
  let count = 0;
  const get = (name: string): Family => {
    let f = families.get(name);
    if (!f) families.set(name, (f = { name, type: "untyped", help: null, unit: null, samples: [], series: 0, labels: new Map() }));
    return f;
  };
  text.split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) return;
    if (line.startsWith("#")) {
      const m = /^#\s*(HELP|TYPE|UNIT)\s+(\S+)(?:\s+(.*))?$/.exec(line);
      if (line === "# EOF") openMetrics = true;
      if (!m) return;
      const f = get(m[2].replace(/^"|"$/g, ""));
      if (m[1] === "HELP") f.help = unescape(m[3] ?? "", true);
      else if (m[1] === "UNIT") {
        f.unit = m[3] ?? null;
        openMetrics = true;
      } else {
        const t = (m[3] ?? "").toLowerCase();
        f.type = (["counter", "gauge", "histogram", "summary", "gaugehistogram", "info", "stateset", "untyped", "unknown"].includes(t) ? t : "untyped") as MetricType;
      }
      return;
    }
    try {
      const s = parseSampleLine(line);
      get(familyOf(s.name, families)).samples.push(s);
      count++;
    } catch (err) {
      errors.push({ line: idx + 1, text: raw.slice(0, 200), message: err instanceof Error ? err.message : String(err) });
    }
  });
  const out = [...families.values()].filter((f) => f.samples.length || f.help || f.type !== "untyped");
  for (const f of out) {
    const keys = new Set(f.samples.map(seriesKey));
    f.series = keys.size;
    const values = new Map<string, Set<string>>();
    for (const s of f.samples) for (const [k, v] of Object.entries(s.labels)) if (!SERIES_SKIP.has(k)) (values.get(k) ?? values.set(k, new Set()).get(k))?.add(v);
    f.labels = new Map([...values].map(([k, v]) => [k, v.size]));
  }
  return { families: out, samples: count, openMetrics, errors };
}

export interface Series {
  key: string;
  labels: Record<string, string>;
  /** The value for counters and gauges; the count for histograms and summaries. */
  value: number;
  sum: number | null;
  /** Histogram buckets (cumulative), sorted by bound. */
  buckets: { le: number; count: number }[];
  /** Summary quantiles. */
  quantiles: { q: number; value: number }[];
}

/** One row per series: histogram and summary samples folded together. */
export function seriesOf(f: Family): Series[] {
  const m = new Map<string, Series>();
  for (const s of f.samples) {
    const key = seriesKey(s);
    const labels = Object.fromEntries(Object.entries(s.labels).filter(([k]) => !SERIES_SKIP.has(k)));
    const row = m.get(key) ?? { key, labels, value: NaN, sum: null, buckets: [], quantiles: [] };
    m.set(key, row);
    const suffix = s.name.slice(f.name.length);
    if (f.type === "histogram" || f.type === "gaugehistogram") {
      if (suffix === "_bucket" && s.labels.le !== undefined) row.buckets.push({ le: parseValue(s.labels.le), count: s.value });
      else if (suffix === "_count" || suffix === "_gcount") row.value = s.value;
      else if (suffix === "_sum" || suffix === "_gsum") row.sum = s.value;
    } else if (f.type === "summary") {
      if (s.labels.quantile !== undefined && suffix === "") row.quantiles.push({ q: parseValue(s.labels.quantile), value: s.value });
      else if (suffix === "_count") row.value = s.value;
      else if (suffix === "_sum") row.sum = s.value;
    } else if (!suffix.endsWith("_created")) row.value = s.value;
  }
  for (const r of m.values()) {
    r.buckets.sort((a, b) => a.le - b.le);
    r.quantiles.sort((a, b) => a.q - b.q);
    if (Number.isNaN(r.value) && r.buckets.length) r.value = r.buckets[r.buckets.length - 1].count;
  }
  return [...m.values()];
}

/** The q-quantile of a cumulative histogram, interpolated inside its bucket the way PromQL's histogram_quantile does. */
export function histogramQuantile(q: number, buckets: { le: number; count: number }[]): number {
  if (!buckets.length || buckets[buckets.length - 1].le !== Infinity) return NaN;
  const total = buckets[buckets.length - 1].count;
  if (total === 0) return NaN;
  const rank = q * total;
  let i = buckets.findIndex((b) => b.count >= rank);
  if (i < 0) i = buckets.length - 1;
  if (buckets[i].le === Infinity) return buckets.length > 1 ? buckets[buckets.length - 2].le : NaN;
  const lowerBound = i === 0 ? (buckets[0].le > 0 ? 0 : buckets[0].le) : buckets[i - 1].le;
  const lowerCount = i === 0 ? 0 : buckets[i - 1].count;
  const inBucket = buckets[i].count - lowerCount;
  if (inBucket === 0) return buckets[i].le;
  return lowerBound + (buckets[i].le - lowerBound) * ((rank - lowerCount) / inBucket);
}

/** Per-second rate between two readings of a counter, treating a drop as a restart. */
export function rate(before: number, after: number, seconds: number): number {
  if (!(seconds > 0) || !Number.isFinite(before) || !Number.isFinite(after)) return NaN;
  return (after >= before ? after - before : after) / seconds;
}

export interface Lint {
  family: string;
  message: string;
}

const NON_BASE_UNITS: [RegExp, string][] = [
  [/_(milliseconds|ms|microseconds|us|nanoseconds|ns|minutes|hours|days)(_|$)/, "seconds"],
  [/_(kilobytes|megabytes|gigabytes|kb|mb|gb|kib|mib|gib|bits)(_|$)/, "bytes"],
  [/_(percent|percentage)(_|$)/, "ratio (0–1)"],
];

/** The problems `promtool check metrics` and the naming guide point out, plus cardinality. */
export function lint(exp: Exposition, cardinalityLimit = 100): Lint[] {
  const out: Lint[] = [];
  for (const f of exp.families) {
    const add = (message: string) => out.push({ family: f.name, message });
    if (!f.help) add("No HELP text.");
    if (f.type === "counter" && !f.samples.some((s) => s.name.endsWith("_total"))) add("Counter names should end in _total.");
    if (f.type !== "counter" && f.samples.some((s) => s.name === f.name && f.name.endsWith("_total"))) add(`Only counters should end in _total (this is a ${f.type}).`);
    if (/[A-Z]/.test(f.name)) add("Metric names should be snake_case.");
    for (const [re, unit] of NON_BASE_UNITS) if (re.test(f.name)) add(`Use base units: ${unit}, not ${re.exec(f.name)?.[1]}.`);
    if (/_(count|sum|bucket)$/.test(f.name) && (f.type === "gauge" || f.type === "counter")) add(`Names ending in _${f.name.split("_").pop()} are reserved for histograms and summaries.`);
    for (const [label, n] of f.labels) {
      if (n > cardinalityLimit) add(`Label ${label} has ${n} distinct values; high-cardinality labels (IDs, paths, emails) multiply storage.`);
      if (/^__/.test(label)) add(`Label ${label} uses the reserved __ prefix.`);
    }
    if (f.type === "histogram") {
      for (const s of seriesOf(f)) {
        if (s.buckets.length && s.buckets[s.buckets.length - 1].le !== Infinity) {
          add('A histogram series has no le="+Inf" bucket.');
          break;
        }
        if (s.buckets.some((b, i) => i > 0 && b.count < s.buckets[i - 1].count)) {
          add("Histogram bucket counts are not cumulative.");
          break;
        }
      }
    }
    const keys = f.samples.map((s) => `${s.name}|${JSON.stringify(Object.entries(s.labels).sort())}`);
    if (new Set(keys).size !== keys.length) add("The same series appears more than once.");
  }
  return out;
}

export function formatNumber(n: number): string {
  if (Number.isNaN(n)) return "NaN";
  if (!Number.isFinite(n)) return n > 0 ? "+Inf" : "-Inf";
  const a = Math.abs(n);
  if (a !== 0 && (a >= 1e15 || a < 1e-4)) return n.toExponential(3);
  if (Number.isInteger(n)) return n.toLocaleString("en-US");
  return Number(n.toPrecision(6)).toLocaleString("en-US", { maximumFractionDigits: 6 });
}

/** Seconds, bytes and ratios shown the way people read them, from the metric's name or unit. */
export function humanize(n: number, family: Family): string | null {
  if (!Number.isFinite(n)) return null;
  const unit = family.unit ?? /_(seconds|bytes|ratio)(_total|_sum|_count|_bucket)?$/.exec(family.name)?.[1] ?? null;
  if (unit === "seconds") {
    const a = Math.abs(n);
    if (a < 1e-3) return `${(n * 1e6).toFixed(1)} µs`;
    if (a < 1) return `${(n * 1e3).toFixed(1)} ms`;
    if (a < 120) return `${n.toFixed(2)} s`;
    if (a < 7200) return `${(n / 60).toFixed(1)} min`;
    if (a < 172800) return `${(n / 3600).toFixed(1)} h`;
    return `${(n / 86400).toFixed(1)} d`;
  }
  if (unit === "bytes") {
    const u = ["B", "KiB", "MiB", "GiB", "TiB"];
    let v = n;
    let i = 0;
    while (Math.abs(v) >= 1024 && i < u.length - 1) (v /= 1024), i++;
    return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
  }
  if (unit === "ratio") return `${(n * 100).toFixed(1)}%`;
  return null;
}
