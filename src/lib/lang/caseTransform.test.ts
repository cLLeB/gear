import { describe, expect, it } from "vitest";
import { convertCase, detectCase, replacePreservingCase, splitWords } from "./caseTransform";

describe("splitWords", () => {
  it("splits every common convention into the same words", () => {
    expect(splitWords("fooBar")).toEqual(["foo", "bar"]);
    expect(splitWords("FooBar")).toEqual(["foo", "bar"]);
    expect(splitWords("foo_bar")).toEqual(["foo", "bar"]);
    expect(splitWords("FOO_BAR")).toEqual(["foo", "bar"]);
    expect(splitWords("foo-bar")).toEqual(["foo", "bar"]);
  });

  it("handles acronym runs", () => {
    expect(splitWords("HTMLParser")).toEqual(["html", "parser"]);
    expect(splitWords("getURL")).toEqual(["get", "url"]);
  });
});

describe("detectCase", () => {
  it("recognizes conventions", () => {
    expect(detectCase("fooBar")).toBe("camel");
    expect(detectCase("FooBar")).toBe("pascal");
    expect(detectCase("foo_bar")).toBe("snake");
    expect(detectCase("FOO_BAR")).toBe("screamingSnake");
    expect(detectCase("foo-bar")).toBe("kebab");
    expect(detectCase("FOO")).toBe("upper");
    expect(detectCase("foo")).toBe("lower");
    expect(detectCase("Foo")).toBe("capital");
  });
});

describe("convertCase", () => {
  it("converts between conventions", () => {
    expect(convertCase("fooBar", "snake")).toBe("foo_bar");
    expect(convertCase("foo_bar", "camel")).toBe("fooBar");
    expect(convertCase("foo-bar", "pascal")).toBe("FooBar");
    expect(convertCase("FooBar", "screamingSnake")).toBe("FOO_BAR");
    expect(convertCase("fooBar", "kebab")).toBe("foo-bar");
  });
});

describe("replacePreservingCase", () => {
  it("preserves each occurrence's convention", () => {
    const text = "fooBar FOO_BAR foo-bar FooBar foo_bar";
    expect(replacePreservingCase(text, "fooBar", "bazQux")).toBe(
      "bazQux BAZ_QUX baz-qux BazQux baz_qux",
    );
  });

  it("preserves case for single-word renames", () => {
    expect(replacePreservingCase("user User USER", "user", "account")).toBe("account Account ACCOUNT");
  });

  it("leaves non-matching identifiers untouched", () => {
    expect(replacePreservingCase("fooBar foobaz", "fooBar", "x")).toBe("x foobaz");
  });

  it("does not match a substring inside a larger identifier", () => {
    expect(replacePreservingCase("fooBarBaz", "fooBar", "x")).toBe("fooBarBaz");
  });
});
