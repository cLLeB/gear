import { describe, expect, it } from "vitest";
import { EmmetError, expandEmmet } from "./emmet";

describe("expandEmmet", () => {
  it("expands a class into a div with that class", () => {
    expect(expandEmmet(".container")).toBe('<div class="container"></div>');
  });

  it("expands an id shorthand", () => {
    expect(expandEmmet("section#main")).toBe('<section id="main"></section>');
  });

  it("nests children with >", () => {
    expect(expandEmmet("ul>li")).toBe("<ul>\n  <li></li>\n</ul>");
  });

  it("creates siblings with +", () => {
    expect(expandEmmet("div>p+span")).toBe("<div>\n  <p></p>\n  <span></span>\n</div>");
  });

  it("repeats with * and numbers with $", () => {
    expect(expandEmmet("ul>li.item$*3")).toBe(
      [
        "<ul>",
        '  <li class="item1"></li>',
        '  <li class="item2"></li>',
        '  <li class="item3"></li>',
        "</ul>",
      ].join("\n"),
    );
  });

  it("zero-pads with repeated $", () => {
    expect(expandEmmet("li.n$$$*2")).toBe(
      ['<li class="n001"></li>', '<li class="n002"></li>'].join("\n"),
    );
  });

  it("applies attributes and text", () => {
    expect(expandEmmet('a[href=#]{Click me}')).toBe('<a href="#">Click me</a>');
  });

  it("parses quoted attribute values", () => {
    expect(expandEmmet('input[type="email" required]')).toBe('<input type="email" required />');
  });

  it("self-closes void elements", () => {
    expect(expandEmmet("img[src=logo.png]")).toBe('<img src="logo.png" />');
  });

  it("repeats a group", () => {
    expect(expandEmmet("(p>span)*2")).toBe(
      ["<p>", "  <span></span>", "</p>", "<p>", "  <span></span>", "</p>"].join("\n"),
    );
  });

  it("clamps a huge multiplier to a bounded output instead of hanging", () => {
    const start = Date.now();
    const out = expandEmmet("div*999999999");
    expect(Date.now() - start).toBeLessThan(1000); // fails fast
    // Clamped to the max multiplier — one line per element, not a billion.
    expect(out.split("\n").length).toBe(10000);
  });

  it("throws when a nested-group expansion exceeds the total budget", () => {
    expect(() => expandEmmet("(div*10000)*10000")).toThrow(EmmetError);
  });

  it("keeps siblings under a descended parent", () => {
    expect(expandEmmet("div>a+b+c")).toBe(
      ["<div>", "  <a></a>", "  <b></b>", "  <c></c>", "</div>"].join("\n"),
    );
  });
});
