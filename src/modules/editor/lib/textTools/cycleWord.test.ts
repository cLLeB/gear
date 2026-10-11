import { describe, expect, it } from "vitest";
import { cycleToken, tokenAt } from "./cycleWord";

describe("cycleToken", () => {
  it("toggles pairs and cycles longer groups", () => {
    expect(cycleToken("true")).toBe("false");
    expect(cycleToken("false")).toBe("true");
    expect(cycleToken("let")).toBe("const");
    expect(cycleToken("var")).toBe("let");
    expect(cycleToken("const", -1)).toBe("let");
  });

  it("preserves case style", () => {
    expect(cycleToken("True")).toBe("False");
    expect(cycleToken("TRUE")).toBe("FALSE");
    expect(cycleToken("Left")).toBe("Right");
  });

  it("cycles HTTP verbs and operators", () => {
    expect(cycleToken("GET")).toBe("POST");
    expect(cycleToken("DELETE")).toBe("GET");
    expect(cycleToken("===")).toBe("!==");
    expect(cycleToken("&&")).toBe("||");
    expect(cycleToken("<=")).toBe(">=");
  });

  it("returns null for unknown tokens", () => {
    expect(cycleToken("banana")).toBeNull();
  });
});

describe("tokenAt", () => {
  it("finds words and operator runs around the cursor", () => {
    expect(tokenAt("if (a === b)", 7)).toEqual({ from: 6, to: 9, text: "===" });
    expect(tokenAt("x = true;", 5)).toEqual({ from: 4, to: 8, text: "true" });
    expect(tokenAt("x = true;", 8)).toEqual({ from: 4, to: 8, text: "true" });
  });

  it("returns null in whitespace with nothing adjacent", () => {
    expect(tokenAt("a  b", 2)).toBeNull();
  });
});
