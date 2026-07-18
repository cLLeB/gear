import { describe, expect, it } from "vitest";
import { Json5Error, parseJson5 } from "./json5";

describe("parseJson5", () => {
  it("parses strict JSON", () => {
    expect(parseJson5('{"a": 1, "b": [true, null, "x"]}')).toEqual({ a: 1, b: [true, null, "x"] });
  });

  it("ignores line and block comments", () => {
    const text = `{
      // the port to listen on
      "port": 8080, /* inline */ "host": "localhost"
    }`;
    expect(parseJson5(text)).toEqual({ port: 8080, host: "localhost" });
  });

  it("allows trailing commas", () => {
    expect(parseJson5('{"a": 1, "b": 2,}')).toEqual({ a: 1, b: 2 });
    expect(parseJson5("[1, 2, 3,]")).toEqual([1, 2, 3]);
  });

  it("accepts single-quoted strings", () => {
    expect(parseJson5("{'name': 'gear'}")).toEqual({ name: "gear" });
  });

  it("accepts unquoted identifier keys", () => {
    expect(parseJson5("{ port: 3000, enableCache: true }")).toEqual({ port: 3000, enableCache: true });
  });

  it("parses hex, float, and signed numbers", () => {
    expect(parseJson5("{ hex: 0xFF, frac: .5, neg: -12, exp: 1e3 }")).toEqual({
      hex: 255, frac: 0.5, neg: -12, exp: 1000,
    });
  });

  it("parses Infinity and NaN", () => {
    const result = parseJson5("{ a: Infinity, b: -Infinity, c: NaN }") as Record<string, number>;
    expect(result.a).toBe(Infinity);
    expect(result.b).toBe(-Infinity);
    expect(Number.isNaN(result.c)).toBe(true);
  });

  it("handles nested structures with mixed features", () => {
    const text = `{
      compilerOptions: {
        strict: true,
        paths: { '@/*': ['src/*'], }, // trailing comma
      },
    }`;
    expect(parseJson5(text)).toEqual({
      compilerOptions: { strict: true, paths: { "@/*": ["src/*"] } },
    });
  });

  it("throws a positioned error on malformed input", () => {
    expect(() => parseJson5("{ a: }")).toThrow(Json5Error);
    try {
      parseJson5("[1, 2");
    } catch (e) {
      expect(e).toBeInstanceOf(Json5Error);
      expect((e as Json5Error).offset).toBeGreaterThan(0);
    }
  });
});
