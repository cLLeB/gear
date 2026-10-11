import { describe, expect, it } from "vitest";
import { bucketAt, bucketRange, formatSpan, isLogFile, structured, totals } from "./model";

describe("log viewer helpers", () => {
  it("renders JSON log lines as message + fields", () => {
    expect(structured('{"level":"error","ts":1,"msg":"db down","host":"a","attempt":3,"ctx":{"id":7}}')).toEqual({ message: "db down", fields: [["host", "a"], ["attempt", "3"], ["ctx", '{"id":7}']] });
    expect(structured("plain")).toBeNull();
    expect(structured("{broken")).toBeNull();
  });

  it("maps the histogram", () => {
    const h = { start: 1000, bucketMs: 100, counts: [[1, 0, 2, 0, 0], [0, 3, 0, 0, 1]] as [number, number, number, number, number][], unparsed: 0 };
    expect(totals(h)).toEqual({ error: 1, warn: 3, info: 2, debug: 0, other: 1 });
    expect(bucketAt(150, 200, 2)).toBe(1);
    expect(bucketAt(-5, 200, 2)).toBe(0);
    expect(bucketRange(h, 1, 0)).toEqual({ from: 1000, to: 1199 });
    expect(formatSpan(90_000)).toBe("2 min");
  });

  it("knows log files", () => {
    expect(["/var/log/nginx/access.log", "app.log.1", "server.out", "/var/log/syslog", "/var/log/messages.2"].every(isLogFile)).toBe(true);
    expect(isLogFile("logger.ts")).toBe(false);
  });
});
