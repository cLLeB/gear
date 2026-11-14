import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { hintsToMarks } from "./inlayHints";

const doc = Text.of(["greet('Gear', 3);", "const n = add(1, 2);"]);

describe("hintsToMarks", () => {
  it("maps LSP positions to document offsets in order", () => {
    const marks = hintsToMarks(doc, [
      { position: { line: 1, character: 14 }, label: "a:", kind: 2, paddingRight: true },
      { position: { line: 0, character: 6 }, label: "name:", kind: 2, paddingRight: true },
      { position: { line: 1, character: 7 }, label: ": number", kind: 1 },
    ]);
    expect(marks).toEqual([
      { pos: 6, text: "name: ", kind: "parameter" },
      { pos: 18 + 7, text: ": number", kind: "type" },
      { pos: 18 + 14, text: "a: ", kind: "parameter" },
    ]);
  });

  it("joins label parts and collapses whitespace", () => {
    const [m] = hintsToMarks(doc, [
      { position: { line: 0, character: 0 }, label: [{ value: ": Map<" }, { value: "string,\n  number" }, { value: ">" }] },
    ]);
    expect(m.text).toBe(": Map<string, number>");
    expect(m.kind).toBe("other");
  });

  it("drops hints outside the document or with empty labels", () => {
    expect(
      hintsToMarks(doc, [
        { position: { line: 5, character: 0 }, label: "x" },
        { position: { line: 0, character: 99 }, label: "y" },
        { position: { line: 0, character: 1 }, label: "  " },
        { position: { line: 0, character: 2 }, label: "= {unknown}", kind: 1 },
      ]),
    ).toEqual([]);
  });

  it("caps very long labels", () => {
    const [m] = hintsToMarks(doc, [{ position: { line: 0, character: 0 }, label: `: ${"T".repeat(200)}` }]);
    expect(m.text.length).toBe(60);
    expect(m.text.endsWith("…")).toBe(true);
  });
});
