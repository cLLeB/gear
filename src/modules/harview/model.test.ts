import { describe, expect, it } from "vitest";
import { filterRequests, formatMs, kindOf, parseHar, phases, redactHar, statusClass, summarize, toCurl, toFetch, type Filter } from "./model";

const entry = (over: Record<string, unknown>) => ({
  startedDateTime: "2026-01-01T00:00:00.000Z",
  time: 100,
  request: { method: "GET", url: "https://example.com/", httpVersion: "HTTP/2", headers: [], queryString: [], cookies: [] },
  response: { status: 200, statusText: "OK", httpVersion: "HTTP/2", headers: [], cookies: [], content: { size: 1000, mimeType: "text/html", text: "<h1>hi</h1>" }, headersSize: 100, bodySize: 400 },
  timings: { blocked: 5, dns: 10, connect: 30, ssl: 20, send: 1, wait: 50, receive: 4 },
  ...over,
});

const har = {
  log: {
    version: "1.2",
    creator: { name: "Firefox", version: "130" },
    pages: [{ title: "Example", pageTimings: { onLoad: 900, onContentLoad: 600 } }],
    entries: [
      entry({ startedDateTime: "2026-01-01T00:00:00.250Z", request: { method: "POST", url: "https://api.example.com/v1/login?token=abc&page=2", headers: [{ name: "Authorization", value: "Bearer s3cret" }, { name: "Content-Type", value: "application/json" }, { name: ":authority", value: "api.example.com" }, { name: "Cookie", value: "sid=1" }], queryString: [{ name: "token", value: "abc" }, { name: "page", value: "2" }], cookies: [{ name: "sid", value: "1" }], postData: { mimeType: "application/json", text: '{"user":"o\'neil"}' } }, response: { status: 401, statusText: "Unauthorized", headers: [{ name: "Set-Cookie", value: "a=b" }], cookies: [{ name: "a", value: "b" }], content: { size: 20, mimeType: "application/json", text: btoa('{"error":"nope"}'), encoding: "base64" }, _transferSize: 300 }, _resourceType: "fetch" }),
      entry({}),
      entry({ startedDateTime: "2026-01-01T00:00:00.500Z", request: { method: "GET", url: "https://cdn.example.com/app.js", headers: [] }, response: { status: 304, statusText: "Not Modified", headers: [], content: { size: 50000, mimeType: "application/javascript" }, _transferSize: 0 }, timings: { send: 0, wait: 0, receive: 0 }, time: 40 }),
      entry({ startedDateTime: "2026-01-01T00:00:00.600Z", request: { method: "GET", url: "https://cdn.example.com/logo.png", headers: [] }, response: { status: 0, statusText: "", headers: [], content: { size: 0, mimeType: "" }, bodySize: -1 }, time: 0, timings: {} }),
      entry({ startedDateTime: "2026-01-01T00:00:00.700Z" }),
    ],
  },
};
const text = JSON.stringify(har);

describe("HAR viewer", () => {
  it("reads the requests in start order", () => {
    const h = parseHar(text);
    expect(h.creator).toBe("Firefox 130");
    expect(h.pages).toEqual([{ title: "Example", onLoad: 900, onContentLoad: 600 }]);
    expect(h.requests.map((r) => r.url)).toEqual(["https://example.com/", "https://api.example.com/v1/login?token=abc&page=2", "https://cdn.example.com/app.js", "https://cdn.example.com/logo.png", "https://example.com/"]);
    const [doc, login, js, png] = h.requests;
    expect(doc).toMatchObject({ start: 0, host: "example.com", path: "/", kind: "document", size: 1000, transferred: 500, body: "<h1>hi</h1>", fromCache: false });
    // connect excludes ssl
    expect(doc.timings).toMatchObject({ connect: 10, ssl: 20 });
    expect(login).toMatchObject({ start: 250, method: "POST", status: 401, kind: "fetch", transferred: 300, body: '{"error":"nope"}', bodyEncoding: "text", path: "/v1/login?token=abc&page=2" });
    expect(login.query).toEqual([{ name: "token", value: "abc" }, { name: "page", value: "2" }]);
    expect(js).toMatchObject({ kind: "script", fromCache: true, body: null });
    expect(png).toMatchObject({ kind: "image", status: 0, transferred: -1 });
  });

  it("explains what is wrong with other files", () => {
    expect(() => parseHar("{nope")).toThrow(/not valid JSON/);
    expect(() => parseHar('{"log":{}}')).toThrow(/not a HAR/);
    expect(parseHar('﻿{"log":{"entries":[]}}').requests).toEqual([]);
  });

  it("guesses the resource kind", () => {
    expect(kindOf("text/css; charset=utf-8", "https://x/a")).toBe("style");
    expect(kindOf("", "https://x/f.woff2?v=1")).toBe("font");
    expect(kindOf("application/octet-stream", "https://x/a")).toBe("other");
    expect(kindOf("text/html", "https://x/", "xhr")).toBe("fetch");
    expect(kindOf("", "wss://x/", "websocket")).toBe("websocket");
    expect(kindOf("video/mp4", "https://x/v")).toBe("media");
  });

  it("filters by text, kind, status and prefixes", () => {
    const { requests } = parseHar(text);
    const f = (over: Partial<Filter>) => filterRequests(requests, { text: "", kinds: new Set(), status: "all", ...over }).map((r) => r.index);
    expect(f({ text: "cdn" })).toEqual([2, 3]);
    expect(f({ text: "cdn -png" })).toEqual([2]);
    expect(f({ text: "method:post" })).toEqual([0]);
    expect(f({ text: "status:4xx" })).toEqual([0]);
    expect(f({ text: "status:304" })).toEqual([2]);
    expect(f({ text: "domain:*.example.com" })).toEqual([0, 2, 3]);
    expect(f({ text: "domain:example.com" })).toEqual([1, 4]);
    expect(f({ text: "larger-than:40k" })).toEqual([2]);
    expect(f({ text: "mime:json" })).toEqual([0]);
    expect(f({ kinds: new Set(["image", "script"]) })).toEqual([2, 3]);
    expect(f({ status: "failed" })).toEqual([3]);
    expect(f({ status: "redirect" })).toEqual([2]);
    expect(statusClass(503)).toBe("server");
  });

  it("summarizes the page load", () => {
    const s = summarize(parseHar(text).requests);
    expect(s).toMatchObject({ requests: 5, transferred: 500 + 300 + 0 + 0 + 500, failed: 2, cached: 1 });
    expect(s.span).toBe(800);
    expect(s.byHost[0]).toMatchObject({ host: "example.com", count: 2 });
    expect(s.byKind[0].kind).toBe("document");
    expect(s.duplicates).toEqual([{ method: "GET", url: "https://example.com/", count: 2 }]);
    expect(s.slowest[0].time).toBe(100);
    expect(s.largest[0].url).toBe("https://cdn.example.com/app.js");
    expect(summarize([]).span).toBe(0);
  });

  it("lays out the waterfall phases", () => {
    const { requests } = parseHar(text);
    expect(phases(requests[1]).map((p) => [p.phase, p.from, p.width])).toEqual([
      ["blocked", 250, 5],
      ["dns", 255, 10],
      ["connect", 265, 10],
      ["ssl", 275, 20],
      ["send", 295, 1],
      ["wait", 296, 50],
      ["receive", 346, 4],
    ]);
    // Only a total: shown as waiting.
    expect(phases(requests[2])).toEqual([{ phase: "wait", from: 500, width: 40 }]);
    expect(phases(requests[3])).toEqual([]);
  });

  it("copies a request as curl and fetch", () => {
    const login = parseHar(text).requests[1];
    const curl = toCurl(login);
    expect(curl).toContain("curl 'https://api.example.com/v1/login?token=abc&page=2'");
    expect(curl).toContain("-H 'Authorization: Bearer s3cret'");
    expect(curl).not.toContain(":authority");
    expect(curl).not.toContain("-X POST");
    expect(curl).toContain(`--data-raw '{"user":"o'\\''neil"}'`);
    const f = toFetch(login);
    expect(f).toContain('"method": "POST"');
    expect(f).not.toContain("sid=1");
    expect(f).toContain('"body": "{\\"user\\":\\"o\'neil\\"}"');
    expect(toCurl(parseHar(text).requests[0])).toBe("curl 'https://example.com/' \\\n  --compressed");
  });

  it("removes credentials before sharing", () => {
    const { json, masked } = redactHar(text, { bodies: false });
    expect(json).not.toContain("s3cret");
    expect(json).not.toContain("sid=1");
    expect(json).not.toContain("token=abc");
    expect(json).toContain("page=2");
    expect(json).toContain("o'neil");
    const login = JSON.parse(json).log.entries[0];
    expect(login.request.cookies).toEqual([]);
    expect(login.response.headers[0].value).toBe("[redacted]");
    // Authorization, Cookie, token param, URL, request cookie, Set-Cookie, response cookie.
    expect(masked).toBe(6);
    const strict = redactHar(text, { bodies: true });
    expect(strict.json).not.toContain("o'neil");
    expect(strict.json).not.toContain("<h1>");
    // Running it twice changes nothing more.
    expect(redactHar(json, { bodies: false }).masked).toBe(0);
    const form = redactHar(JSON.stringify({ log: { entries: [{ request: { url: "https://u:p@x.com/", postData: { mimeType: "application/x-www-form-urlencoded", text: "user=a&password=hunter2" } } }] } }), { bodies: false });
    expect(form.json).not.toContain("hunter2");
    expect(form.json).not.toContain("u:p@");
  });

  it("formats durations", () => {
    expect([0, 0.4, 12.6, 1500, 75000].map(formatMs)).toEqual(["0 ms", "<1 ms", "13 ms", "1.50 s", "1 min 15 s"]);
  });
});
