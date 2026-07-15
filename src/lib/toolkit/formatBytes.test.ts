import { describe, expect, it } from "vitest";
import { formatBytes } from "./formatBytes";

describe("formatBytes", () => {
  it("keeps sub-kilobyte values in bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(999)).toBe("999 B");
  });

  it("scales to decimal units by default", () => {
    expect(formatBytes(1000)).toBe("1 KB");
    expect(formatBytes(1_500_000)).toBe("1.5 MB");
  });

  it("supports IEC binary units", () => {
    expect(formatBytes(1024, { iec: true })).toBe("1 KiB");
    expect(formatBytes(1_048_576, { iec: true })).toBe("1 MiB");
  });

  it("honours precision", () => {
    expect(formatBytes(1_234_567, { precision: 2 })).toBe("1.23 MB");
  });

  it("handles negatives", () => {
    expect(formatBytes(-2048, { iec: true })).toBe("-2 KiB");
  });

  it("returns a dash for non-finite input", () => {
    expect(formatBytes(NaN)).toBe("—");
    expect(formatBytes(Infinity)).toBe("—");
  });
});
