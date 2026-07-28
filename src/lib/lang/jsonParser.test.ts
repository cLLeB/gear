import { describe, expect, it } from "vitest";
import { parseJson } from "./jsonParser";

describe("parseJson", () => {
  it("parses valid JSON to the right value", () => {
    const { value, errors } = parseJson('{"a":1,"b":[true,null,"x"]}');
    expect(errors).toHaveLength(0);
    expect(value).toEqual({ a: 1, b: [true, null, "x"] });
  });

  it("matches JSON.parse for a range of literals", () => {
    for (const src of ['"hi"', "42", "-3.14e2", "true", "false", "null", "[]", "{}"]) {
      expect(parseJson(src).value).toEqual(JSON.parse(src));
    }
  });

  it("reports a missing value", () => {
    const { errors } = parseJson('{"a":}');
    expect(errors[0].message).toContain("Expected a value");
  });

  it("detects duplicate keys", () => {
    const { errors } = parseJson('{"a":1,"a":2}');
    expect(errors.some((e) => e.code === "json-duplicate-key")).toBe(true);
  });

  it("detects trailing commas by default", () => {
    expect(parseJson('{"a":1,}').errors.some((e) => e.code === "json-trailing-comma")).toBe(true);
    expect(parseJson("[1,2,]").errors.some((e) => e.code === "json-trailing-comma")).toBe(true);
  });

  it("allows trailing commas and comments when enabled", () => {
    const src = '{\n // c\n "a": 1,\n}';
    const { errors, value } = parseJson(src, { allowComments: true, allowTrailingCommas: true });
    expect(errors).toHaveLength(0);
    expect(value).toEqual({ a: 1 });
  });

  it("recovers and reports multiple errors in one pass", () => {
    const { errors } = parseJson('{"a" 1, "b": }');
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  it("flags unterminated strings and objects with offsets", () => {
    const { errors } = parseJson('{"a": "oops');
    expect(errors.some((e) => e.code === "json-unterminated-string")).toBe(true);
    expect(errors.every((e) => e.to >= e.from)).toBe(true);
  });

  it("flags trailing content", () => {
    expect(parseJson("1 2").errors.some((e) => e.code === "json-trailing")).toBe(true);
  });
});
