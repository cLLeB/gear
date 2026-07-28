import type { RGB } from "./color";

const STEPS = [0, 95, 135, 175, 215, 255];

/** Index of the color cube step nearest to a channel value. */
function nearestStepIndex(c: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < STEPS.length; i++) {
    const dist = Math.abs(STEPS[i] - c);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

/** Map an RGB color to the nearest xterm 256-color palette index. */
export function rgbToAnsi256({ r, g, b }: RGB): number {
  // Grayscale ramp (232-255) when the channels are near-equal.
  if (Math.abs(r - g) < 8 && Math.abs(g - b) < 8) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return Math.round(((r - 8) / 247) * 24) + 232;
  }
  return 16 + 36 * nearestStepIndex(r) + 6 * nearestStepIndex(g) + nearestStepIndex(b);
}

/** Convert an xterm 256-color palette index back to an approximate RGB. */
export function ansi256ToRgb(code: number): RGB {
  if (code < 16) {
    const base = code & 7;
    const bright = code >= 8 ? 255 : 128;
    const v = (bit: number) => ((base >> bit) & 1 ? bright : 0);
    return { r: v(0), g: v(1), b: v(2) };
  }
  if (code >= 232) {
    const gray = (code - 232) * 10 + 8;
    return { r: gray, g: gray, b: gray };
  }
  const c = code - 16;
  return {
    r: STEPS[Math.floor(c / 36) % 6],
    g: STEPS[Math.floor(c / 6) % 6],
    b: STEPS[c % 6],
  };
}
