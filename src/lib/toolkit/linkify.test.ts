import { describe, expect, it } from "vitest";
import { detectLinks } from "./linkify";

describe("detectLinks", () => {
  it("finds urls", () => {
    const links = detectLinks("see https://example.com/path now");
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ type: "url", value: "https://example.com/path" });
  });

  it("does not include trailing punctuation", () => {
    const links = detectLinks("go to https://example.com.");
    expect(links[0].value).toBe("https://example.com");
  });

  it("finds emails", () => {
    const links = detectLinks("mail dev@example.org please");
    expect(links[0]).toMatchObject({ type: "email", value: "dev@example.org" });
  });

  it("returns links sorted by position", () => {
    const links = detectLinks("a@b.com then https://x.io");
    expect(links.map((l) => l.type)).toEqual(["email", "url"]);
  });
});
