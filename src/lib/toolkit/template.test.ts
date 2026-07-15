import { describe, expect, it } from "vitest";
import { interpolate, templateKeys } from "./template";

describe("interpolate", () => {
  it("substitutes flat keys", () => {
    expect(interpolate("Hi {{name}}", { name: "Gear" })).toBe("Hi Gear");
  });

  it("resolves dotted paths", () => {
    expect(interpolate("{{user.name}}", { user: { name: "dev" } })).toBe("dev");
  });

  it("uses fallback for missing keys", () => {
    expect(interpolate("{{missing}}", {})).toBe("");
    expect(interpolate("{{missing}}", {}, { keepMissing: true })).toBe("{{missing}}");
  });

  it("renders escaped braces literally", () => {
    expect(interpolate("\\{{name}}", { name: "x" })).toBe("{{name}}");
  });
});

describe("templateKeys", () => {
  it("lists referenced keys", () => {
    expect(templateKeys("{{a}} and {{b.c}} and {{a}}")).toEqual(["a", "b.c"]);
  });
});
