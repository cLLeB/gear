import { describe, expect, it } from "vitest";
import { parseIni, stringifyIni } from "./ini";

describe("parseIni", () => {
  it("parses root keys and sections", () => {
    const data = parseIni("name=gear\n; comment\n[core]\neditor=vim");
    expect(data.name).toBe("gear");
    expect(data.core).toEqual({ editor: "vim" });
  });

  it("strips quotes from values", () => {
    expect(parseIni('greeting="hello world"').greeting).toBe("hello world");
  });

  it("round-trips", () => {
    const text = "a=1\n\n[sec]\nb=2";
    expect(stringifyIni(parseIni(text))).toBe(text);
  });
});
