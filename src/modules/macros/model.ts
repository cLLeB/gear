// Editor macros: what gets recorded, how a recording is tidied up, described
// and stored. Playback itself lives in recorder.ts.

export type Step = { t: "text"; text: string } | { t: "key"; key: string; code: string; ctrl: boolean; alt: boolean; shift: boolean; meta: boolean };

export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
}

const MODIFIERS = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph", "CapsLock", "NumLock", "ScrollLock", "OS", "Dead", "Process", "Unidentified"]);

/**
 * Keys that become a step. Plain printable keys are left out: they arrive as
 * text input, which is recorded separately (and correctly for any keyboard layout).
 */
export function keyStep(e: KeyLike): Step | null {
  if (e.isComposing || MODIFIERS.has(e.key)) return null;
  const printable = e.key.length === 1;
  // AltGr combinations report ctrl+alt and still type a character.
  if (printable && !e.metaKey && (!e.ctrlKey || e.altKey) && !(e.altKey && !e.ctrlKey)) return null;
  return { t: "key", key: e.key, code: e.code, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey };
}

/** Joins runs of typed text into single steps. */
export function compact(steps: Step[]): Step[] {
  const out: Step[] = [];
  for (const s of steps) {
    const last = out[out.length - 1];
    if (s.t === "text" && last?.t === "text") out[out.length - 1] = { t: "text", text: last.text + s.text };
    else out.push(s);
  }
  return out;
}

const KEY_NAMES: Record<string, string> = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", " ": "Space", Escape: "Esc", Backspace: "⌫", Delete: "Del", Enter: "⏎", Tab: "⇥" };

export function describeStep(s: Step): string {
  if (s.t === "text") return JSON.stringify(s.text);
  const mods = [s.ctrl && "Ctrl", s.meta && "Cmd", s.alt && "Alt", s.shift && "Shift"].filter(Boolean);
  const key = KEY_NAMES[s.key] ?? (s.key.length === 1 ? s.key.toUpperCase() : s.key);
  return [...mods, key].join("+");
}

/** One line summarising a macro, shortened in the middle when long. */
export function describe(steps: Step[], max = 90): string {
  const text = compact(steps).map(describeStep).join(" ");
  if (text.length <= max) return text;
  const half = Math.floor((max - 3) / 2);
  return `${text.slice(0, half)} … ${text.slice(text.length - half)}`;
}

export interface SavedMacro {
  name: string;
  steps: Step[];
}

function isStep(x: unknown): x is Step {
  if (!x || typeof x !== "object") return false;
  const s = x as Record<string, unknown>;
  if (s.t === "text") return typeof s.text === "string";
  return s.t === "key" && typeof s.key === "string" && typeof s.code === "string" && ["ctrl", "alt", "shift", "meta"].every((k) => typeof s[k] === "boolean");
}

/** Saved macros from storage, dropping anything malformed. */
export function parseSaved(raw: string | null): SavedMacro[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data.filter((m): m is SavedMacro => !!m && typeof m === "object" && typeof (m as SavedMacro).name === "string" && Array.isArray((m as SavedMacro).steps) && (m as SavedMacro).steps.every(isStep));
  } catch {
    return [];
  }
}

/** Adds or replaces by name (case-insensitive), newest first. */
export function upsert(list: SavedMacro[], macro: SavedMacro): SavedMacro[] {
  return [macro, ...list.filter((m) => m.name.toLowerCase() !== macro.name.toLowerCase())];
}

/** How many times to play: "5", "x5", "5 times"; null when it is not a count from 1 to 10000. */
export function parseCount(text: string): number | null {
  const m = /^\s*x?\s*(\d+)\s*(x|times?)?\s*$/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 10000 ? n : null;
}
