export interface HexDumpOptions {
  /** Bytes per row. Defaults to 16. */
  width?: number;
  /** Show the leading address/offset column. Defaults to true. */
  showOffset?: boolean;
}

function toBytes(input: string | Uint8Array): Uint8Array {
  return typeof input === "string" ? new TextEncoder().encode(input) : input;
}

/**
 * Produce a classic `xxd`-style hex dump: offset, hex columns, and an ASCII
 * gutter. Non-printable bytes render as ".".
 */
export function hexDump(input: string | Uint8Array, options: HexDumpOptions = {}): string {
  const { width = 16, showOffset = true } = options;
  const bytes = toBytes(input);
  const lines: string[] = [];

  for (let offset = 0; offset < bytes.length; offset += width) {
    const slice = bytes.subarray(offset, offset + width);
    const hex = [...slice].map((b) => b.toString(16).padStart(2, "0")).join(" ");
    const paddedHex = hex.padEnd(width * 3 - 1, " ");
    const ascii = [...slice]
      .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : "."))
      .join("");
    const prefix = showOffset ? `${offset.toString(16).padStart(8, "0")}  ` : "";
    lines.push(`${prefix}${paddedHex}  ${ascii}`);
  }
  return lines.join("\n");
}
