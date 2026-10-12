import { describe, expect, it } from "vitest";
import { addCard, addColumn, columnTitle, deleteCard, editCard, moveCard, moveColumn, NEW_BOARD, overdue, parseBoard, renameColumn, serializeBoard, toggleCard, viewCard } from "./model";

const SAMPLE = `# Project

Intro text.

## To do

- [ ] Write the parser #core @due(2026-01-05)
  with a second line
  - a sub item

- [ ] Draw the board

## In progress ##

Notes for this column.

- [ ] Ship it

Trailing remark.
- not a card after the remark

## Done

- [x] Set up the repo
`;

describe("board model", () => {
  it("round-trips a file byte for byte, including CRLF and a missing final newline", () => {
    expect(serializeBoard(parseBoard(SAMPLE))).toBe(SAMPLE);
    const crlf = SAMPLE.replace(/\n/g, "\r\n");
    expect(serializeBoard(parseBoard(crlf))).toBe(crlf);
    const bare = SAMPLE.trimEnd();
    expect(serializeBoard(parseBoard(bare))).toBe(bare);
    expect(serializeBoard(parseBoard(NEW_BOARD))).toBe(NEW_BOARD);
    expect(serializeBoard(parseBoard(""))).toBe("");
  });

  it("reads columns and cards", () => {
    const b = parseBoard(SAMPLE);
    expect(b.columns.map(columnTitle)).toEqual(["To do", "In progress", "Done"]);
    expect(b.columns.map((c) => c.cards.length)).toEqual([2, 1, 1]);
    const first = viewCard(b.columns[0].cards[0]);
    expect(first).toMatchObject({ text: "Write the parser #core @due(2026-01-05)", done: false, tags: ["core"], due: "2026-01-05" });
    expect(first.details).toEqual(["with a second line", "- a sub item"]);
    expect(viewCard(b.columns[2].cards[0]).done).toBe(true);
    expect(b.columns[1].before).toContain("Notes for this column.");
    expect(b.columns[1].after).toContain("- not a card after the remark");
    expect(overdue("2026-01-05", "2026-01-06")).toBe(true);
    expect(overdue("2026-01-05", "2026-01-05")).toBe(false);
    expect(overdue(null, "2026-01-05")).toBe(false);
  });

  it("ignores headings and list items inside code fences", () => {
    const b = parseBoard("## A\n\n- [ ] one\n\n```md\n## not a column\n- not a card\n```\n\n## B\n");
    expect(b.columns.map(columnTitle)).toEqual(["A", "B"]);
    expect(b.columns[0].cards).toHaveLength(1);
  });

  it("moves a card with its details and ticks it in a Done column", () => {
    const b = moveCard(parseBoard(SAMPLE), 0, 0, 2, 0);
    expect(b.columns.map((c) => c.cards.length)).toEqual([1, 1, 2]);
    const moved = viewCard(b.columns[2].cards[0]);
    expect(moved.done).toBe(true);
    expect(moved.details).toEqual(["with a second line", "- a sub item"]);
    const back = moveCard(b, 2, 0, 0, 0);
    expect(viewCard(back.columns[0].cards[0]).done).toBe(false);
    expect(serializeBoard(back)).toBe(SAMPLE);
    // Reordering inside a column never changes the checkbox.
    const re = moveCard(parseBoard(SAMPLE), 0, 0, 0, 1);
    expect(re.columns[0].cards.map((c) => viewCard(c).text)).toEqual(["Draw the board", "Write the parser #core @due(2026-01-05)"]);
    expect(moveCard(parseBoard(SAMPLE), 0, 9, 1, 0)).toEqual(parseBoard(SAMPLE));
    // Filling a column and emptying it again leaves the file as it was.
    const filled = moveCard(parseBoard(NEW_BOARD), 0, 0, 1, 0);
    expect(serializeBoard(filled)).toBe("# Board\n\n## To do\n\n## In progress\n\n- [ ] First task\n\n## Done\n");
    expect(serializeBoard(moveCard(filled, 1, 0, 2, 0))).toBe("# Board\n\n## To do\n\n## In progress\n\n## Done\n\n- [x] First task\n");
  });

  it("adds, edits, toggles and deletes cards", () => {
    let b = addCard(parseBoard(NEW_BOARD), 1, "  Second\ntask ");
    expect(serializeBoard(b)).toBe("# Board\n\n## To do\n\n- [ ] First task\n\n## In progress\n\n- [ ] Second task\n\n## Done\n");
    b = addCard(b, 2, "Finished thing");
    expect(viewCard(b.columns[2].cards[0]).done).toBe(true);
    b = editCard(b, 1, 0, "Renamed");
    expect(viewCard(b.columns[1].cards[0])).toMatchObject({ text: "Renamed", done: false });
    b = toggleCard(b, 1, 0);
    expect(b.columns[1].cards[0].lines[0]).toBe("- [x] Renamed");
    b = deleteCard(b, 1, 0);
    expect(b.columns[1].cards).toHaveLength(0);
    expect(addCard(b, 0, "   ")).toBe(b);
    // A column of plain bullets stays plain.
    const plain = addCard(parseBoard("## A\n\n- one\n"), 0, "two");
    expect(serializeBoard(plain)).toBe("## A\n\n- one\n- two\n");
    expect(toggleCard(plain, 0, 0).columns[0].cards[0].lines[0]).toBe("- [x] one");
  });

  it("adds, renames and reorders columns", () => {
    let b = addColumn(parseBoard("# T\n\n## A\n\n- [ ] x\n"), "Later");
    expect(serializeBoard(b)).toBe("# T\n\n## A\n\n- [ ] x\n\n## Later\n\n");
    b = renameColumn(b, 0, " First ");
    expect(columnTitle(b.columns[0])).toBe("First");
    b = moveColumn(b, 0, 1);
    expect(b.columns.map(columnTitle)).toEqual(["Later", "First"]);
    expect(moveColumn(b, 0, -1)).toBe(b);
    expect(serializeBoard(addColumn(parseBoard("# T"), "A"))).toBe("# T\n\n## A\n");
  });
});
