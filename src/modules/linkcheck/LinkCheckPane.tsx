// gear-links://: broken links across the workspace's Markdown — missing
// files, wrong capitalisation, anchors that match no heading, undefined
// references, and (on request) external URLs that are gone or redirect.

import { invoke } from "@tauri-apps/api/core";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { app } from "@/app/appBridge";
import { IS_WINDOWS } from "@/lib/platform";
import { quoteShellArg } from "@/lib/shellQuote";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { toolPaneHandle } from "@/modules/tools/paneHandle";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { anchors, checkFile, curlArgs, judgeUrl, parseCurl, type Link, type Problem, type ProblemKind } from "./model";

export const LINKS_PATH = "gear-links://Links";

export function openLinkCheck(): void {
  app().openFile(LINKS_PATH);
}

const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";
const MD = /\.(md|markdown|mdx)$/i;
const KIND_LABEL: Record<ProblemKind, string> = {
  "missing-file": "Missing file",
  "case-mismatch": "Wrong capitalisation",
  "missing-anchor": "Missing heading",
  "undefined-reference": "Undefined reference",
  outside: "Outside the workspace",
  "broken-url": "Broken URL",
  redirect: "Redirect",
};
const KIND_STYLE: Record<ProblemKind, string> = {
  "missing-file": "bg-red-500/15 text-red-600",
  "case-mismatch": "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  "missing-anchor": "bg-red-500/15 text-red-600",
  "undefined-reference": "bg-red-500/15 text-red-600",
  outside: "bg-muted text-muted-foreground",
  "broken-url": "bg-red-500/15 text-red-600",
  redirect: "bg-sky-500/15 text-sky-600",
};

interface Scan {
  root: string;
  files: number;
  problems: Problem[];
  external: { file: string; link: Link; url: string }[];
}

export const LinkCheckPane = forwardRef<EditorPaneHandle, { path: string }>(function LinkCheckPane({ path }, ref) {
  const [scan, setScan] = useState<Scan | null>(null);
  const [urlProblems, setUrlProblems] = useState<Problem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<ProblemKind>>(new Set(["outside"]));

  const run = useCallback(async () => {
    const root = app().workspaceRoot();
    if (!root) return void setError("Open a folder first.");
    setBusy(true);
    setError(null);
    setUrlProblems(null);
    try {
      setProgress("Listing files…");
      const listed = await invoke<{ files: string[] }>("fs_list_files", { root, limit: 30000, maxDepth: 20, workspace: currentWorkspaceEnv() });
      const files = new Set(listed.files.map((f) => f.replace(/\\/g, "/")));
      const mdFiles = [...files].filter((f) => MD.test(f) && !/(^|\/)(node_modules|vendor|target|dist)\//.test(f)).slice(0, 3000);
      const texts = new Map<string, string>();
      for (let i = 0; i < mdFiles.length; i += 32) {
        setProgress(`Reading Markdown… ${i} / ${mdFiles.length}`);
        await Promise.all(
          mdFiles.slice(i, i + 32).map(async (f) => {
            const r = await native.readFile(`${root.replace(/[\\/]+$/, "")}/${f}`).catch(() => null);
            if (r && r.kind === "text") texts.set(f, r.content);
          }),
        );
      }
      const anchorCache = new Map<string, Set<string>>();
      const ws = {
        files,
        anchorsOf: (p: string) => {
          if (!texts.has(p)) return null;
          if (!anchorCache.has(p)) anchorCache.set(p, anchors(texts.get(p) as string));
          return anchorCache.get(p) as Set<string>;
        },
      };
      const problems: Problem[] = [];
      const external: Scan["external"] = [];
      for (const [file, text] of texts) {
        const r = checkFile(file, text, ws);
        problems.push(...r.problems);
        external.push(...r.external.map((e) => ({ file, ...e })));
      }
      setScan({ root, files: texts.size, problems, external });
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
      setProgress("");
    }
  }, []);

  useEffect(() => void run(), [run]);
  useImperativeHandle(ref, () => toolPaneHandle(path, { reload: () => (void run(), true) }), [path, run]);

  const checkUrls = async () => {
    if (!scan) return;
    setBusy(true);
    const unique = [...new Set(scan.external.map((e) => e.url.replace(/#.*$/, "")))];
    const results = new Map<string, ReturnType<typeof parseCurl>[number]>();
    const curl = IS_WINDOWS ? "curl.exe" : "curl";
    const nul = IS_WINDOWS ? "NUL" : "/dev/null";
    try {
      for (let i = 0; i < unique.length; i += 16) {
        setProgress(`Checking URLs… ${i} / ${unique.length}`);
        const batch = unique.slice(i, i + 16);
        const r = await native.runCommand(`${curl} ${curlArgs(batch, nul).map((a) => quoteShellArg(a)).join(" ")}`, null, 90).catch(() => null);
        if (!r && i === 0) throw new Error("curl is not available on this machine.");
        for (const res of parseCurl(r?.stdout ?? "")) results.set(res.url, res);
        // Servers that refuse HEAD get one GET for the first byte.
        const retry = batch.filter((u) => {
          const s = results.get(u)?.status ?? 0;
          return s === 405 || s === 403 || s === 400 || s === 501 || s === 0;
        });
        if (retry.length) {
          const g = await native.runCommand(`${curl} ${curlArgs(retry, nul, false).map((a) => quoteShellArg(a)).join(" ")}`, null, 90).catch(() => null);
          for (const res of parseCurl(g?.stdout ?? "")) if (res.status && res.status !== 405) results.set(res.url, res);
        }
      }
      const found: Problem[] = [];
      for (const e of scan.external) {
        const res = results.get(e.url.replace(/#.*$/, ""));
        if (!res) continue;
        const v = judgeUrl(res);
        if (v) found.push({ file: e.file, link: e.link, kind: v.kind, message: v.message });
      }
      setUrlProblems(found);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const all = useMemo(() => [...(scan?.problems ?? []), ...(urlProblems ?? [])], [scan, urlProblems]);
  const counts = useMemo(() => {
    const m = new Map<ProblemKind, number>();
    for (const p of all) m.set(p.kind, (m.get(p.kind) ?? 0) + 1);
    return m;
  }, [all]);
  const byFile = useMemo(() => {
    const m = new Map<string, Problem[]>();
    for (const p of all) if (!hidden.has(p.kind)) m.set(p.file, [...(m.get(p.file) ?? []), p]);
    return [...m].sort((a, b) => a[0].localeCompare(b[0]));
  }, [all, hidden]);

  const open = (file: string, line: number, column: number) => scan && app().openFile(`${scan.root.replace(/[\\/]+$/, "")}/${file}`, line, column);

  if (error) return <div className="p-6 text-[12.5px] text-red-500">{error}</div>;
  if (!scan) return <div className="p-6 text-[12.5px] text-muted-foreground">{progress || "Scanning…"}</div>;

  const shown = byFile.reduce((a, [, ps]) => a + ps.length, 0);

  return (
    <div className="flex h-full flex-col text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-2">
        <span className="text-muted-foreground" data-links-summary>
          {scan.files} Markdown files · {scan.external.length} external links · {all.length === 0 ? "no problems" : `${all.length} problem${all.length === 1 ? "" : "s"}`}
        </span>
        <span className="flex-1" />
        <button type="button" className={btn} data-links-urls disabled={busy || !scan.external.length} onClick={() => void checkUrls()} title="Sends a HEAD request to each external URL">
          {urlProblems ? "Check external URLs again" : `Check ${new Set(scan.external.map((e) => e.url.replace(/#.*$/, ""))).size} external URLs`}
        </button>
        <button type="button" className={btn} disabled={busy} onClick={() => void run()}>
          {busy ? progress || "Working…" : "Rescan"}
        </button>
      </div>
      {all.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-border/60 px-2 py-1.5">
          {[...counts].map(([k, n]) => (
            <button key={k} type="button" data-links-kind={k} className={cn("rounded px-1.5 py-0.5 text-[11.5px]", KIND_STYLE[k], hidden.has(k) && "opacity-40 line-through")} onClick={() => setHidden((h) => (h.has(k) ? new Set([...h].filter((x) => x !== k)) : new Set([...h, k])))} title="Show / hide">
              {KIND_LABEL[k]}: {n}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {shown === 0 && <div className="p-2 text-emerald-600" data-links-ok>{all.length ? "Every remaining problem is hidden by the filters above." : urlProblems ? "No broken links, and every external URL answered." : "No broken local links. External URLs have not been checked yet."}</div>}
        {byFile.map(([file, ps]) => (
          <div key={file} className="mb-2" data-links-file={file}>
            <div className="font-medium">{file}</div>
            {ps
              .sort((a, b) => a.link.line - b.link.line)
              .map((p, i) => (
                <button key={i} type="button" className="flex w-full items-baseline gap-2 rounded px-2 py-0.5 text-left hover:bg-muted/50" onClick={() => open(file, p.link.line, p.link.column)} data-links-problem={p.kind}>
                  <span className="w-14 shrink-0 text-right font-mono text-[11px] text-muted-foreground">{p.link.line}:{p.link.column}</span>
                  <span className={cn("shrink-0 rounded px-1 text-[10.5px]", KIND_STYLE[p.kind])}>{KIND_LABEL[p.kind]}</span>
                  <span className="min-w-0 shrink truncate font-mono text-[11.5px]" title={p.link.target}>
                    {p.link.target}
                  </span>
                  <span className="min-w-0 flex-1 text-muted-foreground">{p.message}</span>
                </button>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
});

export const LINKCHECK_ACTIONS = [
  { id: "links.open", label: "Links: Find broken links in the workspace's Markdown", keywords: ["links", "broken links", "dead links", "markdown", "docs", "anchors", "headings", "404", "link checker", "readme"], run: openLinkCheck },
];
