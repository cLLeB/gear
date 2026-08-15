import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { getLaunchDir } from "@/lib/launchDir";
import { clearDraft, loadDraft, saveDraft, shouldBackup } from "./drafts";
import { detectEol, type Eol, normalizeToLf, restoreEol } from "./eol";

type ReadResult =
  | { kind: "text"; content: string; size: number; mtime: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

type FileStat = { size: number; mtime: number; kind: string };

/// Mirrors FORCE_MAX_READ_BYTES in src-tauri fs/file.rs.
export const FORCE_READ_LIMIT = 50 * 1024 * 1024;

/// How long typing must pause before the hot-exit backup is written.
const BACKUP_DEBOUNCE_MS = 500;

export type DocumentState =
  | { status: "loading" }
  | { status: "ready"; content: string; size: number }
  | { status: "binary"; size: number }
  | { status: "toolarge"; size: number; limit: number }
  | { status: "error"; message: string };

type Options = {
  path: string;
  onDirtyChange?: (dirty: boolean) => void;
};

export function useDocument({ path, onDirtyChange }: Options) {
  const [doc, setDoc] = useState<DocumentState>({ status: "loading" });
  const [dirty, setDirty] = useState(false);
  const [reloadCounter, setReloadCounter] = useState(0);

  // Track the saved buffer so we can detect changes cheaply.
  const savedRef = useRef<string>("");
  const bufferRef = useRef<string>("");
  // Buffers live in LF space; the file's original EOL is restored on save.
  const eolRef = useRef<Eol>("\n");
  // Disk mtime at last read/write; drives save-conflict detection. null until
  // the first successful read (or for untitled in-memory files).
  const diskMtimeRef = useRef<number | null>(null);
  // Path for which the user chose "open anyway" (read past the normal limit).
  // Tied to the path so switching files auto-clears it without a reset effect.
  const forcedPathRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const autoSave = usePreferencesStore((s) => s.editorAutoSave);
  const autoSaveDelay = usePreferencesStore((s) => s.editorAutoSaveDelay);

  const autoSaveRef = useRef({ autoSave, autoSaveDelay });
  autoSaveRef.current = { autoSave, autoSaveDelay };

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAutoSaveTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const writeToDisk = useCallback(async () => {
    const content = bufferRef.current;
    const mtime = await invoke<number>("fs_write_file", {
      path,
      // Restore the file's original line endings; the buffer is LF-normalized.
      content: restoreEol(content, eolRef.current),
      workspace: currentWorkspaceEnv(),
      source: "editor",
      workspaceRoot: getLaunchDir() ?? null,
    });
    diskMtimeRef.current = mtime;
    savedRef.current = content;
    // Edits typed while the write was in flight must stay dirty.
    const stillDirty = bufferRef.current !== content;
    setDirty(stillDirty);
    // The buffer is on disk now, so the hot-exit backup has served its purpose.
    if (!stillDirty) void clearDraft(path);
  }, [path]);

  // False when the write was withheld because the file changed on disk since
  // load; overwriting is then an explicit user action from the toast.
  const saveNow = useCallback(async (): Promise<boolean> => {
    if (path === "") return false; // Cannot save an in-memory untitled file.
    const known = diskMtimeRef.current;
    if (known !== null) {
      const stat = await invoke<FileStat>("fs_stat", {
        path,
        workspace: currentWorkspaceEnv(),
      }).catch(() => null);
      if (stat && stat.mtime !== known) {
        const name = path.split(/[\\/]/).pop() ?? path;
        toast.warning("File changed on disk", {
          id: `save-conflict:${path}`,
          description: `${name} was modified by another program while you had unsaved changes. Overwrite to keep your version.`,
          action: { label: "Overwrite", onClick: () => void writeToDisk() },
        });
        return false;
      }
    }
    await writeToDisk();
    return true;
  }, [path, writeToDisk]);

  // Notify parent of dirty transitions.
  const onDirtyChangeRef = useRef(onDirtyChange);
  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  }, [onDirtyChange]);
  useEffect(() => {
    onDirtyChangeRef.current?.(dirty);
  }, [dirty]);

  // Load on path change or explicit reload.
  useEffect(() => {
    let cancelled = false;

    if (path === "") {
      setDoc({ status: "ready", content: "", size: 0 });
      setDirty(false);
      bufferRef.current = "";
      savedRef.current = "";
      eolRef.current = "\n";
      diskMtimeRef.current = null;
      return;
    }

    setDoc({ status: "loading" });
    setDirty(false);

    invoke<ReadResult>("fs_read_file", {
      path,
      workspace: currentWorkspaceEnv(),
      force: forcedPathRef.current === path,
    })
      .then(async (res) => {
        if (cancelled) return;
        if (res.kind === "text") {
          eolRef.current = detectEol(res.content);
          diskMtimeRef.current = res.mtime;
          const content = normalizeToLf(res.content);
          savedRef.current = content;

          // Hot exit: a backed-up buffer from a previous session wins over disk.
          const draft = await loadDraft(path);
          if (cancelled) return;
          const hasDraft = draft !== null && draft.text !== content;
          const restored = hasDraft ? draft.text : content;
          // The file changed on disk since the draft was taken. Hand the old
          // mtime back so saving trips the existing conflict prompt rather than
          // silently overwriting whatever else changed it.
          if (
            hasDraft &&
            draft.mtime !== null &&
            draft.mtime !== res.mtime
          ) {
            diskMtimeRef.current = draft.mtime;
          }

          bufferRef.current = restored;
          setDirty(restored !== content);
          setDoc({
            status: "ready",
            content: restored,
            size: res.size,
          });
        } else if (res.kind === "binary") {
          setDoc({ status: "binary", size: res.size });
        } else if (res.kind === "toolarge") {
          setDoc({
            status: "toolarge",
            size: res.size,
            limit: res.limit,
          });
        }
      })
      .catch((e) => {
        if (!cancelled) setDoc({ status: "error", message: String(e) });
      });

    return () => {
      cancelled = true;
    };
  }, [path, reloadCounter]);

  /** Re-read the file from disk. No-op (silent) if the buffer is dirty —
   *  callers shouldn't clobber unsaved user edits. Returns whether reload ran. */
  const reload = useCallback((): boolean => {
    if (dirtyRef.current || path === "") return false;
    invoke<ReadResult>("fs_read_file", {
      path,
      workspace: currentWorkspaceEnv(),
      force: forcedPathRef.current === path,
    })
      .then((res) => {
        // Re-check dirty: typing can start while the read is in flight, and the
        // reload must never clobber those fresh edits. Compare in LF space.
        if (dirtyRef.current) return;
        if (res.kind === "text" && normalizeToLf(res.content) !== savedRef.current) {
          setReloadCounter((n) => n + 1);
        }
      })
      .catch(() => {});
    return true;
  }, [path]);

  // Re-read a too-large file past the normal limit. Bound to this path, so a
  // later reload keeps honoring the choice while a file switch clears it.
  const openAnyway = useCallback(() => {
    forcedPathRef.current = path;
    setReloadCounter((n) => n + 1);
  }, [path]);

  const save = useCallback(async (): Promise<boolean> => {
    clearAutoSaveTimer();
    if (bufferRef.current === savedRef.current) return true;
    return saveNow();
  }, [clearAutoSaveTimer, saveNow]);

  // Adopt externally formatted disk content as the new saved baseline before
  // the matching editor dispatch lands, so the buffer never flashes dirty. The
  // formatter's own write becomes the known mtime, or the next save would
  // report it as an external conflict. Returns the LF text to dispatch.
  const adoptDiskText = useCallback(
    (diskText: string, mtime: number): string => {
      eolRef.current = detectEol(diskText);
      diskMtimeRef.current = mtime;
      const content = normalizeToLf(diskText);
      savedRef.current = content;
      setDirty(bufferRef.current !== content);
      return content;
    },
    [],
  );

  // Hot-exit backup, debounced separately from autosave: autosave may be off
  // entirely, and the backup still has to keep up with typing.
  const backupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleBackup = useCallback(() => {
    if (backupTimerRef.current) clearTimeout(backupTimerRef.current);
    backupTimerRef.current = setTimeout(() => {
      backupTimerRef.current = null;
      const buffer = bufferRef.current;
      if (shouldBackup(buffer, savedRef.current)) {
        void saveDraft(path, buffer, diskMtimeRef.current);
      } else {
        void clearDraft(path);
      }
    }, BACKUP_DEBOUNCE_MS);
  }, [path]);

  // Flush a pending backup when the tab unmounts or the path changes, so
  // closing a dirty editor never races the debounce.
  useEffect(() => {
    return () => {
      if (!backupTimerRef.current) return;
      clearTimeout(backupTimerRef.current);
      backupTimerRef.current = null;
      const buffer = bufferRef.current;
      if (shouldBackup(buffer, savedRef.current)) {
        void saveDraft(path, buffer, diskMtimeRef.current);
      }
    };
  }, [path]);

  const onChange = useCallback(
    (next: string) => {
      bufferRef.current = next;
      const isDirty = next !== savedRef.current;
      setDirty(isDirty);
      scheduleBackup();

      clearAutoSaveTimer();

      const { autoSave: active, autoSaveDelay: delay } = autoSaveRef.current;
      if (active && isDirty) {
        timeoutRef.current = setTimeout(() => {
          saveNow().catch((e) => console.error("[autosave]", e));
        }, delay);
      }
    },
    [clearAutoSaveTimer, saveNow, scheduleBackup],
  );

  useEffect(() => clearAutoSaveTimer, [path, clearAutoSaveTimer]);

  return { doc, dirty, onChange, save, reload, openAnyway, adoptDiskText };
}
