import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { chunkLines } from "./hunkControls";

describe("chunkLines", () => {
  const doc = Text.of(["one", "TWO", "three", ""]);
  it("maps chunks to git's new-side line numbers", () => {
    expect(chunkLines(doc, 4, 8)).toEqual({ from: 2, to: 2 });
    expect(chunkLines(doc, 0, 14)).toEqual({ from: 1, to: 3 });
    // A deletion before "three" is anchored at line 3; one at EOF at the line after the last.
    expect(chunkLines(doc, 8, 8)).toEqual({ from: 3, to: 3 });
    expect(chunkLines(doc, doc.length, doc.length)).toEqual({ from: 4, to: 4 });
  });
});
