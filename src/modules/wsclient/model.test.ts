import { describe, expect, it } from "vitest";
import { append, backoff, checkUrl, describeClose, exportLog, filterLog, hexPreview, parseProtocols, prettyJson, remember, totals, utf8Length, type Entry } from "./model";

const e = (dir: Entry["dir"], text: string, bytes = text.length): Omit<Entry, "id"> => ({ at: 0, dir, text, bytes, binary: false });

describe("websocket client model", () => {
  it("normalises addresses", () => {
    expect(checkUrl("ws://localhost:8080")).toEqual({ url: "ws://localhost:8080/" });
    expect(checkUrl("localhost:3000/socket")).toEqual({ url: "ws://localhost:3000/socket" });
    expect(checkUrl("127.0.0.1:9")).toEqual({ url: "ws://127.0.0.1:9/" });
    expect(checkUrl("echo.example.org/ws?x=1")).toEqual({ url: "wss://echo.example.org/ws?x=1" });
    expect(checkUrl("https://example.org/live")).toEqual({ url: "wss://example.org/live" });
    expect(checkUrl("http://localhost:1/")).toEqual({ url: "ws://localhost:1/" });
    expect(checkUrl("")).toHaveProperty("error");
    expect(checkUrl("ftp://x")).toHaveProperty("error");
    expect(checkUrl("ws://x/#frag")).toHaveProperty("error");
    expect(checkUrl("ws://")).toHaveProperty("error");
  });

  it("parses sub-protocols", () => {
    expect(parseProtocols(" graphql-ws, json ,json")).toEqual({ protocols: ["graphql-ws", "json"] });
    expect(parseProtocols("")).toEqual({ protocols: [] });
    expect(parseProtocols("bad name")).toHaveProperty("error");
  });

  it("keeps a capped log with increasing ids and totals", () => {
    let log: Entry[] = [];
    for (let i = 0; i < 5; i++) log = append(log, e(i % 2 ? "in" : "out", `m${i}`, 10), 3);
    expect(log.map((x) => x.id)).toEqual([3, 4, 5]);
    log = append(log, e("info", "note", 0), 10);
    expect(totals(log)).toEqual({ sent: 2, received: 1, bytesOut: 20, bytesIn: 10 });
    expect(utf8Length("héllo")).toBe(6);
  });

  it("filters by direction and text", () => {
    let log: Entry[] = [];
    for (const x of [e("out", "ping"), e("in", "PONG"), e("info", "Connected"), e("error", "boom")]) log = append(log, x);
    const all = { in: true, out: true, info: true };
    expect(filterLog(log, "", all)).toHaveLength(4);
    expect(filterLog(log, "pong", all).map((x) => x.text)).toEqual(["PONG"]);
    expect(filterLog(log, "", { in: false, out: true, info: false }).map((x) => x.text)).toEqual(["ping"]);
    expect(filterLog(log, "", { in: false, out: false, info: true }).map((x) => x.text)).toEqual(["Connected", "boom"]);
  });

  it("formats JSON, close codes, binary frames and the exported log", () => {
    expect(prettyJson('{"a":[1,2]}')).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
    expect(prettyJson("hello")).toBeNull();
    expect(prettyJson("{broken")).toBeNull();
    expect(prettyJson("")).toBeNull();
    expect(describeClose(1006, "")).toBe("Closed: 1006 (connection lost (no close frame))");
    expect(describeClose(4001, "kicked")).toBe("Closed: 4001 (application-defined) — kicked");
    expect(describeClose(2999, "")).toContain("unknown");
    expect(hexPreview(new Uint8Array([0, 255, 16]))).toBe("00 ff 10");
    expect(hexPreview(new Uint8Array(100), 2)).toBe("00 00 … (100 bytes)");
    expect(exportLog(append([], { at: 0, dir: "out", text: "hi", bytes: 2, binary: false }))).toBe("1970-01-01T00:00:00.000Z >> hi");
  });

  it("backs off and remembers recent addresses", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(backoff)).toEqual([1, 2, 4, 8, 16, 30, 30]);
    expect(remember(["a", "b", "c"], "b", 3)).toEqual(["b", "a", "c"]);
    expect(remember(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
  });
});
