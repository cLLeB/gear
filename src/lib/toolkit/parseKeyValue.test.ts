import { describe, expect, it } from "vitest";
import { parseKeyValue } from "./parseKeyValue";

describe("parseKeyValue", () => {
  it("parses space-separated pairs", () => {
    expect(parseKeyValue("a=1 b=2 c=3")).toEqual({ a: "1", b: "2", c: "3" });
  });

  it("handles quoted values with spaces", () => {
    expect(parseKeyValue('name="John Doe" age=30')).toEqual({ name: "John Doe", age: "30" });
  });

  it("supports a custom separator", () => {
    expect(parseKeyValue("a:1 b:2", { separator: ":" })).toEqual({ a: "1", b: "2" });
  });

  it("lets later keys win", () => {
    expect(parseKeyValue("x=1 x=2")).toEqual({ x: "2" });
  });
});
