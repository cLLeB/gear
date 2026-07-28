import { describe, expect, it } from "vitest";
import { compareSemver, parseSemver } from "./semver";

describe("parseSemver", () => {
  it("parses a full version", () => {
    const v = parseSemver("v1.2.3-rc.1+build.5");
    expect(v).toMatchObject({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: ["rc", "1"],
      build: ["build", "5"],
    });
  });

  it("rejects garbage", () => {
    expect(parseSemver("not.a.version")).toBeNull();
  });
});

describe("compareSemver", () => {
  it("orders by numeric components", () => {
    expect(compareSemver("1.0.0", "2.0.0")).toBe(-1);
    expect(compareSemver("1.2.0", "1.1.9")).toBe(1);
  });

  it("ranks a release above its prerelease", () => {
    expect(compareSemver("1.0.0", "1.0.0-rc.1")).toBe(1);
  });

  it("orders prerelease identifiers", () => {
    expect(compareSemver("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
    expect(compareSemver("1.0.0-1", "1.0.0-alpha")).toBe(-1);
  });

  it("treats equal versions as equal", () => {
    expect(compareSemver("1.0.0", "v1.0.0")).toBe(0);
  });
});
