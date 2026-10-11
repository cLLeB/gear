import { describe, expect, it } from "vitest";
import { parseFileLog } from "./fileLog";

describe("parseFileLog", () => {
  it("parses commits with statuses and renames", () => {
    const out = [
      "\x1eaaaa111\x1faaaa\x1fAda\x1f1700000000\x1ffix: edge case",
      "",
      "M\tsrc/new.ts",
      "\x1ebbbb222\x1fbbbb\x1fBob\x1f1690000000\x1frefactor: move file",
      "",
      "R087\tsrc/old.ts\tsrc/new.ts",
      "\x1ecccc333\x1fcccc\x1fAda\x1f1680000000\x1ffeat: add",
      "",
      "A\tsrc/old.ts",
    ].join("\n");
    expect(parseFileLog(out)).toEqual([
      { sha: "aaaa111", shortSha: "aaaa", author: "Ada", time: 1700000000, subject: "fix: edge case", path: "src/new.ts", originalPath: null, status: "M" },
      { sha: "bbbb222", shortSha: "bbbb", author: "Bob", time: 1690000000, subject: "refactor: move file", path: "src/new.ts", originalPath: "src/old.ts", status: "R" },
      { sha: "cccc333", shortSha: "cccc", author: "Ada", time: 1680000000, subject: "feat: add", path: "src/old.ts", originalPath: null, status: "A" },
    ]);
  });
});
