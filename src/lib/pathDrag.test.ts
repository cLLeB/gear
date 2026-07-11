import { describe, expect, it } from "vitest";
import {
  FS_PATHS_MIME,
  dragHasFsPaths,
  readFsPaths,
  writeFsPaths,
} from "./pathDrag";

// Minimal DataTransfer stand-in — jsdom's is inconsistent across versions.
function fakeDataTransfer(): DataTransfer {
  const store = new Map<string, string>();
  return {
    effectAllowed: "none",
    dropEffect: "none",
    get types() {
      return Array.from(store.keys());
    },
    setData(type: string, data: string) {
      store.set(type, data);
    },
    getData(type: string) {
      return store.get(type) ?? "";
    },
  } as unknown as DataTransfer;
}

describe("pathDrag", () => {
  it("round-trips paths through the custom MIME type", () => {
    const dt = fakeDataTransfer();
    writeFsPaths(dt, ["C:/a/b.txt", "C:/c d/e.rs"]);
    expect(dragHasFsPaths(dt)).toBe(true);
    expect(readFsPaths(dt)).toEqual(["C:/a/b.txt", "C:/c d/e.rs"]);
  });

  it("also writes a plain-text fallback", () => {
    const dt = fakeDataTransfer();
    writeFsPaths(dt, ["/x", "/y"]);
    expect(dt.getData("text/plain")).toBe("/x /y");
  });

  it("drops empty/non-string entries when writing", () => {
    const dt = fakeDataTransfer();
    writeFsPaths(dt, ["", "keep", ""]);
    expect(readFsPaths(dt)).toEqual(["keep"]);
  });

  it("writes nothing when there are no usable paths", () => {
    const dt = fakeDataTransfer();
    writeFsPaths(dt, ["", ""]);
    expect(dragHasFsPaths(dt)).toBe(false);
    expect(dt.types).not.toContain(FS_PATHS_MIME);
  });

  it("reports no paths for an unrelated drag", () => {
    const dt = fakeDataTransfer();
    dt.setData("text/plain", "hello");
    expect(dragHasFsPaths(dt)).toBe(false);
    expect(readFsPaths(dt)).toEqual([]);
  });

  it("returns [] on corrupt payloads", () => {
    const dt = fakeDataTransfer();
    dt.setData(FS_PATHS_MIME, "{not json");
    expect(readFsPaths(dt)).toEqual([]);
  });

  it("tolerates a null DataTransfer", () => {
    expect(dragHasFsPaths(null)).toBe(false);
  });
});
