import { describe, expect, it } from "vitest";
import { parseQueryString, toQueryString } from "./queryString";

describe("queryString", () => {
  it("serialises params", () => {
    expect(toQueryString({ q: "a b", page: 2 })).toBe("q=a%20b&page=2");
  });

  it("repeats array keys and skips nullish", () => {
    expect(toQueryString({ tag: ["x", "y"], skip: null })).toBe("tag=x&tag=y");
  });

  it("parses into a record", () => {
    expect(parseQueryString("?q=hi&page=2")).toEqual({ q: "hi", page: "2" });
  });

  it("collapses repeated keys into arrays", () => {
    expect(parseQueryString("tag=x&tag=y")).toEqual({ tag: ["x", "y"] });
  });
});
