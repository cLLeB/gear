import { describe, expect, it } from "vitest";
import { mimeFromExtension } from "./mimeType";

describe("mimeFromExtension", () => {
  it("resolves by filename", () => {
    expect(mimeFromExtension("index.html")).toBe("text/html");
    expect(mimeFromExtension("photo.PNG")).toBe("image/png");
  });

  it("resolves by bare extension", () => {
    expect(mimeFromExtension(".json")).toBe("application/json");
  });

  it("falls back for unknown", () => {
    expect(mimeFromExtension("file.unknownext")).toBe("application/octet-stream");
  });
});
