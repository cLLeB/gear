import { describe, expect, it } from "vitest";
import { benchStats, formatMs, parseCurlCheck, parseNslookup } from "./netTools";

describe("benchStats", () => {
  it("computes summary statistics", () => {
    const s = benchStats([10, 12, 11, 30, 12]);
    expect(s.min).toBe(10);
    expect(s.max).toBe(30);
    expect(s.median).toBe(12);
    expect(s.mean).toBe(15);
    expect(s.stddev).toBeCloseTo(8.426, 2);
    expect(formatMs(1500)).toBe("1.50 s");
  });
});

describe("parseCurlCheck", () => {
  it("reads the final headers and timings", () => {
    const out = "HTTP/1.1 301 Moved\r\nLocation: https://x.dev/\r\n\r\nHTTP/2 200\r\ncontent-type: text/html\r\nserver: nginx\r\n\r\n\n__GEAR__200 0.012 0.030 0.080 0.150 0.200 5120 93.184.216.34 2 1 https://x.dev/";
    const c = parseCurlCheck(out)!;
    expect(c.status).toBe(200);
    expect(c.total).toBe(200);
    expect(c.tls).toBe(80);
    expect(c.redirects).toBe(1);
    expect(c.headers).toEqual([["content-type", "text/html"], ["server", "nginx"]]);
    expect(parseCurlCheck("garbage")).toBeNull();
  });
});

describe("parseNslookup", () => {
  it("skips the resolver and lists answers", () => {
    const out = "Server:\t\t127.0.0.53\nAddress:\t127.0.0.53#53\n\nNon-authoritative answer:\nName:\texample.com\nAddress: 93.184.216.34\nName:\texample.com\nAddress: 2606:2800:220:1::\n";
    expect(parseNslookup(out)).toEqual(["example.com A/AAAA 93.184.216.34", "example.com A/AAAA 2606:2800:220:1::"]);
    expect(parseNslookup("Non-authoritative answer:\nexample.com\tmail exchanger = 10 mx.example.com.")).toEqual(["example.com mail exchanger = 10 mx.example.com."]);
  });
});
