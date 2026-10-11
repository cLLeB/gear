import { describe, expect, it } from "vitest";
import { findJwt, inspectJwt } from "./jwtInspect";

const b64url = (o: unknown) =>
  btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const token = (payload: object, header: object = { alg: "HS256", typ: "JWT" }) =>
  `${b64url(header)}.${b64url(payload)}.sig`;

const NOW = 1_700_000_000_000;

describe("findJwt", () => {
  it("extracts a token from surrounding text", () => {
    const t = token({ sub: "1" });
    expect(findJwt(`Authorization: Bearer ${t}`)).toBe(t);
    expect(findJwt("no token here")).toBeNull();
  });
});

describe("inspectJwt", () => {
  it("reports validity windows", () => {
    expect(inspectJwt(token({ exp: NOW / 1000 + 3600 }), NOW)?.summary).toBe("Valid for 1h");
    expect(inspectJwt(token({ exp: NOW / 1000 - 90 }), NOW)?.status).toBe("expired");
    expect(inspectJwt(token({ nbf: NOW / 1000 + 60 }), NOW)?.status).toBe("not-yet-valid");
    expect(inspectJwt(token({ sub: "x" }), NOW)?.status).toBe("no-expiry");
  });

  it("describes claims, dates and unsigned tokens", () => {
    const r = inspectJwt(token({ sub: "user-1", iat: NOW / 1000 - 60, roles: ["a"] }, { alg: "none" }), NOW)!;
    expect(r.rows[0]).toEqual({ key: "alg", value: "none", note: "unsigned token!" });
    expect(r.rows.find((x) => x.key === "iat")?.note).toBe("issued at · 1m ago");
    expect(r.rows.find((x) => x.key === "roles")?.value).toBe('["a"]');
  });

  it("returns null for garbage", () => {
    expect(inspectJwt("a.b.c")).toBeNull();
  });
});
