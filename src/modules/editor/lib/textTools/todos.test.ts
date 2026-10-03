import { describe, expect, it } from "vitest";
import { parseTodo, todoRank } from "./todos";

describe("parseTodo", () => {
  it.each([
    ["// TODO: handle errors", "TODO", null, "handle errors"],
    ["  # FIXME(alice): race on startup", "FIXME", "alice", "race on startup"],
    ["/* HACK - remove after v2 */", "HACK", null, "remove after v2"],
    ["<!-- NOTE: generated file -->", "NOTE", null, "generated file"],
    ["-- XXX revisit index", "XXX", null, "revisit index"],
    [" * @TODO document this", "TODO", null, "document this"],
  ])("%s", (line, tag, owner, text) => {
    expect(parseTodo(line)).toMatchObject({ tag, owner, text });
  });

  it("ignores identifiers and non-comment text", () => {
    expect(parseTodo("const TODO_LIST = []")).toBeNull();
    expect(parseTodo('label = "TODO: not a comment"')).toBeNull();
    expect(parseTodo("// todo lowercase is prose")).toBeNull();
  });

  it("reports where the tag starts", () => {
    const line = "x = 1 // TODO: y";
    expect(line.slice(parseTodo(line)!.index).startsWith("TODO")).toBe(true);
  });
});

describe("todoRank", () => {
  it("orders FIXME before TODO before NOTE", () => {
    expect(todoRank("FIXME")).toBeLessThan(todoRank("TODO"));
    expect(todoRank("TODO")).toBeLessThan(todoRank("NOTE"));
  });
});
