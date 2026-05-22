const KEY = "Gear.terminal.sessions";
const EDITOR_KEY = "Gear.editor.sessions";

export type PersistedTab = {
  title: string;
  cwd: string | undefined;
};

export function saveTerminalTabs(tabs: PersistedTab[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(tabs));
  } catch {
    // storage full or not available
  }
}

export function saveEditorPaths(paths: string[]): void {
  try {
    if (paths.length === 0) {
      window.localStorage.removeItem(EDITOR_KEY);
    } else {
      window.localStorage.setItem(EDITOR_KEY, JSON.stringify(paths));
    }
  } catch {
    // storage full or not available
  }
}

export function loadEditorPaths(): string[] | null {
  try {
    const raw = window.localStorage.getItem(EDITOR_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const result: string[] = [];
    for (const x of parsed) {
      if (typeof x === "string" && x.length > 0) result.push(x);
    }
    return result.length > 0 ? result : null;
  } catch {
    return null;
  }
}

function sanitizeCwd(raw: string): string {
  // Strip Windows extended-length prefix that may have been saved from a
  // previous run where parseOsc7 returned "//?/C:/Users/..." instead of
  // "C:/Users/...".
  if (raw.startsWith("//?/")) return raw.slice(4);
  if (raw.startsWith("\\\\.\\") || raw.startsWith("\\\\?\\")) return raw.slice(4);
  return raw;
}

export function loadTerminalTabs(): PersistedTab[] | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const result: PersistedTab[] = [];
    for (const x of parsed) {
      if (typeof x !== "object" || x === null) continue;
      const rec = x as Record<string, unknown>;
      if (typeof rec.title !== "string") continue;
      const cwd =
        typeof rec.cwd === "string" ? sanitizeCwd(rec.cwd) : undefined;
      result.push({ title: rec.title, cwd });
    }
    return result.length > 0 ? result : null;
  } catch {
    return null;
  }
}
