// Values for "Insert sequence" across multiple cursors. The spec is
// "start[,step]" where start's shape picks the format:
//   1        → 1 2 3       007 → 007 008 009 (zero padded)
//   0x0f     → 0x0f 0x10   a / A → a b c … z aa ab (spreadsheet style)
//   -5,5     → -5 0 5

export function letters(n: number, upper: boolean): string {
  // 0 → a, 25 → z, 26 → aa (bijective base-26).
  let s = "";
  let k = n + 1;
  while (k > 0) {
    const r = (k - 1) % 26;
    s = String.fromCharCode(97 + r) + s;
    k = Math.floor((k - 1) / 26);
  }
  return upper ? s.toUpperCase() : s;
}

function lettersIndex(s: string): number {
  let n = 0;
  for (const c of s.toLowerCase()) n = n * 26 + (c.charCodeAt(0) - 96);
  return n - 1;
}

export function parseSequenceSpec(spec: string): ((i: number) => string) | null {
  const [rawStart, rawStep = "1"] = spec.split(",").map((s) => s.trim());
  const step = Number(rawStep);
  if (!Number.isFinite(step) || rawStep === "") return null;
  const start = rawStart === "" ? "1" : rawStart;
  if (/^[a-z]+$/.test(start) || /^[A-Z]+$/.test(start)) {
    if (!Number.isInteger(step)) return null;
    const base = lettersIndex(start);
    const upper = start === start.toUpperCase();
    return (i) => letters(Math.max(0, base + i * step), upper);
  }
  const hex = /^(0[xX])([0-9a-fA-F]+)$/.exec(start);
  if (hex) {
    if (!Number.isInteger(step)) return null;
    const width = hex[2].length;
    const upper = hex[2] !== hex[2].toLowerCase();
    const base = parseInt(hex[2], 16);
    return (i) => {
      const v = (base + i * step).toString(16).padStart(width, "0");
      return hex[1] + (upper ? v.toUpperCase() : v);
    };
  }
  if (/^-?\d+(\.\d+)?$/.test(start)) {
    const decimals = Math.max((start.split(".")[1] ?? "").length, (rawStep.split(".")[1] ?? "").length);
    const digits = start.replace(/^-/, "").split(".")[0];
    const pad = digits.length > 1 && digits.startsWith("0") ? digits.length : 0;
    const base = Number(start);
    return (i) => {
      const v = base + i * step;
      const fixed = Math.abs(v).toFixed(decimals);
      const [int, frac] = fixed.split(".");
      return (v < 0 ? "-" : "") + int.padStart(pad, "0") + (frac !== undefined ? `.${frac}` : "");
    };
  }
  return null;
}
