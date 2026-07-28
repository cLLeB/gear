import { describe, expect, it } from "vitest";
import { parseCookies, serializeCookie } from "./cookie";

describe("cookie", () => {
  it("parses a cookie header", () => {
    expect(parseCookies("a=1; b=hello%20world")).toEqual({ a: "1", b: "hello world" });
  });

  it("serializes with attributes", () => {
    const out = serializeCookie("sid", "abc", { path: "/", secure: true, sameSite: "Lax" });
    expect(out).toBe("sid=abc; Path=/; SameSite=Lax; Secure");
  });

  it("round-trips a value", () => {
    const s = serializeCookie("k", "a=b;c");
    expect(parseCookies(s.split(";")[0]).k).toBe("a=b;c");
  });
});
