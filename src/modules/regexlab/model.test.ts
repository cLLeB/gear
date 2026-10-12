import { describe, expect, it } from "vitest";
import { codeFor, compile, explain, LIBRARY, replaceAll, run, segments } from "./model";

describe("regex workbench model", () => {
  it("runs a pattern and reports numbered and named groups", () => {
    const r = run("(?<y>\\d{4})-(\\d{2})", "g", "from 2026-01 to 2027-12");
    expect(r.error).toBeNull();
    expect(r.matches.map((m) => [m.index, m.end, m.text])).toEqual([[5, 12, "2026-01"], [16, 23, "2027-12"]]);
    expect(r.matches[0].groups).toEqual(["2026", "01"]);
    expect(r.matches[0].named).toEqual({ y: "2026" });
  });

  it("stops after the first match without the g flag, and reports errors", () => {
    expect(run("a", "", "aaa").matches).toHaveLength(1);
    expect(run("", "g", "aaa")).toEqual({ matches: [], error: null, truncated: false });
    expect(run("(", "g", "x").error).toBeTruthy();
    expect(compile("a", "zz")).toHaveProperty("error");
    expect(run("(a)|(b)", "g", "b").matches[0].groups).toEqual([undefined, "b"]);
  });

  it("does not loop on empty matches, including astral characters", () => {
    expect(run("x*", "g", "ab").matches.map((m) => m.index)).toEqual([0, 1, 2]);
    expect(run("^", "gm", "a\nb").matches.map((m) => m.index)).toEqual([0, 2]);
    expect(run("(?:)", "gu", "😀a").matches.map((m) => m.index)).toEqual([0, 2, 3]);
    const many = run(".", "g", "x".repeat(6000));
    expect(many.matches).toHaveLength(5000);
    expect(many.truncated).toBe(true);
    expect(run("a", "y", "aab").matches).toHaveLength(1);
  });

  it("splits text into matched and unmatched segments", () => {
    const text = "ab12cd3";
    const segs = segments(text, run("\\d+", "g", text).matches);
    expect(segs).toEqual([{ text: "ab", match: -1 }, { text: "12", match: 0 }, { text: "cd", match: -1 }, { text: "3", match: 1 }]);
    expect(segs.map((s) => s.text).join("")).toBe(text);
    // Empty matches draw nothing.
    expect(segments("ab", run("x*", "g", "ab").matches)).toEqual([{ text: "ab", match: -1 }]);
    expect(segments("", [])).toEqual([]);
  });

  it("previews a replacement with group references", () => {
    expect(replaceAll("(\\w+)@(\\w+)", "g", "a@b c@d", "$2 at $1")).toEqual({ result: "b at a d at c" });
    expect(replaceAll("(?<n>\\d)", "g", "a1", "[$<n>]")).toEqual({ result: "a[1]" });
    expect(replaceAll("[", "g", "x", "y")).toHaveProperty("error");
  });

  it("explains a pattern piece by piece", () => {
    const pieces = explain("^(?<user>[\\w.]+)@(?:mail\\.)?example\\.com$");
    expect(pieces.map((p) => p.source)).toEqual(["^", "(?<user>", "[\\w.]", "+", ")", "@", "(?:", "mail", "\\.", ")", "?", "example", "\\.", "com", "$"]);
    expect(pieces.map((p) => p.source).join("")).toBe("^(?<user>[\\w.]+)@(?:mail\\.)?example\\.com$");
    expect(pieces[1].meaning).toBe('start of group 1, named "user"');
    expect(pieces[2]).toMatchObject({ meaning: "one of: \\w.", depth: 1 });
    expect(pieces[3].meaning).toBe("the previous piece, one or more times");
    expect(pieces[10].meaning).toBe("the previous piece, optional");
    expect(pieces[8].meaning).toBe('a literal "."');
  });

  it("explains quantifiers, classes, lookarounds and escapes", () => {
    const meaning = (p: string) => explain(p).map((x) => x.meaning);
    expect(meaning("ab+")).toEqual(['the character "a"', 'the character "b"', "the previous piece, one or more times"]);
    expect(meaning("\\d{2,4}?")[1]).toBe("the previous piece, between 2 and 4 times, as few as possible");
    expect(meaning("x{3}")[1]).toBe("the previous piece, exactly 3 times");
    expect(meaning("x{3,}")[1]).toBe("the previous piece, 3 or more times");
    expect(meaning("[^a-z\\]]")[0]).toBe("any character except: a-z\\]");
    expect(meaning("(?<=\\$)\\d")[0]).toMatch(/preceded by/);
    expect(meaning("a(?!b)")[1]).toMatch(/not followed by/);
    expect(meaning("(a)\\1")[3]).toBe("the same text as group 1");
    expect(meaning("\\p{L}")[0]).toBe("a character with the Unicode property L");
    expect(meaning("\\u00e9")[0]).toBe("the character with code 00E9");
    expect(meaning("a|b")[1]).toBe("or");
    for (const p of ["", "(", "[abc", "\\", "a{", "**"]) expect(explain(p).map((x) => x.source).join("")).toBe(p);
  });

  it("writes the pattern as code", () => {
    expect(codeFor("javascript", "a/b", "gi")).toContain("/a\\/b/gi");
    expect(codeFor("python", "(?<y>\\d+)", "gi")).toBe('import re\n\npattern = re.compile(r"(?P<y>\\d+)", re.IGNORECASE)\nmatches = pattern.findall(text)');
    expect(codeFor("go", "a+", "i")).toBe("re := regexp.MustCompile(`(?i)a+`)\nmatches := re.FindString(text)");
    expect(codeFor("rust", "a+", "g")).toContain('r#"a+"#');
    expect(codeFor("grep", "it's", "gi")).toBe("grep -ioP 'it'\\''s' file.txt");
  });

  it("every library pattern compiles and matches its own sample", () => {
    for (const entry of LIBRARY) {
      const r = run(entry.pattern, entry.flags, entry.sample);
      expect(r.error, entry.name).toBeNull();
      expect(r.matches.length, entry.name).toBeGreaterThan(0);
    }
    expect(run(LIBRARY[2].pattern, "g", LIBRARY[2].sample).matches.map((m) => m.text)).toEqual(["10.0.0.1", "192.168.1.254"]);
    expect(run(LIBRARY[9].pattern, "gi", LIBRARY[9].sample).matches.map((m) => m.text)).toEqual(["is is", "the the"]);
  });
});
