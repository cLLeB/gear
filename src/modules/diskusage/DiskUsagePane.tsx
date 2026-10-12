// gear-disk://: where a folder's bytes are. A treemap you can drill into, with
// the same level as a sorted list beside it.

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { app } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { inputBox } from "@/modules/quick-pick";
import { formatBytes, toolPaneHandle, toolsNative, type UsageNode } from "@/modules/tools/paneHandle";
import { hueFor, nodeAt, percent, squarify } from "./model";

export const DISK_PATH = "gear-disk://Disk usage";

interface State {
  root: string;
  tree: UsageNode | null;
  busy: boolean;
  error: string | null;
  trail: string[];
}

export const useDiskUsage = create<State>(() => ({ root: "", tree: null, busy: false, error: null, trail: [] }));

export async function scanDisk(root?: string): Promise<void> {
  const target = (root ?? useDiskUsage.getState().root).trim();
  if (!target) return;
  useDiskUsage.setState({ root: target, busy: true, error: null });
  try {
    const tree = await toolsNative.diskUsage(target);
    useDiskUsage.setState({ tree, busy: false, trail: [] });
  } catch (err) {
    useDiskUsage.setState({ busy: false, error: String(err), tree: null });
  }
}

export function openDiskUsage(): void {
  const root = app().workspaceRoot();
  app().openFile(DISK_PATH);
  if (root) void scanDisk(root);
}

export async function openDiskUsageFor(): Promise<void> {
  const v = await inputBox({ title: "Disk usage of which folder?", value: useDiskUsage.getState().root || (app().workspaceRoot() ?? ""), placeholder: "Folder path" });
  if (!v) return;
  app().openFile(DISK_PATH);
  await scanDisk(v);
}

function sep(root: string): string {
  return root.includes("\\") && !root.includes("/") ? "\\" : "/";
}

const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";

export const DiskUsagePane = forwardRef<EditorPaneHandle, { path: string }>(function DiskUsagePane({ path }, ref) {
  const { root, tree, busy, error, trail } = useDiskUsage();
  const [query, setQuery] = useState("");
  const [hover, setHover] = useState<UsageNode | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const mapRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => toolPaneHandle(path, { setQuery, clearQuery: () => setQuery(""), reload: () => (void scanDisk(), true) }), [path]);

  useLayoutEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tree]);

  const current = useMemo(() => (tree ? (nodeAt(tree, trail) ?? tree) : null), [tree, trail]);
  useEffect(() => setHover(null), [current]);

  const tiles = useMemo(() => (current ? squarify(current.children, (c) => c.size, { x: 0, y: 0, w: box.w, h: box.h }) : []), [current, box]);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (current?.children ?? []).filter((c) => !q || c.name.toLowerCase().includes(q));
  }, [current, query]);

  const folderPath = (extra: string[] = []) => [root.replace(/[\\/]+$/, ""), ...trail, ...extra].join(sep(root));
  const enter = (c: UsageNode) => {
    if (c.dir && c.children.length) useDiskUsage.setState({ trail: [...trail, c.name] });
    else if (!c.dir && !c.name.startsWith("(")) app().openFile(folderPath([c.name]));
  };

  return (
    <div className="flex h-full flex-col text-[12.5px]">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 p-2">
        <button type="button" className={btn} disabled={!trail.length} onClick={() => useDiskUsage.setState({ trail: trail.slice(0, -1) })}>
          ↑ Up
        </button>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5 font-mono text-[12px]">
          <button type="button" className="rounded px-1 hover:bg-muted" onClick={() => useDiskUsage.setState({ trail: [] })}>
            {root || "No folder"}
          </button>
          {trail.map((name, i) => (
            <span key={`${i}-${name}`} className="flex items-center gap-0.5">
              <span className="text-muted-foreground">/</span>
              <button type="button" className="rounded px-1 hover:bg-muted" onClick={() => useDiskUsage.setState({ trail: trail.slice(0, i + 1) })}>
                {name}
              </button>
            </span>
          ))}
        </div>
        {current && (
          <span className="text-muted-foreground">
            {formatBytes(current.size)} · {current.files.toLocaleString()} files
          </span>
        )}
        <button type="button" className={btn} disabled={!root} onClick={() => app().openTerminal({ cwd: folderPath() })}>
          Terminal here
        </button>
        <button type="button" className={btn} onClick={() => void openDiskUsageFor()}>
          Other folder…
        </button>
        <button type="button" className={cn(btn, "bg-primary/10")} disabled={busy || !root} onClick={() => void scanDisk()}>
          {busy ? "Measuring…" : "Rescan"}
        </button>
      </div>
      {error && <div className="border-b border-border/60 bg-red-500/10 px-3 py-1.5 text-red-500">{error}</div>}
      {!tree ? (
        <div className="p-6 text-muted-foreground">{busy ? "Measuring the folder…" : "Open a workspace, or choose “Other folder…”, to see what takes up the space."}</div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div ref={mapRef} className="relative min-w-0 flex-1 overflow-hidden bg-muted/20" onMouseLeave={() => setHover(null)}>
            {tiles.map((t) => (
              <button
                key={t.item.name}
                type="button"
                data-tile={t.item.name}
                title={`${t.item.name} — ${formatBytes(t.item.size)} (${percent(t.item.size, current?.size ?? 0)})`}
                className="absolute overflow-hidden border border-background/70 p-0.5 text-left text-[11px] leading-tight text-white"
                style={{ left: t.x, top: t.y, width: t.w, height: t.h, background: t.item.dir ? "hsl(215 22% 38%)" : t.item.name.startsWith("(") ? "hsl(0 0% 45%)" : `hsl(${hueFor(t.item.name)} 45% 42%)`, cursor: t.item.dir || !t.item.name.startsWith("(") ? "pointer" : "default" }}
                onMouseEnter={() => setHover(t.item)}
                onClick={() => enter(t.item)}
              >
                {t.w > 46 && t.h > 16 && (
                  <>
                    <span className="block truncate font-medium">{t.item.dir ? `${t.item.name}/` : t.item.name}</span>
                    {t.h > 32 && <span className="block truncate opacity-80">{formatBytes(t.item.size)}</span>}
                  </>
                )}
              </button>
            ))}
            {current && current.children.length === 0 && <div className="p-6 text-muted-foreground">This folder is empty.</div>}
          </div>
          <div className="flex w-[300px] shrink-0 flex-col border-l border-border/60">
            <input className="m-2 rounded border border-border/60 bg-background px-2 py-1 text-[12px] outline-none focus:border-ring" value={query} placeholder="Filter this level" onChange={(e) => setQuery(e.target.value)} />
            <div className="min-h-0 flex-1 overflow-auto">
              {list.map((c) => (
                <button key={c.name} type="button" className={cn("flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-muted/40", hover === c && "bg-muted/60")} onClick={() => enter(c)}>
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{c.dir ? `${c.name}/` : c.name}</span>
                  <span className="w-[42px] text-right tabular-nums text-muted-foreground">{percent(c.size, current?.size ?? 0)}</span>
                  <span className="w-[64px] text-right tabular-nums">{formatBytes(c.size)}</span>
                </button>
              ))}
            </div>
            <div className="border-t border-border/60 px-2 py-1 text-muted-foreground">{hover ? `${hover.name} — ${formatBytes(hover.size)}${hover.dir ? `, ${hover.files.toLocaleString()} files` : ""}` : "Click a folder to go into it; click a file to open it."}</div>
          </div>
        </div>
      )}
    </div>
  );
});
