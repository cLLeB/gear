import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineEvent } from "../lib/api";

// Mock the Tauri bridge so the store can be tested without a backend.
const chronicleRange = vi.fn();
const chronicleSearch = vi.fn();
const chroniclePrune = vi.fn();
vi.mock("../lib/api", () => ({
  chronicleRange: (...args: unknown[]) => chronicleRange(...args),
  chronicleSearch: (...args: unknown[]) => chronicleSearch(...args),
  chroniclePrune: (...args: unknown[]) => chroniclePrune(...args),
}));

import { restoreCandidates, useRewindStore } from "./rewindStore";

function fileEvent(id: number, ts: number, path: string): TimelineEvent {
  return {
    id,
    ts,
    kind: "file",
    actor: "user",
    file_path: path,
    summary: `edit ${path}`,
    payload: {},
    parent_id: null,
  };
}

beforeEach(() => {
  chronicleRange.mockReset();
  chronicleSearch.mockReset();
  chroniclePrune.mockReset();
  useRewindStore.setState({
    open: false,
    workspaceRoot: null,
    events: [],
    rangeFrom: 0,
    rangeTo: 0,
    scrubTs: null,
    loading: false,
    error: null,
    query: "",
    searchResults: null,
    searching: false,
  });
});

describe("rewindStore", () => {
  it("load() populates events and clears loading", async () => {
    const events = [fileEvent(1, 100, "a.txt"), fileEvent(2, 200, "b.txt")];
    chronicleRange.mockResolvedValue(events);

    await useRewindStore.getState().load("/w");

    const s = useRewindStore.getState();
    expect(s.events).toEqual(events);
    expect(s.workspaceRoot).toBe("/w");
    expect(s.loading).toBe(false);
    expect(s.error).toBeNull();
  });

  it("load() records error and empties events on failure", async () => {
    chronicleRange.mockRejectedValue(new Error("boom"));

    await useRewindStore.getState().load("/w");

    const s = useRewindStore.getState();
    expect(s.events).toEqual([]);
    expect(s.error).toBe("boom");
    expect(s.loading).toBe(false);
  });

  it("setScrub() updates scrubTs without mutating other state", () => {
    const before = useRewindStore.getState().events;
    useRewindStore.getState().setScrub(1234);
    const s = useRewindStore.getState();
    expect(s.scrubTs).toBe(1234);
    expect(s.events).toBe(before); // unchanged reference
  });

  it("toggle() flips open", () => {
    expect(useRewindStore.getState().open).toBe(false);
    useRewindStore.getState().toggle();
    expect(useRewindStore.getState().open).toBe(true);
  });

  it("search() populates searchResults for a non-empty query", async () => {
    const hits = [fileEvent(7, 500, "x.ts")];
    chronicleSearch.mockResolvedValue(hits);
    useRewindStore.setState({ workspaceRoot: "/w" });

    await useRewindStore.getState().search("x.ts");

    const s = useRewindStore.getState();
    expect(chronicleSearch).toHaveBeenCalledWith("/w", "x.ts", 200);
    expect(s.searchResults).toEqual(hits);
    expect(s.searching).toBe(false);
    expect(s.query).toBe("x.ts");
  });

  it("search() with a blank query clears results without calling the backend", async () => {
    useRewindStore.setState({ workspaceRoot: "/w" });

    await useRewindStore.getState().search("   ");

    expect(chronicleSearch).not.toHaveBeenCalled();
    expect(useRewindStore.getState().searchResults).toBeNull();
  });

  it("search() records empty results on backend failure", async () => {
    chronicleSearch.mockRejectedValue(new Error("fts error"));
    useRewindStore.setState({ workspaceRoot: "/w" });

    await useRewindStore.getState().search("oops");

    const s = useRewindStore.getState();
    expect(s.searchResults).toEqual([]);
    expect(s.searching).toBe(false);
  });

  it("clearSearch() resets query and results", () => {
    useRewindStore.setState({
      query: "foo",
      searchResults: [fileEvent(1, 1, "a")],
      searching: true,
    });

    useRewindStore.getState().clearSearch();

    const s = useRewindStore.getState();
    expect(s.query).toBe("");
    expect(s.searchResults).toBeNull();
    expect(s.searching).toBe(false);
  });

  it("prune() runs the backend prune then reloads the timeline", async () => {
    chroniclePrune.mockResolvedValue({ events_removed: 3, blobs_removed: 2 });
    chronicleRange.mockResolvedValue([fileEvent(1, 100, "a.txt")]);
    useRewindStore.setState({ workspaceRoot: "/w" });

    await useRewindStore.getState().prune();

    expect(chroniclePrune).toHaveBeenCalledWith("/w");
    expect(chronicleRange).toHaveBeenCalled();
    expect(useRewindStore.getState().events).toHaveLength(1);
  });

  it("prune() is a no-op without a workspace", async () => {
    await useRewindStore.getState().prune();
    expect(chroniclePrune).not.toHaveBeenCalled();
  });
});

describe("restoreCandidates", () => {
  it("returns latest file event per path at-or-before the timestamp", () => {
    const events = [
      fileEvent(1, 100, "a.txt"),
      fileEvent(2, 150, "b.txt"),
      fileEvent(3, 200, "a.txt"), // newer a.txt
      fileEvent(4, 300, "c.txt"), // after cutoff
    ];
    const out = restoreCandidates(events, 250);
    const byPath = Object.fromEntries(out.map((e) => [e.file_path, e.id]));
    expect(byPath["a.txt"]).toBe(3);
    expect(byPath["b.txt"]).toBe(2);
    expect(byPath["c.txt"]).toBeUndefined(); // excluded: after cutoff
    expect(out).toHaveLength(2);
  });
});
