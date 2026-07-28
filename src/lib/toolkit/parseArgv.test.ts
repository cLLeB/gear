import { describe, expect, it } from "vitest";
import { parseArgv } from "./parseArgv";

describe("parseArgv", () => {
  it("splits on whitespace", () => {
    expect(parseArgv("git commit -m msg")).toEqual(["git", "commit", "-m", "msg"]);
  });

  it("keeps single-quoted segments literal", () => {
    expect(parseArgv("echo 'hello world'")).toEqual(["echo", "hello world"]);
  });

  it("handles double quotes with escapes", () => {
    expect(parseArgv('echo "a \\"b\\" c"')).toEqual(["echo", 'a "b" c']);
  });

  it("joins adjacent quoted and bare parts", () => {
    expect(parseArgv("a'b'c")).toEqual(["abc"]);
  });

  it("handles backslash escapes", () => {
    expect(parseArgv("a\\ b")).toEqual(["a b"]);
  });

  it("returns empty for blank input", () => {
    expect(parseArgv("   ")).toEqual([]);
  });
});
