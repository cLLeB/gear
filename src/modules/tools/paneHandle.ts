// The tab host talks to every pane through EditorPaneHandle. Tool panes (disk
// usage, folder compare, the regex workbench…) only implement the few calls
// that mean something for them; this fills in the rest.

import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { currentWorkspaceEnv } from "@/modules/workspace";

/**
 * Writes text to the clipboard. On failure (the window lost focus, the
 * clipboard is locked) it says so, and the returned promise never settles,
 * so a `.then(() => toast.success(…))` after it only runs on success.
 */
export function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text).catch(() => {
    toast.error("Could not copy to the clipboard");
    return new Promise<void>(() => {});
  });
}

export function toolPaneHandle(path: string, impl: Partial<EditorPaneHandle> = {}): EditorPaneHandle {
  return {
    setQuery: () => {},
    findNext: () => {},
    findPrevious: () => {},
    clearQuery: () => {},
    focus: () => {},
    getSelection: () => null,
    getPath: () => path,
    reload: () => false,
    gotoLine: () => {},
    undo: () => {},
    redo: () => {},
    openFindReplace: () => {},
    toggleBlame: () => {},
    save: async () => {},
    ...impl,
  };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export interface UsageNode {
  name: string;
  size: number;
  files: number;
  dir: boolean;
  children: UsageNode[];
}

export interface CompareEntry {
  rel: string;
  status: "left" | "right" | "different" | "same";
  dir: boolean;
  left_size: number | null;
  right_size: number | null;
}

export interface MockRoute {
  method: string;
  path: string;
  status?: number;
  headers?: [string, string][];
  body?: string;
  delayMs?: number;
}

export interface MockRequest {
  seq: number;
  atMs: number;
  method: string;
  path: string;
  query: string;
  headers: [string, string][];
  body: string;
  status: number;
  route: number | null;
}

export const toolsNative = {
  readBytes: (path: string, maxBytes?: number) =>
    invoke<{ data: string; size: number; truncated: boolean }>("fs_read_bytes", { path, maxBytes: maxBytes ?? null, workspace: currentWorkspaceEnv() }),
  writeBytes: (path: string, data: string) => invoke<number>("fs_write_bytes", { path, data, workspace: currentWorkspaceEnv() }),
  diskUsage: (root: string) => invoke<UsageNode>("fs_disk_usage", { root, workspace: currentWorkspaceEnv() }),
  compareDirs: (left: string, right: string, skip: string[]) =>
    invoke<{ entries: CompareEntry[]; truncated: boolean }>("fs_compare_dirs", { left, right, skip, workspace: currentWorkspaceEnv() }),
  mockStart: (port: number, routes: MockRoute[]) => invoke<number>("mock_start", { port, routes }),
  mockSetRoutes: (routes: MockRoute[]) => invoke<void>("mock_set_routes", { routes }),
  mockStop: () => invoke<void>("mock_stop"),
  mockStatus: (since: number) => invoke<{ port: number | null; requests: MockRequest[] }>("mock_status", { since }),
  mockClearLog: () => invoke<void>("mock_clear_log"),
};

export interface BenchSample {
  ms: number;
  status: number;
  bytes: number;
  error: string | null;
  at_ms: number;
}

export const benchNative = {
  run: (args: { url: string; method: string; headers: Record<string, string>; body: string | null; total: number; concurrency: number; timeoutMs: number }) =>
    invoke<{ samples: BenchSample[]; elapsed_ms: number; cancelled: boolean }>("http_bench", args),
  cancel: () => invoke<void>("http_bench_cancel"),
};
