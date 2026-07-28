import { describe, expect, it } from "vitest";
import { parseFlags } from "./parseFlags";

describe("parseFlags", () => {
  it("separates positionals and flags", () => {
    const { positionals, flags } = parseFlags("build src --out=dist --watch");
    expect(positionals).toEqual(["build", "src"]);
    expect(flags).toEqual({ out: "dist", watch: true });
  });

  it("consumes a following value", () => {
    expect(parseFlags("--name gear").flags).toEqual({ name: "gear" });
  });

  it("expands bundled short flags", () => {
    expect(parseFlags("-abc").flags).toEqual({ a: true, b: true, c: true });
  });

  it("stops parsing after --", () => {
    expect(parseFlags("run -- --not-a-flag").positionals).toEqual(["run", "--not-a-flag"]);
  });

  it("collapses repeats into arrays", () => {
    expect(parseFlags("--tag a --tag b").flags).toEqual({ tag: ["a", "b"] });
  });
});
