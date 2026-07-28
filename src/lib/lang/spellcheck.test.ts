import { describe, expect, it } from "vitest";
import { checkIdentifier, SpellChecker } from "./spellcheck";

const DICT = ["function", "return", "value", "length", "receive", "separate", "definitely", "color", "handler", "user"];

describe("SpellChecker", () => {
  const checker = new SpellChecker(DICT);

  it("recognises known words case-insensitively", () => {
    expect(checker.has("function")).toBe(true);
    expect(checker.has("Function")).toBe(true);
    expect(checker.has("nonsense")).toBe(false);
  });

  it("suggests close corrections within the edit budget", () => {
    const s = checker.suggest("recieve", 2).map((x) => x.word);
    expect(s).toContain("receive");
  });

  it("ranks by edit distance", () => {
    const s = checker.suggest("colr", 2);
    expect(s[0].word).toBe("color");
    expect(s[0].distance).toBe(1);
  });

  it("returns nothing when no word is close enough", () => {
    expect(checker.suggest("zzzzzzz", 1)).toHaveLength(0);
  });

  it("reports its size", () => {
    expect(checker.size).toBe(DICT.length);
  });

  it("checks identifiers by splitting words", () => {
    const misspelled = checkIdentifier("handleUserValeu", checker, 2);
    // "valeu" is not a word; expect a suggestion of "value".
    expect(misspelled.some((m) => m.suggestions.includes("value"))).toBe(true);
  });

  it("ignores known identifier sub-words", () => {
    expect(checkIdentifier("userHandler", checker)).toHaveLength(0);
  });

  it("skips short fragments and numbers", () => {
    expect(checkIdentifier("x2y", checker)).toHaveLength(0);
  });
});
