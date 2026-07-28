import { describe, expect, it } from "vitest";
import {
  formatConventionalCommit,
  parseConventionalCommit,
} from "./conventionalCommit";

describe("conventionalCommit", () => {
  it("parses type, scope, and description", () => {
    expect(parseConventionalCommit("feat(ui): add button")).toEqual({
      type: "feat",
      scope: "ui",
      breaking: false,
      description: "add button",
    });
  });

  it("detects breaking marker", () => {
    expect(parseConventionalCommit("fix!: drop api")?.breaking).toBe(true);
  });

  it("handles missing scope", () => {
    expect(parseConventionalCommit("chore: tidy")?.scope).toBeNull();
  });

  it("rejects non-conventional headers", () => {
    expect(parseConventionalCommit("just a message")).toBeNull();
  });

  it("round-trips", () => {
    const c = parseConventionalCommit("feat(api)!: v2")!;
    expect(formatConventionalCommit(c)).toBe("feat(api)!: v2");
  });
});
