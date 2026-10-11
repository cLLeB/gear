import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ansiToHtml, applyCarriageReturns, applyIopub, emptyNotebook, parseNotebook, pickMime, serializeNotebook, splitSource } from "./model";

const sample = readFileSync(join(__dirname, "__fixtures__", "sample.ipynb"), "utf8");

describe("ipynb", () => {
  it("round-trips a Jupyter-written notebook byte for byte", () => {
    const nb = parseNotebook(sample);
    expect(nb.cells.map((c) => c.cell_type)).toEqual(["markdown", "code", "code", "code", "code"]);
    expect(nb.cells[1].source).toBe("x = 1\nprint(x)");
    expect(nb.cells[2].outputs[0]).toMatchObject({ output_type: "execute_result", data: { "text/html": "<b>1</b>\n<i>x</i>" } });
    expect(serializeNotebook(nb)).toBe(sample.endsWith("\n") ? sample : `${sample}\n`);
  });

  it("creates and splits", () => {
    const nb = emptyNotebook();
    expect(nb.cells).toHaveLength(1);
    expect(JSON.parse(serializeNotebook(nb)).nbformat_minor).toBe(5);
    expect(splitSource("a\nb\n")).toEqual(["a\n", "b\n"]);
    expect(splitSource("")).toEqual([]);
    expect(() => parseNotebook('{"nbformat": 3, "worksheets": []}')).toThrow(/nbformat 3/);
  });
});

describe("outputs", () => {
  it("handles carriage returns and backspaces", () => {
    expect(applyCarriageReturns("10%\r50%\r100%\ndone")).toBe("100%\ndone");
    expect(applyCarriageReturns("abc\b\bX")).toBe("aX");
  });

  it("merges streams and honours clear_output(wait)", () => {
    let s = { outputs: [], clearPending: false } as Parameters<typeof applyIopub>[0];
    s = applyIopub(s, "stream", { name: "stdout", text: "a" })!;
    s = applyIopub(s, "stream", { name: "stdout", text: "b\n" })!;
    expect(s.outputs).toEqual([{ output_type: "stream", name: "stdout", text: "ab\n" }]);
    s = applyIopub(s, "clear_output", { wait: true })!;
    expect(s.outputs).toHaveLength(1);
    s = applyIopub(s, "stream", { name: "stdout", text: "c" })!;
    expect(s.outputs).toEqual([{ output_type: "stream", name: "stdout", text: "c" }]);
    expect(applyIopub(s, "status", {})).toBeNull();
  });

  it("picks the richest mime type", () => {
    expect(pickMime({ "text/plain": "x", "image/png": "..." })).toBe("image/png");
    expect(pickMime({ "text/plain": "x", "text/html": "<b>" })).toBe("text/html");
  });

  it("converts ANSI to safe HTML", () => {
    expect(ansiToHtml("\x1b[0;31mError\x1b[0m: <x>")).toBe('<span style="color:#cc0000">Error</span>: &lt;x&gt;');
    expect(ansiToHtml("\x1b[1;38;5;196mhot\x1b[0m")).toContain("font-weight:bold");
  });
});
