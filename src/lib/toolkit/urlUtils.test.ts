import { describe, expect, it } from "vitest";
import { joinUrl, parseUrl } from "./urlUtils";

describe("parseUrl", () => {
  it("parses structured parts", () => {
    const u = parseUrl("https://example.com:8080/a/b?x=1&y=2#frag");
    expect(u).toMatchObject({
      protocol: "https",
      host: "example.com",
      port: "8080",
      path: "/a/b",
      query: { x: "1", y: "2" },
      hash: "frag",
    });
  });

  it("returns null for garbage", () => {
    expect(parseUrl("not a url")).toBeNull();
  });
});

describe("joinUrl", () => {
  it("joins segments without duplicate slashes", () => {
    expect(joinUrl("https://api.test/", "/v1/", "/users")).toBe("https://api.test/v1/users");
  });

  it("preserves protocol slashes", () => {
    expect(joinUrl("https://x.io", "path")).toBe("https://x.io/path");
  });
});
