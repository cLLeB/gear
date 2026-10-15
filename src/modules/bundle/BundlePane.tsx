// gear-bundle://<file.js>: what a built JavaScript bundle is made of. Every
// byte is attributed through the source map to a source file and npm
// package, shown as a treemap with a drill-down list, duplicate packages
// and the gzip size.

import { invoke } from "@tauri-apps/api/core";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { app, frontFilePath } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import { hueFor, squarify } from "@/modules/diskusage/model";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { inputBox, quickPick } from "@/modules/quick-pick";
import { base64ToBytes, copyToClipboard, formatBytes, toolPaneHandle, toolsNative } from "@/modules/tools/paneHandle";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { attribute, duplicates, groupByPackage, mapUrlOf, type Attribution, type Group, type SourceMap } from "./model";

const SCHEME = "gear-bundle://";
const READ_CAP = 64 * 1024 * 1024;
const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";
const BUNDLE = /\.(c|m)?js$/i;

export function openBundleFor(file: string): void {
  app().openFile(`${SCHEME}${file}`);
}

/** Asks for a bundle: the current .js file, or one of the workspace's built files that has a map. */
export async function openBundleAnalyzer(): Promise<void> {
  const current = frontFilePath() ?? getActiveEditor()?.path ?? "";
  const root = app().workspaceRoot();
  const items: { label: string; description?: string; value: string }[] = [];
  if (BUNDLE.test(current)) items.push({ label: current.split(/[\\/]/).pop() ?? current, description: "Current file", value: current });
  if (root) {
    const listed = await invoke<{ files: string[] }>("fs_list_files", { root, limit: 30000, maxDepth: 12, workspace: currentWorkspaceEnv() }).catch(() => ({ files: [] as string[] }));
    const files = new Set(listed.files.map((f) => f.replace(/\\/g, "/")));
    for (const f of files) if (BUNDLE.test(f) && files.has(`${f}.map`) && !/(^|\/)node_modules\//.test(f)) items.push({ label: f, description: "has a source map", value: `${root.replace(/[\\/]+$/, "")}/${f}` });
  }
  items.push({ label: "Other file…", value: "" });
  const pick = items.length > 1 ? await quickPick(items, { title: "Analyze a JavaScript bundle", placeholder: "Built .js files with a source map next to them" }) : "";
  if (pick === undefined) return;
  const file = pick || (await inputBox({ title: "Analyze a JavaScript bundle", value: BUNDLE.test(current) ? current : "", placeholder: "Path to a built .js file with a source map" }))?.trim();
  if (file) openBundleFor(file);
}

interface Loaded {
  file: string;
  mapFrom: string;
  attribution: Attribution;
  groups: Group[];
  dupes: ReturnType<typeof duplicates>;
  gzip: number | null;
  sources: number;
}

async function gzipSize(text: string): Promise<number | null> {
  if (typeof CompressionStream === "undefined") return null;
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return (await new Response(stream).arrayBuffer()).byteLength;
}

async function readText(path: string): Promise<string> {
  const r = await toolsNative.readBytes(path, READ_CAP);
  if (r.truncated) throw new Error(`${path.split(/[\\/]/).pop()} is ${formatBytes(r.size)}; files over ${formatBytes(READ_CAP)} are not read.`);
  return new TextDecoder().decode(base64ToBytes(r.data));
}

const pct = (n: number, total: number) => (total ? `${((n / total) * 100).toFixed(n / total < 0.01 ? 2 : 1)}%` : "—");

export const BundlePane = forwardRef<EditorPaneHandle, { path: string }>(function BundlePane({ path }, ref) {
  const file = path.startsWith(SCHEME) ? path.slice(SCHEME.length) : path;
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [box, setBox] = useState({ w: 0, h: 0 });
  const mapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const code = await readText(file);
      const where = mapUrlOf(code, file);
      let json: string;
      let mapFrom: string;
      if (where.kind === "inline") {
        json = where.json;
        mapFrom = "inline source map";
      } else {
        json = await readText(where.path).catch(() => {
          throw new Error(`No source map found for this file (looked for ${where.path.split(/[\\/]/).pop()}). Build with source maps on, e.g. build.sourcemap in Vite or devtool: "source-map" in webpack.`);
        });
        mapFrom = where.path;
      }
      let map: SourceMap;
      try {
        map = JSON.parse(json) as SourceMap;
      } catch {
        throw new Error("The source map is not valid JSON.");
      }
      if (!map.sections && (!Array.isArray(map.sources) || typeof map.mappings !== "string")) throw new Error("This JSON is not a source map (no sources or mappings).");
      const attribution = attribute(code, map);
      setData({ file, mapFrom, attribution, groups: groupByPackage(attribution), dupes: duplicates(attribution), gzip: await gzipSize(code), sources: attribution.bySource.size });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [file]);
  useEffect(() => void load(), [load]);

  useImperativeHandle(
    ref,
    () => toolPaneHandle(path, { setQuery, clearQuery: () => setQuery(""), reload: () => (void load(), true) }),
    [path, load],
  );

  useLayoutEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);

  const current = useMemo(() => data?.groups.find((g) => g.name === group) ?? null, [data, group]);
  const items = useMemo(() => {
    if (!data) return [];
    const base = current ? current.files.map((f) => ({ name: f.path, bytes: f.bytes, files: 1 })) : [...data.groups.map((g) => ({ name: g.name, bytes: g.bytes, files: g.files.length })), ...(data.attribution.unmapped ? [{ name: "(unmapped)", bytes: data.attribution.unmapped, files: 0 }] : [])];
    return base;
  }, [data, current]);
  const tiles = useMemo(() => squarify(items, (i) => i.bytes, { x: 0, y: 0, w: box.w, h: box.h }), [items, box]);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => !q || i.name.toLowerCase().includes(q));
  }, [items, query]);

  const scope = current ? current.bytes : (data?.attribution.total ?? 0);

  const openSource = async (p: string) => {
    const root = app().workspaceRoot();
    const dir = file.replace(/[\\/][^\\/]*$/, "");
    const candidates = [root && `${root.replace(/[\\/]+$/, "")}/${p}`, `${dir}/${p}`].filter(Boolean) as string[];
    for (const c of candidates) {
      const ok = await toolsNative.readBytes(c, 1).then(
        () => true,
        () => false,
      );
      if (ok) return app().openFile(c);
    }
    toast.error(`${p} is not in the workspace`);
  };

  const report = () => {
    if (!data) return;
    const t = data.attribution.total;
    const lines = [`# Bundle: ${data.file.split(/[\\/]/).pop()}`, "", `${formatBytes(t)} minified${data.gzip !== null ? `, ${formatBytes(data.gzip)} gzipped` : ""}; ${data.sources} source files; ${pct(data.attribution.unmapped, t)} unmapped.`, "", "| Package | Size | Share |", "|---|---:|---:|"];
    for (const g of data.groups.slice(0, 40)) lines.push(`| ${g.name}${g.versions.length ? ` (${g.versions.join(", ")})` : ""} | ${formatBytes(g.bytes)} | ${pct(g.bytes, t)} |`);
    if (data.dupes.length) {
      lines.push("", "## Bundled more than once", "");
      for (const d of data.dupes) lines.push(`- ${d.name}: ${d.copies.join(", ")} — ${formatBytes(d.bytes)} extra`);
    }
    void copyToClipboard(lines.join("\n")).then(() => toast.success("Report copied as Markdown"));
  };

  if (error) return <div className="p-6 text-[12.5px] text-red-500" data-bundle-error>{error}</div>;
  if (!data) return <div className="p-6 text-[12.5px] text-muted-foreground">Reading the bundle and its source map…</div>;

  const t = data.attribution.total;
  const own = data.groups.filter((g) => g.name.startsWith("(your code)")).reduce((a, g) => a + g.bytes, 0);
  const deps = data.groups.filter((g) => !g.name.startsWith("(your code)")).reduce((a, g) => a + g.bytes, 0);

  return (
    <div className="flex h-full flex-col text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-2">
        <span className="font-medium">{data.file.split(/[\\/]/).pop()}</span>
        <span className="text-muted-foreground" data-bundle-summary>
          {formatBytes(t)}
          {data.gzip !== null && ` · ${formatBytes(data.gzip)} gzipped`} · packages {pct(deps, t)} · your code {pct(own, t)} · unmapped {pct(data.attribution.unmapped, t)}
        </span>
        <span className="flex-1" />
        <input className="w-44 rounded border border-border/60 bg-transparent px-2 py-0.5 text-[12px]" placeholder="Filter…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="button" className={btn} onClick={report}>
          Copy report
        </button>
        <button type="button" className={btn} onClick={() => void openBundleAnalyzer()}>
          Other bundle…
        </button>
        <button type="button" className={btn} onClick={() => void load()}>
          Reload
        </button>
      </div>
      {data.dupes.length > 0 && (
        <div className="border-b border-border/60 bg-amber-500/10 px-3 py-1.5" data-bundle-dupes>
          <span className="font-medium text-amber-700 dark:text-amber-400">Bundled more than once: </span>
          {data.dupes.map((d, i) => (
            <span key={d.name}>
              {i > 0 && " · "}
              <button type="button" className="underline decoration-dotted" onClick={() => setGroup(d.name)}>
                {d.name}
              </button>{" "}
              ({d.copies.join(", ")}, {formatBytes(d.bytes)} extra)
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1 border-b border-border/60 px-2 py-1 font-mono text-[12px]">
        <button type="button" className="rounded px-1 hover:bg-muted" onClick={() => setGroup(null)}>
          All packages
        </button>
        {current && (
          <>
            <span className="text-muted-foreground">/</span>
            <span className="px-1">{current.name}</span>
            {current.versions.length > 0 && <span className="text-muted-foreground">{current.versions.join(", ")}</span>}
            <span className="text-muted-foreground">
              · {formatBytes(current.bytes)} ({pct(current.bytes, t)}) · {current.files.length} files
            </span>
          </>
        )}
        <span className="flex-1" />
        <span className="truncate text-[11px] text-muted-foreground" title={data.mapFrom}>
          map: {data.mapFrom.split(/[\\/]/).pop()}
        </span>
      </div>
      <div className="flex min-h-0 flex-1">
        <div ref={mapRef} className="relative min-w-0 flex-[3] overflow-hidden bg-muted/20">
          {tiles.map((tile) => {
            const isGroup = !current && tile.item.name !== "(unmapped)";
            const label = current ? tile.item.name.split("/").pop() : tile.item.name.replace(/^\(your code\) /, "▸ ");
            return (
              <button
                key={tile.item.name}
                type="button"
                data-bundle-tile={tile.item.name}
                title={`${tile.item.name} — ${formatBytes(tile.item.bytes)} (${pct(tile.item.bytes, t)})`}
                className="absolute overflow-hidden border border-background/70 p-0.5 text-left text-[11px] leading-tight text-white"
                style={{
                  left: tile.x,
                  top: tile.y,
                  width: tile.w,
                  height: tile.h,
                  background: tile.item.name === "(unmapped)" ? "hsl(0 0% 45%)" : tile.item.name.startsWith("(your code)") ? "hsl(215 30% 40%)" : `hsl(${hueFor(current ? tile.item.name.replace(/.*\./, "x.") + current.name : `${tile.item.name}.`)} 45% 40%)`,
                }}
                onClick={() => (isGroup ? setGroup(tile.item.name) : current && void openSource(tile.item.name))}
              >
                {tile.w > 40 && tile.h > 14 && (
                  <>
                    <div className="truncate font-medium">{label}</div>
                    {tile.h > 28 && <div className="truncate opacity-80">{formatBytes(tile.item.bytes)}</div>}
                  </>
                )}
              </button>
            );
          })}
        </div>
        <div className="min-w-0 flex-[2] overflow-auto border-l border-border/60">
          <table className="w-full">
            <tbody>
              {list.map((i) => (
                <tr
                  key={i.name}
                  className={cn("cursor-pointer hover:bg-muted/50", i.name === "(unmapped)" && "cursor-default")}
                  data-bundle-row={i.name}
                  onClick={() => (current ? void openSource(i.name) : i.name !== "(unmapped)" && setGroup(i.name))}
                >
                  <td className="max-w-0 truncate px-2 py-0.5 font-mono text-[11.5px]" title={i.name}>
                    {i.name}
                    {!current && (data.groups.find((g) => g.name === i.name)?.versions.length ?? 0) > 1 && <span className="ml-1 rounded bg-amber-500/15 px-1 text-[10px] text-amber-700">×{data.groups.find((g) => g.name === i.name)?.versions.length}</span>}
                  </td>
                  <td className="w-20 whitespace-nowrap px-2 text-right tabular-nums">{formatBytes(i.bytes)}</td>
                  <td className="w-24 px-2">
                    <div className="h-1.5 rounded bg-muted">
                      <div className="h-1.5 rounded bg-primary/70" style={{ width: `${Math.min(100, (i.bytes / (scope || 1)) * 100)}%` }} />
                    </div>
                  </td>
                  <td className="w-14 whitespace-nowrap px-2 text-right text-[11px] text-muted-foreground tabular-nums">{pct(i.bytes, scope)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length === 0 && <div className="p-3 text-muted-foreground">Nothing matches the filter.</div>}
        </div>
      </div>
    </div>
  );
});

export const BUNDLE_ACTIONS = [
  { id: "bundle.open", label: "Bundle: Analyze what a JavaScript bundle is made of…", keywords: ["bundle", "source map", "size", "treemap", "webpack", "vite", "rollup", "esbuild", "bundle size", "analyzer", "duplicates"], run: () => void openBundleAnalyzer() },
];
