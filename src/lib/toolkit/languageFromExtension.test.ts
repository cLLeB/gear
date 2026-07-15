import { describe, expect, it } from "vitest";
import { languageFromExtension } from "./languageFromExtension";

describe("languageFromExtension", () => {
  it("maps by extension", () => {
    expect(languageFromExtension("src/app.tsx")).toBe("typescript");
    expect(languageFromExtension("main.rs")).toBe("rust");
  });

  it("recognises special filenames", () => {
    expect(languageFromExtension("Dockerfile")).toBe("dockerfile");
    expect(languageFromExtension("project/Makefile")).toBe("makefile");
  });

  it("falls back to plaintext", () => {
    expect(languageFromExtension("notes.zzz")).toBe("plaintext");
  });
});
