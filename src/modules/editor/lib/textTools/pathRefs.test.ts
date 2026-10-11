import { describe, expect, it } from "vitest";
import { pathReferences } from "./pathRefs";

describe("pathReferences", () => {
  const refs = (over: Partial<Parameters<typeof pathReferences>[0]> = {}) =>
    Object.fromEntries(
      pathReferences({ path: "/repo/src/my app.ts", root: "/repo", line: 4, column: 2, endLine: 4, ...over }).map((r) => [r.label, r.value]),
    );

  it("builds single-line references", () => {
    const r = refs();
    expect(r["Relative path"]).toBe("src/my app.ts");
    expect(r["Relative path:line:column"]).toBe("src/my app.ts:4:2");
    expect(r["Agent mention (@path#L)"]).toBe("@src/my app.ts#L4");
    expect(r["Markdown link"]).toBe("[my app.ts:4](src/my%20app.ts#L4)");
    expect(r["Directory"]).toBe("src");
  });

  it("builds range references and handles Windows paths", () => {
    const r = refs({ path: "C:\\repo\\a.ts", root: "C:\\repo", endLine: 9 });
    expect(r["Relative path"]).toBe("a.ts");
    expect(r["Agent mention (@path#L)"]).toBe("@a.ts#L4-L9");
    expect(r["Markdown link"]).toBe("[a.ts L4-9](a.ts#L4-L9)");
    expect(r["Directory"]).toBe(".");
  });
});
