import { describe, expect, it } from "vitest";
import { LineSplitter } from "./outputTap";

describe("LineSplitter", () => {
  it("emits only complete lines and keeps the remainder", () => {
    const s = new LineSplitter();
    expect(s.pushText("hello\nwor")).toEqual(["hello"]);
    expect(s.pushText("ld\r\n")).toEqual(["world"]);
  });

  it("strips ANSI styling", () => {
    const s = new LineSplitter();
    expect(s.pushText("\x1b[32mready\x1b[0m in 300ms\n")).toEqual(["ready in 300ms"]);
  });

  it("keeps the last carriage-return redraw of a line", () => {
    const s = new LineSplitter();
    expect(s.pushText("10%\r50%\r100% done\n")).toEqual(["100% done"]);
  });

  it("decodes multi-byte characters split across chunks", () => {
    const s = new LineSplitter();
    const bytes = new TextEncoder().encode("➜ Local\n");
    expect(s.push(bytes.slice(0, 2))).toEqual([]);
    expect(s.push(bytes.slice(2))).toEqual(["➜ Local"]);
  });
});
