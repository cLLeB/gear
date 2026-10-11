import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  adjacentBookmark,
  bookmarkField,
  bookmarkLines,
  setBookmarksEffect,
  toggleBookmarkEffect,
} from "./bookmarks";

const make = (doc: string) => EditorState.create({ doc, extensions: [bookmarkField] });

describe("bookmark state", () => {
  it("toggles a line on and off", () => {
    let s = make("a\nb\nc");
    s = s.update({ effects: toggleBookmarkEffect.of(s.doc.line(2).from) }).state;
    expect(bookmarkLines(s)).toEqual([2]);
    s = s.update({ effects: toggleBookmarkEffect.of(s.doc.line(2).from) }).state;
    expect(bookmarkLines(s)).toEqual([]);
  });

  it("moves bookmarks with edits above them", () => {
    let s = make("a\nb\nc");
    s = s.update({ effects: setBookmarksEffect.of([s.doc.line(3).from]) }).state;
    s = s.update({ changes: { from: 0, insert: "new\nlines\n" } }).state;
    expect(bookmarkLines(s)).toEqual([5]);
  });

  it("collapses bookmarks on lines merged by a deletion", () => {
    let s = make("a\nb\nc");
    s = s.update({ effects: setBookmarksEffect.of([s.doc.line(1).from, s.doc.line(2).from]) }).state;
    s = s.update({ changes: { from: 0, to: 2 } }).state; // delete "a\n"
    expect(bookmarkLines(s)).toEqual([1]);
  });
});

describe("adjacentBookmark", () => {
  it("wraps around in both directions", () => {
    expect(adjacentBookmark([3, 10, 20], 10, 1)).toBe(20);
    expect(adjacentBookmark([3, 10, 20], 25, 1)).toBe(3);
    expect(adjacentBookmark([3, 10, 20], 3, -1)).toBe(20);
    expect(adjacentBookmark([], 1, 1)).toBeNull();
  });
});
