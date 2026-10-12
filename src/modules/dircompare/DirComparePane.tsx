// gear-dircmp://: two folders side by side — what exists on one side only, what
// differs, what is identical. Open a file diff, or copy a file across.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import { app } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import { openCompare } from "@/modules/compare/CompareDialog";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { inputBox } from "@/modules/quick-pick";
import { formatBytes, toolPaneHandle, toolsNative, type CompareEntry } from "@/modules/tools/paneHandle";
import { counts, DEFAULT_SKIP, foldOneSided, joinPath, parentDirs, parseSkip, visible, type Filter } from "./model";

export const DIRCMP_PATH = "gear-dircmp://Folder compare";

interface State {
  left: string;
  right: string;
  skip: string;
  entries: CompareEntry[];
  truncated: boolean;
  busy: boolean;
  error: string | null;
  ran: boolean;
}

export const useDirCompare = create<State>(() => ({ left: "", right: "", skip: DEFAULT_SKIP.join(", "), entries: [], truncated: false, busy: false, error: null, ran: false }));

export async function runCompare(): Promise<void> {
  const { left, right, skip } = useDirCompare.getState();
  if (!left.trim() || !right.trim()) return void useDirCompare.setState({ error: "Enter both folders." });
  useDirCompare.setState({ busy: true, error: null });
  try {
    const r = await toolsNative.compareDirs(left.trim(), right.trim(), parseSkip(skip));
    useDirCompare.setState({ entries: r.entries, truncated: r.truncated, busy: false, ran: true });
  } catch (err) {
    useDirCompare.setState({ busy: false, error: String(err), entries: [], ran: true });
  }
}

export async function openDirCompare(): Promise<void> {
  const root = app().workspaceRoot() ?? "";
  const s = useDirCompare.getState();
  const left = await inputBox({ title: "Compare folders — left folder", value: s.left || root, placeholder: "Path of the first folder" });
  if (!left) return;
  const right = await inputBox({ title: "Compare folders — right folder", value: s.right, placeholder: "Path of the second folder" });
  if (!right) return;
  useDirCompare.setState({ left, right });
  app().openFile(DIRCMP_PATH);
  await runCompare();
}

async function copyAcross(entry: CompareEntry, from: string, to: string): Promise<void> {
  try {
    for (const dir of parentDirs(to, entry.rel)) await native.createDir(dir).catch(() => {});
    const bytes = await toolsNative.readBytes(joinPath(from, entry.rel));
    if (bytes.truncated) throw new Error("file is too large to copy from here");
    await toolsNative.writeBytes(joinPath(to, entry.rel), bytes.data);
    toast.success(`Copied ${entry.rel}`);
    await runCompare();
  } catch (err) {
    toast.error(`Could not copy ${entry.rel}: ${String(err)}`);
  }
}

async function showDiff(entry: CompareEntry, left: string, right: string): Promise<void> {
  const [l, r] = await Promise.all([native.readFile(joinPath(left, entry.rel)), native.readFile(joinPath(right, entry.rel))]);
  if (l.kind !== "text" || r.kind !== "text") return void toast.info("One of the two files is binary or too large to show as text.");
  openCompare({ title: entry.rel, originalLabel: left, modifiedLabel: right, original: l.content, modified: r.content, languageHint: entry.rel });
}

const STATUS: Record<CompareEntry["status"], { label: string; cls: string }> = {
  left: { label: "only left", cls: "bg-sky-500/15 text-sky-600" },
  right: { label: "only right", cls: "bg-violet-500/15 text-violet-600" },
  different: { label: "different", cls: "bg-amber-500/15 text-amber-600" },
  same: { label: "same", cls: "bg-muted text-muted-foreground" },
};

const FILTERS: { id: Filter; label: string }[] = [
  { id: "changes", label: "Differences" },
  { id: "different", label: "Different" },
  { id: "left", label: "Only left" },
  { id: "right", label: "Only right" },
  { id: "same", label: "Same" },
  { id: "all", label: "All" },
];

const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";
const field = "min-w-0 flex-1 rounded border border-border/60 bg-background px-2 py-1 font-mono text-[12px] outline-none focus:border-ring";

export const DirComparePane = forwardRef<EditorPaneHandle, { path: string }>(function DirComparePane({ path }, ref) {
  const s = useDirCompare();
  const [filter, setFilter] = useState<Filter>("changes");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(500);

  useImperativeHandle(ref, () => toolPaneHandle(path, { setQuery, clearQuery: () => setQuery(""), reload: () => (void runCompare(), true) }), [path]);

  const folded = useMemo(() => foldOneSided(s.entries), [s.entries]);
  const n = useMemo(() => counts(s.entries), [s.entries]);
  const rows = useMemo(() => visible(folded, filter, query), [folded, filter, query]);
  useEffect(() => setLimit(500), [filter, query, s.entries]);

  const swap = useCallback(() => {
    useDirCompare.setState({ left: s.right, right: s.left });
    if (s.ran) void runCompare();
  }, [s.left, s.right, s.ran]);

  return (
    <div className="flex h-full flex-col text-[12.5px]">
      <div className="space-y-1.5 border-b border-border/60 p-2">
        <div className="flex items-center gap-1.5">
          <input className={field} value={s.left} placeholder="Left folder" spellCheck={false} onChange={(e) => useDirCompare.setState({ left: e.target.value })} onKeyDown={(e) => e.key === "Enter" && void runCompare()} />
          <button type="button" className={btn} title="Swap sides" onClick={swap}>
            ⇄
          </button>
          <input className={field} value={s.right} placeholder="Right folder" spellCheck={false} onChange={(e) => useDirCompare.setState({ right: e.target.value })} onKeyDown={(e) => e.key === "Enter" && void runCompare()} />
          <button type="button" className={cn(btn, "bg-primary/10")} disabled={s.busy} onClick={() => void runCompare()}>
            {s.busy ? "Comparing…" : "Compare"}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground">Skip</span>
          <input className={cn(field, "max-w-[340px]")} value={s.skip} spellCheck={false} title="Folder or file names to leave out" onChange={(e) => useDirCompare.setState({ skip: e.target.value })} />
          <span className="mx-1 h-4 w-px bg-border" />
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className={cn(btn, filter === f.id && "bg-muted font-medium")} onClick={() => setFilter(f.id)}>
              {f.label}
              {f.id !== "all" && f.id !== "changes" ? ` ${n[f.id]}` : f.id === "changes" ? ` ${n.left + n.right + n.different}` : ""}
            </button>
          ))}
          <input className={cn(field, "max-w-[200px]")} value={query} placeholder="Filter by path" onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>
      {s.error && <div className="border-b border-border/60 bg-red-500/10 px-3 py-1.5 text-red-500">{s.error}</div>}
      {s.truncated && <div className="border-b border-border/60 bg-amber-500/10 px-3 py-1 text-amber-600">Too many entries — only the first 50,000 on each side were compared.</div>}
      <div className="min-h-0 flex-1 overflow-auto">
        {!s.ran && !s.busy ? (
          <div className="p-6 text-muted-foreground">Enter two folders and press Compare. Files are compared by size, then by content.</div>
        ) : s.ran && !s.busy && rows.length === 0 && !s.error ? (
          <div className="p-6 text-muted-foreground">{s.entries.length === 0 ? "Both folders are empty." : filter === "changes" ? "The two folders are identical." : "Nothing matches this filter."}</div>
        ) : (
          <table className="w-full border-collapse">
            <tbody>
              {rows.slice(0, limit).map((e) => (
                <tr key={e.rel} className="border-b border-border/30 hover:bg-muted/30">
                  <td className="w-[92px] py-1 pl-3">
                    <span className={cn("rounded px-1.5 text-[10.5px]", STATUS[e.status].cls)}>{STATUS[e.status].label}</span>
                  </td>
                  <td className="px-2 font-mono">
                    {e.rel}
                    {e.dir && <span className="text-muted-foreground">/ (folder)</span>}
                  </td>
                  <td className="px-2 text-right tabular-nums text-muted-foreground">{e.dir || e.left_size === null ? "" : formatBytes(e.left_size)}</td>
                  <td className="px-2 text-right tabular-nums text-muted-foreground">{e.dir || e.right_size === null ? "" : formatBytes(e.right_size)}</td>
                  <td className="whitespace-nowrap px-2 py-0.5 text-right">
                    {!e.dir && e.status === "different" && (
                      <button type="button" className={btn} onClick={() => void showDiff(e, s.left, s.right)}>
                        Diff
                      </button>
                    )}
                    {!e.dir && e.status !== "right" && (
                      <button type="button" className={cn(btn, "ml-1")} title="Open the left file" onClick={() => app().openFile(joinPath(s.left, e.rel))}>
                        Open left
                      </button>
                    )}
                    {!e.dir && e.status !== "left" && (
                      <button type="button" className={cn(btn, "ml-1")} title="Open the right file" onClick={() => app().openFile(joinPath(s.right, e.rel))}>
                        Open right
                      </button>
                    )}
                    {!e.dir && (e.status === "left" || e.status === "different") && (
                      <button type="button" className={cn(btn, "ml-1")} title="Copy the left file over the right one" onClick={() => void copyAcross(e, s.left, s.right)}>
                        Copy →
                      </button>
                    )}
                    {!e.dir && (e.status === "right" || e.status === "different") && (
                      <button type="button" className={cn(btn, "ml-1")} title="Copy the right file over the left one" onClick={() => void copyAcross(e, s.right, s.left)}>
                        ← Copy
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rows.length > limit && (
          <button type="button" className={cn(btn, "m-3")} onClick={() => setLimit((l) => l + 1000)}>
            Show more ({rows.length - limit} hidden)
          </button>
        )}
      </div>
    </div>
  );
});
