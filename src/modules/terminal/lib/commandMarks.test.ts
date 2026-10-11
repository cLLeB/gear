import { describe, expect, it } from "vitest";
import {
  adjacentPromptLine,
  applyOsc133,
  CommandMarks,
  readBufferRange,
} from "./commandMarks";

function fakeTerm() {
  let line = 0;
  const term = {
    registerMarker: () => {
      const m = { line, isDisposed: false, dispose() { this.isDisposed = true; } };
      return m as never;
    },
  };
  return { term, setLine: (n: number) => (line = n) };
}

describe("CommandMarks", () => {
  it("records a full prompt → execute → finish cycle", () => {
    const { term, setLine } = fakeTerm();
    const marks = new CommandMarks(term);
    const finished: string[] = [];
    marks.onCommandFinished((m) => finished.push(m.command));
    setLine(0);
    applyOsc133(marks, "A", 1000);
    setLine(1);
    applyOsc133(marks, "C;ls -la", 1000);
    setLine(5);
    applyOsc133(marks, "D;2", 1250);
    const last = marks.lastFinished();
    expect(last?.command).toBe("ls -la");
    expect(last?.exitCode).toBe(2);
    expect(last?.output?.line).toBe(1);
    expect(last?.end?.line).toBe(5);
    expect(last!.finishedAt! - last!.startedAt!).toBe(250);
    expect(finished).toEqual(["ls -la"]);
  });

  it("ignores D without a preceding C (an empty prompt)", () => {
    const { term } = fakeTerm();
    const marks = new CommandMarks(term);
    applyOsc133(marks, "A");
    applyOsc133(marks, "D;0");
    expect(marks.lastFinished()).toBeNull();
    expect(marks.list()).toHaveLength(1);
  });

  it("drops marks whose prompt line was trimmed from scrollback", () => {
    const { term } = fakeTerm();
    const marks = new CommandMarks(term);
    applyOsc133(marks, "A");
    marks.list()[0].prompt.dispose();
    expect(marks.list()).toHaveLength(0);
  });

  it("treats a missing or garbage exit code as null", () => {
    const { term } = fakeTerm();
    const marks = new CommandMarks(term);
    applyOsc133(marks, "A");
    applyOsc133(marks, "C;true");
    applyOsc133(marks, "D;x");
    expect(marks.lastFinished()?.exitCode).toBeNull();
  });
});

describe("adjacentPromptLine", () => {
  const prompts = [0, 10, 25, 40];
  it("finds the previous prompt strictly above", () => {
    expect(adjacentPromptLine(prompts, 25, -1)).toBe(10);
    expect(adjacentPromptLine(prompts, 26, -1)).toBe(25);
    expect(adjacentPromptLine(prompts, 0, -1)).toBeNull();
  });
  it("finds the next prompt strictly below", () => {
    expect(adjacentPromptLine(prompts, 10, 1)).toBe(25);
    expect(adjacentPromptLine(prompts, 40, 1)).toBeNull();
  });
});

describe("readBufferRange", () => {
  const rows = [
    { text: "first", wrapped: false },
    { text: "long-line-part-1", wrapped: false },
    { text: "-part-2", wrapped: true },
    { text: "", wrapped: false },
    { text: "  ", wrapped: false },
  ];
  const buffer = {
    length: rows.length,
    getLine: (y: number) =>
      rows[y] && { translateToString: () => rows[y].text, isWrapped: rows[y].wrapped },
  };
  it("joins soft-wrapped rows and trims trailing blanks", () => {
    expect(readBufferRange(buffer, 0, 5)).toBe("first\nlong-line-part-1-part-2");
  });
  it("clamps the range", () => {
    expect(readBufferRange(buffer, -3, 1)).toBe("first");
  });
});
