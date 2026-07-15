import { describe, expect, it } from "vitest";
import { pluralize, pluralizeWithCount } from "./pluralize";

describe("pluralize", () => {
  it("keeps singular for one", () => {
    expect(pluralize(1, "file")).toBe("file");
  });

  it("adds -s for plain nouns", () => {
    expect(pluralize(2, "file")).toBe("files");
  });

  it("adds -es for sibilants", () => {
    expect(pluralize(0, "branch")).toBe("branches");
    expect(pluralize(3, "box")).toBe("boxes");
  });

  it("handles consonant + y", () => {
    expect(pluralize(2, "entry")).toBe("entries");
  });

  it("uses explicit plural when given", () => {
    expect(pluralize(2, "person", "people")).toBe("people");
  });

  it("prefixes count", () => {
    expect(pluralizeWithCount(3, "commit")).toBe("3 commits");
  });
});
