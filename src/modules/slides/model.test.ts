import { describe, expect, it } from "vitest";
import { clampIndex, fitScale, formatElapsed, navigate, parseDeck, SAMPLE_DECK, speakingSeconds } from "./model";

describe("slides model", () => {
  it("splits the sample deck and reads its front matter", () => {
    const deck = parseDeck(SAMPLE_DECK);
    expect(deck.title).toBe("My talk");
    expect(deck.slides.map((s) => s.title)).toEqual(["My talk", "The problem", "Some code", "Thank you"]);
    expect(deck.slides[0].body).toBe("# My talk\n\nA subtitle goes here");
    expect(deck.slides[0].notes).toBe("Welcome everyone. These notes are only visible to you.");
    expect(deck.slides[2].notes).toBe("");
    expect(deck.slides.map((s) => s.line)).toEqual([5, 13, 23, 31]);
  });

  it("does not split inside code fences or on a heading underline", () => {
    const deck = parseDeck("# One\n\n```md\n---\nnot a break\n```\n\nTitle\n---\n\nstill slide one\n\n---\n\n# Two\n");
    expect(deck.slides).toHaveLength(2);
    expect(deck.slides[0].body).toContain("not a break");
    expect(deck.slides[0].body).toContain("still slide one");
    expect(deck.slides[1].title).toBe("Two");
  });

  it("handles notes markers, CRLF, other rules and empty slides", () => {
    const deck = parseDeck("# A\r\n\r\n???\r\nremember this\r\nand this\r\n\r\n***\r\n\r\n\r\n___\r\n\r\nplain *text* with a [link](http://x) and more\r\n");
    expect(deck.slides).toHaveLength(2);
    expect(deck.slides[0].notes).toBe("remember this\nand this");
    expect(deck.slides[1].title).toBe("plain text with a link and more");
    expect(parseDeck("")).toEqual({ slides: [], title: null });
    expect(parseDeck("---\n\n---\n").slides).toEqual([]);
    // A leading rule that is not front matter is just a separator.
    expect(parseDeck("---\n\n# Only\n").slides.map((s) => s.title)).toEqual(["Only"]);
    expect(parseDeck("Notes: inline start\nmore").slides[0]).toMatchObject({ body: "", notes: "inline start\nmore" });
  });

  it("shortens long titles", () => {
    const t = parseDeck(`# ${"word ".repeat(30)}`).slides[0].title;
    expect(t.length).toBe(58);
    expect(t.endsWith("…")).toBe(true);
  });

  it("moves with the usual presenter keys", () => {
    expect(navigate("ArrowRight", 0, 3)).toBe(1);
    expect(navigate(" ", 2, 3)).toBe(2);
    expect(navigate("ArrowLeft", 0, 3)).toBe(0);
    expect(navigate("PageUp", 2, 3)).toBe(1);
    expect(navigate("Home", 2, 3)).toBe(0);
    expect(navigate("End", 0, 3)).toBe(2);
    expect(navigate("x", 1, 3)).toBeNull();
    expect(navigate("End", 0, 0)).toBe(0);
    expect(clampIndex(9, 3)).toBe(2);
    expect(clampIndex(-1, 3)).toBe(0);
  });

  it("scales long slides down and formats the clock", () => {
    expect(fitScale("# Title\n\n- a\n- b")).toBe(1);
    const long = fitScale(Array.from({ length: 40 }, (_, i) => `- point ${i}`).join("\n"));
    expect(long).toBeLessThan(1);
    expect(long).toBeGreaterThanOrEqual(0.55);
    expect(fitScale("x\n".repeat(400))).toBe(0.55);
    expect([0, 59, 61, 3600, 3725].map(formatElapsed)).toEqual(["00:00", "00:59", "01:01", "1:00:00", "1:02:05"]);
    expect(speakingSeconds(parseDeck(`# A\n\nNote: ${"word ".repeat(140)}`))).toBe(60);
  });
});
