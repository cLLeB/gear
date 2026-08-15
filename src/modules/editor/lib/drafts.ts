import { LazyStore } from "@tauri-apps/plugin-store";

// Hot exit: unsaved buffer contents are backed up so closing Gear with dirty
// editors and reopening restores the edits instead of losing them.
//
// A draft records the disk mtime it was taken against. If the file changed on
// disk in the meantime, that stale mtime is handed back to the document, so the
// existing save-conflict path fires and the user is asked before overwriting
// someone else's change. Restoring the draft is never in question — unsaved work
// is the user's; the only question is what happens when it is written back.

const STORE_PATH = "gear-editor-drafts.json";
const PREFIX = "draft:";
const draftKey = (path: string) => `${PREFIX}${path}`;

/** Drafts above this size are not backed up; they are pathological for a store. */
export const MAX_DRAFT_BYTES = 4 * 1024 * 1024;

export type Draft = {
  /** LF-normalized buffer text, matching what `useDocument` holds. */
  text: string;
  /** Disk mtime when the draft was taken; null for a file never read. */
  mtime: number | null;
  at: number;
};

/** Narrows one untrusted entry, returning null rather than throwing. */
export function parseDraft(raw: unknown): Draft | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.text !== "string") return null;
  const mtime =
    typeof r.mtime === "number" && Number.isFinite(r.mtime) ? r.mtime : null;
  const at = typeof r.at === "number" && Number.isFinite(r.at) ? r.at : 0;
  return { text: r.text, mtime, at };
}

/** Whether a buffer is worth backing up: dirty, and not absurdly large. */
export function shouldBackup(buffer: string, saved: string): boolean {
  if (buffer === saved) return false;
  return buffer.length <= MAX_DRAFT_BYTES;
}

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 1000 });

export async function loadDraft(path: string): Promise<Draft | null> {
  if (!path) return null;
  try {
    return parseDraft(await store.get(draftKey(path)));
  } catch {
    return null;
  }
}

export async function saveDraft(
  path: string,
  text: string,
  mtime: number | null,
): Promise<void> {
  if (!path) return;
  try {
    await store.set(draftKey(path), { text, mtime, at: Date.now() });
  } catch {
    // Backup is best-effort; an autosave failure must not block typing.
  }
}

/** Called once a buffer matches disk again — the backup has served its purpose. */
export async function clearDraft(path: string): Promise<void> {
  if (!path) return;
  try {
    await store.delete(draftKey(path));
  } catch {
    // Nothing to do; a stale draft is discarded on next load if it matches disk.
  }
}
