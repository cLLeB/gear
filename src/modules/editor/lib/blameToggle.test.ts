import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/ai/lib/native", () => ({ native: {} }));
vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { error: () => {} }) }));

import { repoRelativePath } from "./blameToggle";

describe("repoRelativePath", () => {
  it("strips a Windows repo root regardless of case and separators", () => {
    expect(repoRelativePath("C:/Users/me/gear", "C:\\Users\\me\\gear\\src\\main.rs")).toBe("src/main.rs");
    expect(repoRelativePath("c:/users/ME/gear/", "C:/Users/me/gear/README.md")).toBe("README.md");
  });

  it("strips a POSIX repo root case-sensitively", () => {
    expect(repoRelativePath("/home/me/gear", "/home/me/gear/src/lib.rs")).toBe("src/lib.rs");
    expect(repoRelativePath("/home/me/gear", "/home/me/Gear/src/lib.rs")).toBe("/home/me/Gear/src/lib.rs");
  });

  it("does not treat a sibling folder with the same prefix as inside", () => {
    expect(repoRelativePath("C:/code/gear", "C:/code/gear-old/a.ts")).toBe("C:/code/gear-old/a.ts");
  });

  it("leaves relative paths alone", () => {
    expect(repoRelativePath("C:/code/gear", "src/a.ts")).toBe("src/a.ts");
  });
});
