import { describe, expect, it } from "vitest";
import { isEmail, isHexColor, isHttpUrl, isIpv4, isUuid } from "./validators";

describe("validators", () => {
  it("validates emails", () => {
    expect(isEmail("dev@example.com")).toBe(true);
    expect(isEmail("no-at-sign")).toBe(false);
  });

  it("validates http urls", () => {
    expect(isHttpUrl("https://example.com")).toBe(true);
    expect(isHttpUrl("ftp://example.com")).toBe(false);
  });

  it("validates ipv4", () => {
    expect(isIpv4("192.168.0.1")).toBe(true);
    expect(isIpv4("256.0.0.1")).toBe(false);
    expect(isIpv4("1.2.3")).toBe(false);
  });

  it("validates hex colors", () => {
    expect(isHexColor("#fff")).toBe(true);
    expect(isHexColor("#abcdef")).toBe(true);
    expect(isHexColor("red")).toBe(false);
  });

  it("validates uuids", () => {
    expect(isUuid("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
  });
});
