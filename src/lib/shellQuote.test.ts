import { describe, expect, it } from "vitest";
import { quoteShellArg, shellWord } from "./shellQuote";

describe("quoteShellArg (posix)", () => {
  const q = (s: string) => quoteShellArg(s, false);

  it("wraps a plain string in single quotes", () => {
    expect(q("fix the bug")).toBe("'fix the bug'");
  });

  it("escapes embedded single quotes with the '\\'' dance", () => {
    expect(q("it's broken")).toBe("'it'\\''s broken'");
  });

  it("neutralizes shell metacharacters", () => {
    expect(q("a; rm -rf / $(whoami) `id` && b")).toBe(
      "'a; rm -rf / $(whoami) `id` && b'",
    );
  });

  it("quotes an empty string to a real empty argument", () => {
    expect(q("")).toBe("''");
  });

  it("cannot break out of the quoted argument", () => {
    expect(q("'; rm -rf /; '")).toBe("''\\''; rm -rf /; '\\'''");
  });
});

describe("quoteShellArg (windows/pwsh)", () => {
  const q = (s: string) => quoteShellArg(s, true);

  it("wraps a plain string in single quotes", () => {
    expect(q("fix the bug")).toBe("'fix the bug'");
  });

  it("doubles embedded single quotes", () => {
    expect(q("it's broken")).toBe("'it''s broken'");
  });

  it("keeps backticks and $ literal inside single quotes", () => {
    expect(q("$env:PATH `n")).toBe("'$env:PATH `n'");
  });

  it("quotes an empty string", () => {
    expect(q("")).toBe("''");
  });
});

describe("shellWord", () => {
  it("leaves plain words alone", () => {
    expect(shellWord("log", true)).toBe("log");
    expect(shellWord("--no-color", true)).toBe("--no-color");
    expect(shellWord("src/app/main.ts", false)).toBe("src/app/main.ts");
    expect(shellWord("origin/main@1", true)).toBe("origin/main@1");
  });

  it("quotes a comma, which PowerShell would split into two arguments", () => {
    expect(shellWord("-L5,9:src/a.ts", true)).toBe("'-L5,9:src/a.ts'");
    expect(shellWord("-L5,9:src/a.ts", false)).toBe("'-L5,9:src/a.ts'");
  });

  it("quotes a leading @, spaces and empty strings", () => {
    expect(shellWord("@args", true)).toBe("'@args'");
    expect(shellWord("two words", true)).toBe("'two words'");
    expect(shellWord("", true)).toBe("''");
    expect(shellWord("it's", true)).toBe("'it''s'");
  });
});
