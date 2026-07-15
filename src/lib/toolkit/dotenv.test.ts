import { describe, expect, it } from "vitest";
import { parseDotenv, stringifyDotenv } from "./dotenv";

describe("parseDotenv", () => {
  it("parses key=value with export and comments", () => {
    const env = parseDotenv("export FOO=bar\n# c\nBAZ=qux # trailing");
    expect(env).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("handles quoted values with escapes", () => {
    expect(parseDotenv('MSG="a\\nb"').MSG).toBe("a\nb");
    expect(parseDotenv("RAW='a b'").RAW).toBe("a b");
  });

  it("round-trips values needing quotes", () => {
    const env = { A: "1", B: "has space" };
    expect(parseDotenv(stringifyDotenv(env))).toEqual(env);
  });
});
