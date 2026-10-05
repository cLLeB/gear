// "Lock" a file against accidental edits (e.g. generated code, lockfiles,
// production config): typing is blocked until it's unlocked again.

import { EditorState } from "@codemirror/state";
import { toast } from "sonner";

const KEY = "gear.lockedFiles";
let locked: Set<string> | null = null;

function load(): Set<string> {
  if (locked) return locked;
  try {
    locked = new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]);
  } catch {
    locked = new Set();
  }
  return locked;
}

export function isLocked(path: string | undefined): boolean {
  return !!path && load().has(path);
}

export function toggleLock(path: string): boolean {
  const set = load();
  const now = !set.has(path);
  if (now) set.add(path);
  else set.delete(path);
  try {
    localStorage.setItem(KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
  return now;
}

let lastWarn = 0;

/** Rejects user edits to locked files; programmatic reloads still apply. */
export function fileLockFilter(getPath: () => string | undefined) {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || !isLocked(getPath())) return tr;
    const user = ["input", "delete", "move", "undo", "redo"].some((e) => tr.isUserEvent(e));
    if (!user) return tr;
    if (Date.now() - lastWarn > 3000) {
      lastWarn = Date.now();
      toast.info("This file is locked", { description: "Run “File: Toggle lock (read-only)” to edit it." });
    }
    return [];
  });
}
