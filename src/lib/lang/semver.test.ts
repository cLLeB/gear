import { describe, expect, it } from "vitest";
import { compare, maxSatisfying, parse, satisfies, sortVersions } from "./semver";

describe("parse", () => {
  it("parses full versions with prerelease and build", () => {
    expect(parse("1.2.3")).toMatchObject({ major: 1, minor: 2, patch: 3 });
    expect(parse("v2.0.0-rc.1+build.5")).toMatchObject({ prerelease: ["rc", 1], build: ["build", "5"] });
    expect(parse("not.a.version")).toBeNull();
  });
});

describe("compare", () => {
  it("orders by numeric precedence, not lexically", () => {
    expect(compare("1.9.0", "1.10.0")).toBe(-1);
    expect(compare("2.0.0", "2.0.0")).toBe(0);
  });

  it("ranks a prerelease below its release", () => {
    expect(compare("1.0.0-alpha", "1.0.0")).toBe(-1);
    expect(compare("1.0.0-alpha.1", "1.0.0-alpha.2")).toBe(-1);
    expect(compare("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1);
  });

  it("sorts a list ascending", () => {
    expect(sortVersions(["1.0.10", "1.0.2", "1.0.1"])).toEqual(["1.0.1", "1.0.2", "1.0.10"]);
  });
});

describe("satisfies / caret", () => {
  it("^1.2.3 allows patch and minor but not major bumps", () => {
    expect(satisfies("1.2.3", "^1.2.3")).toBe(true);
    expect(satisfies("1.9.9", "^1.2.3")).toBe(true);
    expect(satisfies("2.0.0", "^1.2.3")).toBe(false);
    expect(satisfies("1.2.2", "^1.2.3")).toBe(false);
  });

  it("^0.2.3 is locked to the minor", () => {
    expect(satisfies("0.2.9", "^0.2.3")).toBe(true);
    expect(satisfies("0.3.0", "^0.2.3")).toBe(false);
  });
});

describe("satisfies / tilde, x-ranges, comparators", () => {
  it("~1.2.3 allows patch but not minor bumps", () => {
    expect(satisfies("1.2.9", "~1.2.3")).toBe(true);
    expect(satisfies("1.3.0", "~1.2.3")).toBe(false);
  });

  it("x-ranges", () => {
    expect(satisfies("1.5.0", "1.x")).toBe(true);
    expect(satisfies("2.0.0", "1.x")).toBe(false);
    expect(satisfies("1.2.9", "1.2.x")).toBe(true);
  });

  it("explicit comparator sets", () => {
    expect(satisfies("1.5.0", ">=1.0.0 <2.0.0")).toBe(true);
    expect(satisfies("2.0.0", ">=1.0.0 <2.0.0")).toBe(false);
  });

  it("unions with ||", () => {
    expect(satisfies("2.0.0", "1.2.3 || 2.0.0")).toBe(true);
    expect(satisfies("1.5.0", "1.2.3 || 2.0.0")).toBe(false);
  });

  it("hyphen ranges", () => {
    expect(satisfies("1.3.0", "1.0.0 - 1.5.0")).toBe(true);
    expect(satisfies("1.6.0", "1.0.0 - 1.5.0")).toBe(false);
  });
});

describe("prerelease gating and maxSatisfying", () => {
  it("does not match a prerelease against a plain range", () => {
    expect(satisfies("1.2.3-alpha", "^1.0.0")).toBe(false);
    expect(satisfies("1.2.3-alpha", "^1.2.3-alpha")).toBe(true);
  });

  it("finds the highest satisfying version", () => {
    const versions = ["1.0.0", "1.2.0", "1.5.3", "2.0.0"];
    expect(maxSatisfying(versions, "^1.0.0")).toBe("1.5.3");
    expect(maxSatisfying(versions, "^3.0.0")).toBeNull();
  });
});
