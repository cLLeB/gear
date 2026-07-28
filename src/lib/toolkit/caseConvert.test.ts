import { describe, expect, it } from "vitest";
import {
  toCamelCase,
  toConstantCase,
  toKebabCase,
  toPascalCase,
  toSnakeCase,
} from "./caseConvert";

describe("caseConvert", () => {
  it("converts across styles", () => {
    expect(toCamelCase("foo_bar baz")).toBe("fooBarBaz");
    expect(toPascalCase("foo-bar")).toBe("FooBar");
    expect(toSnakeCase("fooBar")).toBe("foo_bar");
    expect(toKebabCase("FooBar")).toBe("foo-bar");
    expect(toConstantCase("fooBar")).toBe("FOO_BAR");
  });

  it("handles acronyms", () => {
    expect(toSnakeCase("parseHTMLString")).toBe("parse_html_string");
  });

  it("handles already-cased input", () => {
    expect(toCamelCase("alreadyCamel")).toBe("alreadyCamel");
  });
});
