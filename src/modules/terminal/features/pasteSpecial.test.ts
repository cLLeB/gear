import { describe, expect, it } from "vitest";
import { PASTE_TRANSFORMS } from "./pasteSpecial";

const t = PASTE_TRANSFORMS;

describe("paste transforms", () => {
  const text = "npm ci\r\n\n# build\nnpm run build  \n";
  it("joins lines", () => {
    expect(t.oneLine.apply(text)).toBe("npm ci # build npm run build");
    expect(t.andChain.apply(text)).toBe("npm ci && npm run build");
  });

  it("quotes for POSIX and PowerShell", () => {
    expect(t.quoted.apply("it's here\n")).toBe(`'it'\\''s here'`);
    expect(t.quoted.apply("it's", true)).toBe(`'it''s'`);
    expect(t.quotedArgs.apply("a b\nc")).toBe(`'a b' 'c'`);
  });

  it("builds a heredoc with a non-colliding tag", () => {
    expect(t.heredoc.apply("x\nEOF\ny\n")).toBe("cat <<'EOF_'\nx\nEOF\ny\nEOF_");
  });

  it("trims", () => {
    expect(t.trimmed.apply("  ls -la \n")).toBe("ls -la");
  });
});
