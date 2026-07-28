import { describe, expect, it } from "vitest";
import { dedent } from "./dedent";

describe("dedent", () => {
  it("removes common indentation", () => {
    expect(dedent("    a\n    b")).toBe("a\nb");
  });

  it("preserves relative indentation", () => {
    expect(dedent("  a\n    b")).toBe("a\n  b");
  });

  it("ignores blank lines when measuring", () => {
    expect(dedent("  a\n\n  b")).toBe("a\n\nb");
  });

  it("clears whitespace-only lines", () => {
    expect(dedent("  a\n   \n  b")).toBe("a\n\nb");
  });
});
