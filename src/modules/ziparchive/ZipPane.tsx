// gear-zip://<file>: look inside a zip archive (also .jar, .docx, .epub, .vsix…),
// preview its text files and extract one entry or everything.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { toast } from "sonner";
import { app, frontFilePath } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import { openTextViewer } from "@/modules/compare/CompareDialog";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { inputBox } from "@/modules/quick-pick";
import { base64ToBytes, bytesToBase64, formatBytes, toolPaneHandle, toolsNative } from "@/modules/tools/paneHandle";
import { extract, isText, readArchive, safeTarget, totals, treeRows, type Archive, type Entry } from "./zip";

const SCHEME = "gear-zip://";
const ARCHIVE = /\.(zip|jar|war|ear|apk|aab|ipa|docx|xlsx|pptx|odt|ods|odp|epub|vsix|nupkg|whl|crx|xpi|kmz)$/i;
const PREVIEW_CAP = 2 * 1024 * 1024;

export function openZipFor(file: string): void {
  app().openFile(`${SCHEME}${file}`);
}

export async function openZip(): Promise<void> {
  const current = frontFilePath() ?? getActiveEditor()?.path ?? "";
  const file = await inputBox({ title: "Open an archive", value: ARCHIVE.test(current) ? current : "", placeholder: "Path of a .zip, .jar, .docx, .epub, .vsix… file" });
  if (file?.trim()) openZipFor(file.trim());
}

const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";
const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, "");

async function writeEntry(bytes: Uint8Array, entry: Entry, dest: string): Promise<"written" | "skipped"> {
  const target = safeTarget(dest, entry.name);
  if (!target) return "skipped";
  const parts = target.slice(dest.replace(/[\\/]+$/, "").length + 1).split("/");
  let dir = dest.replace(/[\\/]+$/, "");
  await native.createDir(dir).catch(() => {});
  for (const part of parts.slice(0, entry.dir ? parts.length : -1)) {
    dir = `${dir}/${part}`;
    await native.createDir(dir).catch(() => {});
  }
  if (entry.dir) return "written";
  await toolsNative.writeBytes(target, bytesToBase64(await extract(bytes, entry)));
  return "written";
}

export const ZipPane = forwardRef<EditorPaneHandle, { path: string }>(function ZipPane({ path }, ref) {
  const file = path.slice(SCHEME.length);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [archive, setArchive] = useState<Archive | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await toolsNative.readBytes(file);
      if (r.truncated) throw new Error(`This archive is ${formatBytes(r.size)}; archives over 64 MB cannot be opened here.`);
      const data = base64ToBytes(r.data);
      setArchive(readArchive(data));
      setBytes(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [file]);

  useEffect(() => void load(), [load]);
  useImperativeHandle(ref, () => toolPaneHandle(path, { setQuery, clearQuery: () => setQuery(""), reload: () => (void load(), true) }), [path, load]);

  const rows = useMemo(() => (archive ? treeRows(archive.entries, collapsed, query) : []), [archive, collapsed, query]);
  const sum = useMemo(() => (archive ? totals(archive.entries) : null), [archive]);

  const preview = async (entry: Entry) => {
    if (!bytes) return;
    try {
      if (entry.size > PREVIEW_CAP) return void toast.info(`${entry.name} is ${formatBytes(entry.size)} — extract it to look at it.`);
      const data = await extract(bytes, entry);
      if (!isText(data)) return void toast.info("This entry is not text. Extract it to open it with another program.");
      openTextViewer(entry.name, new TextDecoder().decode(data), entry.name);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const extractTo = async (entries: Entry[], what: string) => {
    if (!bytes) return;
    const dest = await inputBox({ title: `Extract ${what} into which folder?`, value: `${dirOf(file)}/${(file.split(/[\\/]/).pop() ?? "archive").replace(/\.[^.]+$/, "")}`.replace(/\\/g, "/") });
    if (!dest?.trim()) return;
    let written = 0;
    let skipped = 0;
    try {
      for (const [i, e] of entries.entries()) {
        if (i % 20 === 0) setBusy(`Extracting ${i + 1} of ${entries.length}…`);
        if ((await writeEntry(bytes, e, dest.trim())) === "written") written += e.dir ? 0 : 1;
        else skipped++;
      }
      toast.success(`Extracted ${written} ${written === 1 ? "file" : "files"}${skipped ? `; ${skipped} skipped because their names point outside the folder` : ""}`);
    } catch (err) {
      toast.error(`Stopped after ${written} files: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  if (error) return <div className="p-6 text-[12.5px] text-red-500">{error}</div>;
  if (!archive || !sum) return <div className="p-6 text-[12.5px] text-muted-foreground">Reading the archive…</div>;

  const toggle = (p: string) => {
    const next = new Set(collapsed);
    if (!next.delete(p)) next.add(p);
    setCollapsed(next);
  };

  return (
    <div className="flex h-full flex-col text-[12.5px]">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 p-2">
        <span className="min-w-0 max-w-[40%] truncate font-mono text-[12px] text-muted-foreground" title={file}>
          {file}
        </span>
        <span className="text-muted-foreground" data-zip-summary>
          {sum.files.toLocaleString()} files · {formatBytes(sum.size)} ({formatBytes(sum.compressedSize)} packed{sum.ratio > 0.005 ? `, ${(sum.ratio * 100).toFixed(0)}% smaller` : ""})
        </span>
        <span className="flex-1" />
        <input className="w-[190px] rounded border border-border/60 bg-background px-2 py-0.5 text-[12px] outline-none focus:border-ring" value={query} placeholder="Filter by name" onChange={(e) => setQuery(e.target.value)} />
        <button type="button" className={btn} onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(rows.filter((r) => r.dir).map((r) => r.path)))}>
          {collapsed.size ? "Expand all" : "Collapse all"}
        </button>
        <button type="button" className={cn(btn, "bg-primary/10")} disabled={busy !== null} onClick={() => void extractTo(archive.entries, "everything")}>
          {busy ?? "Extract all…"}
        </button>
      </div>
      {archive.comment && <div className="border-b border-border/60 px-3 py-1 text-muted-foreground">Comment: {archive.comment}</div>}
      <div className="min-h-0 flex-1 overflow-auto">
        {archive.entries.length === 0 ? (
          <div className="p-6 text-muted-foreground">This archive is empty.</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-muted-foreground">Nothing matches the filter.</div>
        ) : (
          <table className="w-full border-collapse">
            <tbody>
              {rows.map((r) => (
                <tr key={r.path} data-zip-row={r.path} className="border-b border-border/30 hover:bg-muted/30">
                  <td className="py-0.5 pr-2" style={{ paddingLeft: 10 + r.depth * 16 }}>
                    {r.dir ? (
                      <button type="button" className="font-mono" onClick={() => toggle(r.path)}>
                        <span className="inline-block w-3 text-muted-foreground">{collapsed.has(r.path) && !query ? "▸" : "▾"}</span>
                        {r.name}/
                      </button>
                    ) : (
                      <button type="button" className="font-mono hover:underline" title="Preview" onClick={() => r.entry && void preview(r.entry)}>
                        <span className="inline-block w-3" />
                        {r.name}
                      </button>
                    )}
                    {r.entry?.encrypted && <span className="ml-2 rounded bg-amber-500/15 px-1 text-[10.5px] text-amber-600">password</span>}
                  </td>
                  <td className="w-[90px] px-2 text-right tabular-nums">{formatBytes(r.size)}</td>
                  <td className="w-[90px] px-2 text-right tabular-nums text-muted-foreground">{r.dir ? `${r.files} files` : formatBytes(r.compressedSize)}</td>
                  <td className="w-[150px] px-2 text-right tabular-nums text-muted-foreground">{r.entry && !r.dir ? r.entry.modified.toLocaleString() : ""}</td>
                  <td className="w-[80px] px-2 text-right">
                    <button
                      type="button"
                      className={btn}
                      disabled={busy !== null}
                      onClick={() =>
                        void extractTo(
                          archive.entries.filter((e) => (r.dir ? e.name.startsWith(`${r.path}/`) : e.name === r.entry?.name)),
                          r.dir ? `${r.name}/` : r.name,
                        )
                      }
                    >
                      Extract…
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
});

export const ZIP_ACTIONS = [{ id: "zip.open", label: "Archive: Look inside a zip file…", keywords: ["zip", "archive", "jar", "docx", "epub", "vsix", "unzip", "extract", "contents"], run: () => void openZip() }];
