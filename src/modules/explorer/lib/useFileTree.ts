import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { listenFsChanged, parentDir, watchAdd, watchRemove } from "./watch";

export type DirEntry = {
  name: string;
  kind: "file" | "dir" | "symlink";
  size: number;
  mtime: number;
};

type ChildrenState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; entries: DirEntry[] }
  | { status: "error"; message: string };

type TreeState = Record<string, ChildrenState>;

export type PendingCreate = {
  parentPath: string;
  kind: "file" | "dir";
};

export function joinPath(parent: string, name: string): string {
  if (parent.endsWith("/")) return `${parent}${name}`;
  return `${parent}/${name}`;
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  if (i <= 0) return "/";
  return path.slice(0, i);
}

// LRU cache for expansion state — remembers last 8 expanded dirs per session.
const LRU_SIZE = 8;
const LRU_KEY = "gear-explorer-expanded";

function rememberExpansion(path: string): void {
  try {
    const raw = localStorage.getItem(LRU_KEY);
    const list: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    const next = [path, ...list.filter((p) => p !== path)].slice(0, LRU_SIZE);
    localStorage.setItem(LRU_KEY, JSON.stringify(next));
  } catch {}
}

function recallExpansion(rootPath: string): Set<string> {
  try {
    const raw = localStorage.getItem(LRU_KEY);
    if (!raw) return new Set();
    const list: string[] = JSON.parse(raw) as string[];
    const sep = rootPath.includes("\\") ? "\\" : "/";
    return new Set(
      list.filter(
        (p) => p === rootPath || p.startsWith(rootPath + "/") || p.startsWith(rootPath + sep),
      ),
    );
  } catch {
    return new Set();
  }
}

type Options = {
  onPathRenamed?: (from: string, to: string) => void;
  onPathDeleted?: (path: string) => void;
};

export function useFileTree(rootPath: string | null, options?: Options) {
  const showHidden = usePreferencesStore((s) => s.showHidden);
  const showHiddenRef = useRef(showHidden);
  const [nodes, setNodes] = useState<TreeState>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(
    null,
  );
  const [renaming, setRenaming] = useState<string | null>(null);

  // Track watched dirs to clean up on root change / unmount.
  const watchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    showHiddenRef.current = showHidden;
  }, [showHidden]);

  const fetchChildren = useCallback(async (path: string) => {
    setNodes((s) => ({ ...s, [path]: { status: "loading" } }));
    try {
      const entries = await invoke<DirEntry[]>("fs_read_dir", {
        path,
        showHidden: showHiddenRef.current,
        workspace: currentWorkspaceEnv(),
      });
      const existingNames = new Set(entries.map((e) => e.name));
      const prefix = path.endsWith("/") || path.endsWith("\\") ? path : `${path}/`;
      setNodes((prev) => {
        const next = { ...prev, [path]: { status: "loaded" as const, entries } };
        // Prune stale subtrees for direct children that vanished.
        for (const key of Object.keys(next)) {
          if (key === path || !key.startsWith(prefix)) continue;
          const rel = key.slice(prefix.length);
          const slash = Math.min(
            ...[rel.indexOf("/"), rel.indexOf("\\")].filter((i) => i >= 0),
            rel.length,
          );
          const childName = rel.slice(0, slash);
          if (!existingNames.has(childName)) {
            delete next[key];
          }
        }
        return next;
      });
      setExpanded((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const ep of next) {
          if (ep === path || !ep.startsWith(prefix)) continue;
          const rel = ep.slice(prefix.length);
          const slash = Math.min(
            ...[rel.indexOf("/"), rel.indexOf("\\")].filter((i) => i >= 0),
            rel.length,
          );
          const childName = rel.slice(0, slash);
          if (!existingNames.has(childName)) {
            next.delete(ep);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    } catch (e) {
      setNodes((s) => ({
        ...s,
        [path]: { status: "error", message: String(e) },
      }));
    }
  }, []);

  // Root change → reset state + unwatch everything.
  useEffect(() => {
    const prevWatched = watchedRef.current;
    if (prevWatched.size > 0) {
      watchRemove([...prevWatched]);
      watchedRef.current = new Set();
    }

    if (!rootPath) {
      setNodes({});
      setExpanded(new Set());
      setPendingCreate(null);
      setRenaming(null);
      return;
    }
    setPendingCreate(null);
    setRenaming(null);

    // Restore LRU expansion for this root.
    const recalled = recallExpansion(rootPath);
    setExpanded(recalled.size > 0 ? recalled : new Set());
    setNodes({});

    watchAdd([rootPath]);
    watchedRef.current.add(rootPath);

    void fetchChildren(rootPath);
    // Prefetch recalled dirs in the background.
    for (const dir of recalled) {
      if (dir !== rootPath) {
        watchAdd([dir]);
        watchedRef.current.add(dir);
        void fetchChildren(dir);
      }
    }
  }, [rootPath, fetchChildren]);

  // Unmount cleanup.
  useEffect(() => {
    return () => {
      const watched = watchedRef.current;
      if (watched.size > 0) watchRemove([...watched]);
    };
  }, []);

  useEffect(() => {
    if (!rootPath) return;
    const loadedPaths = Object.entries(nodes)
      .filter(([, state]) => state.status === "loaded")
      .map(([path]) => path);
    for (const path of loadedPaths) void fetchChildren(path);
    // Re-list loaded directories when the visibility preference changes.
    // `nodes` is intentionally omitted so ordinary tree edits don't refetch
    // every expanded directory.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHidden, rootPath, fetchChildren]);

  // FS watcher: refetch dirs when files inside them change.
  useEffect(() => {
    if (!rootPath) return;
    let unlisten: (() => void) | undefined;
    listenFsChanged((paths) => {
      const dirsToRefetch = new Set<string>();
      for (const p of paths) {
        const parent = parentDir(p);
        if (watchedRef.current.has(parent)) {
          dirsToRefetch.add(parent);
        }
      }
      for (const dir of dirsToRefetch) void fetchChildren(dir);
    })
      .then((u) => {
        unlisten = u;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, [rootPath, fetchChildren]);

  const toggle = useCallback(
    (path: string) => {
      setExpanded((curr) => {
        const next = new Set(curr);
        if (next.has(path)) {
          next.delete(path);
          if (watchedRef.current.has(path)) {
            watchRemove([path]);
            watchedRef.current.delete(path);
          }
        } else {
          next.add(path);
          rememberExpansion(path);
          if (!watchedRef.current.has(path)) {
            watchAdd([path]);
            watchedRef.current.add(path);
          }
        }
        return next;
      });
      setNodes((curr) => {
        if (!curr[path] || curr[path].status === "error") {
          void fetchChildren(path);
        }
        return curr;
      });
    },
    [fetchChildren],
  );

  const expand = useCallback(
    (path: string) => {
      setExpanded((curr) => {
        if (curr.has(path)) return curr;
        const next = new Set(curr);
        next.add(path);
        rememberExpansion(path);
        if (!watchedRef.current.has(path)) {
          watchAdd([path]);
          watchedRef.current.add(path);
        }
        return next;
      });
      setNodes((curr) => {
        if (!curr[path]) void fetchChildren(path);
        return curr;
      });
    },
    [fetchChildren],
  );

  const refresh = useCallback(
    (path: string) => {
      void fetchChildren(path);
    },
    [fetchChildren],
  );

  // --- mutations ---

  const beginCreate = useCallback(
    (parentPath: string, kind: "file" | "dir") => {
      setRenaming(null);
      setPendingCreate({ parentPath, kind });
      // Ensure the parent is expanded so the input row is visible.
      if (rootPath && parentPath !== rootPath) {
        setExpanded((curr) => {
          if (curr.has(parentPath)) return curr;
          const next = new Set(curr);
          next.add(parentPath);
          rememberExpansion(parentPath);
          if (!watchedRef.current.has(parentPath)) {
            watchAdd([parentPath]);
            watchedRef.current.add(parentPath);
          }
          return next;
        });
      }
      setNodes((curr) => {
        if (!curr[parentPath]) void fetchChildren(parentPath);
        return curr;
      });
    },
    [rootPath, fetchChildren],
  );

  const cancelCreate = useCallback(() => setPendingCreate(null), []);

  const commitCreate = useCallback(
    async (name: string) => {
      if (!pendingCreate) return;
      const trimmed = name.trim();
      if (!trimmed) {
        setPendingCreate(null);
        return;
      }
      const path = joinPath(pendingCreate.parentPath, trimmed);
      const cmd =
        pendingCreate.kind === "dir" ? "fs_create_dir" : "fs_create_file";
      try {
        await invoke(cmd, { path, workspace: currentWorkspaceEnv() });
        await fetchChildren(pendingCreate.parentPath);
      } catch (e) {
        console.error(`${cmd} failed:`, e);
      } finally {
        setPendingCreate(null);
      }
    },
    [pendingCreate, fetchChildren],
  );

  const beginRename = useCallback((path: string) => {
    setPendingCreate(null);
    setRenaming(path);
  }, []);

  const cancelRename = useCallback(() => setRenaming(null), []);

  const commitRename = useCallback(
    async (newName: string) => {
      if (!renaming) return;
      const trimmed = newName.trim();
      const parent = dirname(renaming);
      const oldName = renaming.slice(parent === "/" ? 1 : parent.length + 1);
      if (!trimmed || trimmed === oldName) {
        setRenaming(null);
        return;
      }
      const to = joinPath(parent, trimmed);
      try {
        await invoke("fs_rename", {
          from: renaming,
          to,
          workspace: currentWorkspaceEnv(),
        });
        options?.onPathRenamed?.(renaming, to);
        await fetchChildren(parent);
      } catch (e) {
        console.error("fs_rename failed:", e);
      } finally {
        setRenaming(null);
      }
    },
    [renaming, fetchChildren, options],
  );

  const deletePath = useCallback(
    async (path: string) => {
      try {
        await invoke("fs_delete", { path, workspace: currentWorkspaceEnv() });
        options?.onPathDeleted?.(path);
        await fetchChildren(dirname(path));
      } catch (e) {
        console.error("fs_delete failed:", e);
      }
    },
    [fetchChildren, options],
  );

  return {
    nodes,
    expanded,
    pendingCreate,
    renaming,
    toggle,
    expand,
    refresh,
    beginCreate,
    cancelCreate,
    commitCreate,
    beginRename,
    cancelRename,
    commitRename,
    deletePath,
    joinPath,
  };
}
