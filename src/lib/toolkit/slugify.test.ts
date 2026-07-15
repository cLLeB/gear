import { describe, expect, it } from "vitest";
import { slugify } from "./slugify";

describe("slugify", () => {
  it("lowercases and dashes words", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("strips diacritics", () => {
    expect(slugify("Café Déjà Vu")).toBe("cafe-deja-vu");
  });

  it("collapses punctuation runs", () => {
    expect(slugify("a---b__c!!d")).toBe("a-b-c-d");
  });

  it("supports custom separator", () => {
    expect(slugify("fix bug", { separator: "_" })).toBe("fix_bug");
  });

  it("respects maxLength at a boundary", () => {
    expect(slugify("one two three four", { maxLength: 7 })).toBe("one-two");
  });
});
