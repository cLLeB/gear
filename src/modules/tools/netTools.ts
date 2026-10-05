// Pure helpers for benchmark statistics, URL checks and DNS lookups.

export interface BenchStats {
  runs: number;
  mean: number;
  stddev: number;
  min: number;
  max: number;
  median: number;
  p95: number;
}

export function benchStats(samples: number[]): BenchStats {
  const s = [...samples].sort((a, b) => a - b);
  const n = s.length;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? s.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  const q = (p: number) => {
    const i = (n - 1) * p;
    const lo = Math.floor(i);
    return s[lo] + (s[Math.min(lo + 1, n - 1)] - s[lo]) * (i - lo);
  };
  return { runs: n, mean, stddev: Math.sqrt(variance), min: s[0], max: s[n - 1], median: q(0.5), p95: q(0.95) };
}

export function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(1)} ms`;
}

/** curl -w format whose output we parse back. */
export const CURL_WRITE_OUT = "\\n__GEAR__%{http_code} %{time_namelookup} %{time_connect} %{time_appconnect} %{time_starttransfer} %{time_total} %{size_download} %{remote_ip} %{http_version} %{num_redirects} %{url_effective}";

export interface UrlCheck {
  status: number;
  dns: number;
  connect: number;
  tls: number;
  ttfb: number;
  total: number;
  bytes: number;
  ip: string;
  httpVersion: string;
  redirects: number;
  finalUrl: string;
  headers: [string, string][];
}

/** Parse `curl -sS -D - -o /dev/null -w CURL_WRITE_OUT` output (times in ms). */
export function parseCurlCheck(out: string): UrlCheck | null {
  const m = /__GEAR__(\d{3}) ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) (\d+) (\S*) (\S+) (\d+) (\S+)\s*$/.exec(out);
  if (!m) return null;
  const head = out.slice(0, m.index);
  // With redirects, several header blocks are printed; keep the last one.
  const blocks = head.split(/\r?\n\r?\n/).filter((b) => /^HTTP\//.test(b.trim()));
  const last = blocks[blocks.length - 1] ?? "";
  const headers = last
    .split(/\r?\n/)
    .slice(1)
    .map((l) => /^([^:]+):\s*(.*)$/.exec(l))
    .filter((x): x is RegExpExecArray => !!x)
    .map((x) => [x[1], x[2].trim()] as [string, string]);
  const ms = (s: string) => Number(s) * 1000;
  return {
    status: Number(m[1]),
    dns: ms(m[2]),
    connect: ms(m[3]),
    tls: ms(m[4]),
    ttfb: ms(m[5]),
    total: ms(m[6]),
    bytes: Number(m[7]),
    ip: m[8],
    httpVersion: m[9],
    redirects: Number(m[10]),
    finalUrl: m[11],
    headers,
  };
}

/** `nslookup -type=X name` output → answer lines. */
export function parseNslookup(out: string): string[] {
  const lines = out.split(/\r?\n/);
  const answers: string[] = [];
  // Skip the server block (first "Address:" belongs to the resolver).
  const start = lines.findIndex((l) => /^(Non-authoritative answer|Name:)/.test(l.trim()));
  let pendingName = "";
  for (const raw of lines.slice(start < 0 ? 0 : start)) {
    const l = raw.trim();
    if (!l || /^Non-authoritative|^Authoritative answers/.test(l)) continue;
    const name = /^Name:\s*(\S+)/.exec(l);
    if (name) {
      pendingName = name[1];
      continue;
    }
    const addr = /^Address(?:es)?:\s*(.+)$/.exec(l);
    if (addr) {
      answers.push(`${pendingName ? `${pendingName} ` : ""}A/AAAA ${addr[1]}`);
      continue;
    }
    if (/(mail exchanger|text =|canonical name|nameserver|MX preference|internet address|has AAAA|origin =)/i.test(l)) answers.push(l.replace(/\s+/g, " "));
    else if (/^\s*"/.test(raw)) answers.push(`TXT ${l}`);
  }
  return [...new Set(answers)];
}
