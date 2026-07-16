import { describe, expect, it } from "vitest";
import { decodeJwt, isJwtExpired } from "./jwtDecode";

// header {alg:HS256,typ:JWT}, payload {sub:"1234567890",name:"John Doe",exp:1516239022}
const TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
  ".eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiZXhwIjoxNTE2MjM5MDIyfQ" +
  ".SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

describe("decodeJwt", () => {
  it("decodes header and payload", () => {
    const decoded = decodeJwt(TOKEN);
    expect(decoded?.header).toMatchObject({ alg: "HS256", typ: "JWT" });
    expect(decoded?.payload).toMatchObject({ sub: "1234567890", name: "John Doe" });
  });

  it("returns null for malformed tokens", () => {
    expect(decodeJwt("not.a.jwt.token")).toBeNull();
    expect(decodeJwt("onlyonepart")).toBeNull();
  });

  it("detects expiry", () => {
    expect(isJwtExpired(TOKEN, Date.now())).toBe(true);
    expect(isJwtExpired(TOKEN, 0)).toBe(false);
  });
});
