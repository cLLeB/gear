// Folder compare: counting, filtering and folding the flat list the backend returns.

import type { CompareEntry } from "@/modules/tools/paneHandle";

export type Status = CompareEntry["status"];
export type Filter = "changes" | "all" | Status;

export const DEFAULT_SKIP = [".git", "node_modules", "target", "dist", "build", ".venv", "__pycache__", ".DS_Store"];

export function parseSkip(text: string): string[] {
  return [...new Set(text.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean))];
}

export function counts(entries: CompareEntry[]): Record<Status, number> {
  const out: Record<Status, number> = { left: 0, right: 0, different: 0, same: 0 };
  for (const e of entries) if (!e.dir) out[e.status]++;
  return out;
}

/**
 * A folder that exists on one side only stands for everything in it, so its
 * children are dropped: one row instead of a thousand.
 */
export function foldOneSided(entries: CompareEntry[]): CompareEntry[] {
  const folded: string[] = [];
  const out: CompareEntry[] = [];
  for (const e of entries) {
    if (folded.some((f) => e.rel.startsWith(`${f}/`))) continue;
    if (e.dir && (e.status === "left" || e.status === "right")) folded.push(e.rel);
    out.push(e);
  }
  return out;
}

export function visible(entries: CompareEntry[], filter: Filter, query: string): CompareEntry[] {
  const q = query.trim().toLowerCase();
  return entries.filter((e) => {
    if (q && !e.rel.toLowerCase().includes(q)) return false;
    // A folder present on both sides carries no information of its own.
    if (e.dir && e.status !== "left" && e.status !== "right") return false;
    if (filter === "all") return true;
    if (filter === "changes") return e.status !== "same";
    return e.status === filter;
  });
}

/** Joins a root and a relative path with the root's own separator. */
export function joinPath(root: string, rel: string): string {
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${sep}${rel.split("/").join(sep)}`;
}

/** Every missing-folder candidate between `root` and the file at `rel`, shallowest first. */
export function parentDirs(root: string, rel: string): string[] {
  const parts = rel.split("/").slice(0, -1);
  return parts.map((_, i) => joinPath(root, parts.slice(0, i + 1).join("/")));
}
