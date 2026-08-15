import { describe, expect, it } from "vitest";
import {
  type ClipboardContents,
  isInside,
  planPaste,
  timestampName,
} from "./paste";

const empty: ClipboardContents = {
  osFiles: [],
  inApp: null,
  image: null,
  text: null,
};

const contents = (over: Partial<ClipboardContents>): ClipboardContents => ({
  ...empty,
  ...over,
});

const AT = new Date(2026, 7, 15, 17, 42, 8);

describe("timestampName", () => {
  it("pads every component so names sort chronologically", () => {
    expect(timestampName(new Date(2026, 0, 2, 3, 4, 5))).toBe(
      "2026-01-02 03-04-05",
    );
  });

  it("uses no character that a filesystem rejects", () => {
    expect(timestampName(AT)).not.toMatch(/[/\\:*?"<>|]/);
  });
});

describe("isInside", () => {
  it("counts a directory as inside itself", () => {
    expect(isInside("/a/b", "/a/b")).toBe(true);
  });

  it("detects a nested destination", () => {
    expect(isInside("/a/b/c", "/a/b")).toBe(true);
  });

  it("does not confuse a sibling with a matching prefix", () => {
    expect(isInside("/a/bb", "/a/b")).toBe(false);
  });

  it("handles Windows separators", () => {
    expect(isInside("C:\\a\\b\\c", "C:\\a\\b")).toBe(true);
    expect(isInside("C:\\a\\bb", "C:\\a\\b")).toBe(false);
  });
});

describe("planPaste", () => {
  it("refuses without a destination", () => {
    expect(planPaste(contents({ text: "hi" }), "")).toEqual({
      op: "none",
      reason: "No folder selected",
    });
  });

  it("reports an empty clipboard", () => {
    expect(planPaste(empty, "/dest")).toEqual({
      op: "none",
      reason: "Clipboard is empty",
    });
  });

  it("copies files taken from the OS clipboard", () => {
    const plan = planPaste(contents({ osFiles: ["/a/x.txt"] }), "/dest");
    expect(plan).toEqual({ op: "copy", sources: ["/a/x.txt"], destDir: "/dest" });
  });

  it("moves files that were cut inside Gear", () => {
    const plan = planPaste(
      contents({ inApp: { paths: ["/a/x.txt"], mode: "cut" } }),
      "/dest",
    );
    expect(plan).toEqual({ op: "move", sources: ["/a/x.txt"], destDir: "/dest" });
  });

  it("copies files that were copied inside Gear", () => {
    const plan = planPaste(
      contents({ inApp: { paths: ["/a/x.txt"], mode: "copy" } }),
      "/dest",
    );
    expect(plan).toEqual({ op: "copy", sources: ["/a/x.txt"], destDir: "/dest" });
  });

  it("prefers the OS clipboard over a stale in-app cut", () => {
    const plan = planPaste(
      contents({
        osFiles: ["/os/new.txt"],
        inApp: { paths: ["/a/old.txt"], mode: "cut" },
      }),
      "/dest",
    );
    // Copy, not move: the OS clipboard carries no cut intent to honor.
    expect(plan).toEqual({
      op: "copy",
      sources: ["/os/new.txt"],
      destDir: "/dest",
    });
  });

  it("prefers files over the file name that Explorer also puts on as text", () => {
    const plan = planPaste(
      contents({ osFiles: ["/a/x.txt"], text: "x.txt" }),
      "/dest",
    );
    expect(plan.op).toBe("copy");
  });

  it("refuses to paste a directory into itself", () => {
    expect(planPaste(contents({ osFiles: ["/a/b"] }), "/a/b")).toEqual({
      op: "none",
      reason: "Cannot paste b into itself",
    });
  });

  it("refuses to paste a directory into its own subtree", () => {
    expect(planPaste(contents({ osFiles: ["/a/b"] }), "/a/b/c")).toEqual({
      op: "none",
      reason: "Cannot paste b into itself",
    });
  });

  it("writes clipboard text to a timestamped file", () => {
    const plan = planPaste(contents({ text: "hello" }), "/dest", AT);
    expect(plan).toEqual({
      op: "write",
      destDir: "/dest",
      name: "Pasted text 2026-08-15 17-42-08.txt",
      content: new TextEncoder().encode("hello"),
    });
  });

  it("writes a clipboard image using its own extension", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const plan = planPaste(
      contents({ image: { bytes, ext: "png" }, text: "ignored" }),
      "/dest",
      AT,
    );
    expect(plan).toEqual({
      op: "write",
      destDir: "/dest",
      name: "Pasted image 2026-08-15 17-42-08.png",
      content: bytes,
    });
  });

  it("treats empty clipboard text as nothing to paste", () => {
    expect(planPaste(contents({ text: "" }), "/dest").op).toBe("none");
  });
});
