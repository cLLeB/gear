// gear-secrets://: secret scan results for the workspace — the working tree
// and (optionally) everything ever committed. Open a finding (file at the line,
// or the commit's diff), ignore it (by fingerprint or path), install the
// pre-commit hook.

import { invoke } from "@tauri-apps/api/core";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { app } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { installHook, appendIgnore, type Finding } from "./secrets";

export const SECRETS_PATH = "gear-secrets://Secrets";

function Row({ f, root, onIgnored }: { f: Finding; root: string; onIgnored: (wholeFile: boolean) => void }) {
  const open = () => {
    if (f.commit) app().openCommitFileDiff({ repoRoot: root, sha: f.commit, shortSha: f.commit.slice(0, 7), subject: `${f.title} added`, path: f.file, originalPath: null });
    else app().openFile(`${root}/${f.file}`, f.line);
  };
  return (
    <div className="group flex items-start gap-2 border-b border-border/30 px-3 py-1.5 hover:bg-muted/30">
      <div className="min-w-0 flex-1 cursor-pointer" onClick={open}>
        <div className="flex items-center gap-2">
          <span className={cn("rounded px-1 text-[10.5px]", f.inTest ? "bg-muted text-muted-foreground" : f.rule === "generic-secret" ? "bg-amber-500/15 text-amber-600" : "bg-red-500/15 text-red-500")}>{f.title}</span>
          <span className="font-mono text-[11.5px]">{f.masked}</span>
          <span className="text-[11px] text-muted-foreground">line {f.line}</span>
          {f.commit && (
            <span className="text-[11px] text-muted-foreground">
              {f.commit.slice(0, 7)} · {f.author} · {f.date?.slice(0, 10)}
            </span>
          )}
        </div>
        <div className="truncate font-mono text-[11.5px] text-muted-foreground">{f.lineText}</div>
      </div>
      <div className="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100">
        <button type="button" className="rounded px-1.5 py-0.5 text-[11px] hover:bg-muted" title="Not a secret (or already rotated): hide this exact value" onClick={() => void appendIgnore(root, f.fingerprint, `${f.title} in ${f.file}`).then(() => onIgnored(false))}>
          Ignore
        </button>
        <button type="button" className="rounded px-1.5 py-0.5 text-[11px] hover:bg-muted" title="Ignore every finding in this file" onClick={() => void appendIgnore(root, f.file, "whole file").then(() => onIgnored(true))}>
          Ignore file
        </button>
      </div>
    </div>
  );
}

export const SecretsPane = forwardRef<EditorPaneHandle, { path: string }>(function SecretsPane({ path }, ref) {
  const root = app().workspaceRoot()?.replace(/\\/g, "/") ?? null;
  const [history, setHistory] = useState(false);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTests, setShowTests] = useState(false);
  const scan = useCallback(async () => {
    if (!root) return;
    setBusy(true);
    setError(null);
    try {
      setFindings(await invoke<Finding[]>("secrets_scan", { root, history, maxCommits: 5000 }));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [root, history]);
  useEffect(() => {
    void scan();
  }, [scan]);
  useImperativeHandle(
    ref,
    () =>
      ({
        setQuery: () => {},
        findNext: () => {},
        findPrevious: () => {},
        clearQuery: () => {},
        focus: () => {},
        getSelection: () => null,
        getPath: () => path,
        reload: () => (void scan(), true),
        gotoLine: () => {},
        undo: () => {},
        redo: () => {},
        openFindReplace: () => {},
        toggleBlame: () => {},
        save: async () => {},
      }) as EditorPaneHandle,
    [path, scan],
  );
  const groups = useMemo(() => {
    const visible = (findings ?? []).filter((f) => showTests || !f.inTest);
    const by = new Map<string, Finding[]>();
    for (const f of visible) by.set(`${f.commit ? "h" : "t"}:${f.file}`, [...(by.get(`${f.commit ? "h" : "t"}:${f.file}`) ?? []), f]);
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  }, [findings, showTests]);
  const tree = (findings ?? []).filter((f) => !f.commit && !f.inTest).length;
  const hist = (findings ?? []).filter((f) => f.commit && !f.inTest).length;
  const tests = (findings ?? []).filter((f) => f.inTest).length;
  if (!root) return <div className="p-6 text-[12px] text-muted-foreground">Open a folder to scan it.</div>;
  return (
    <div className="flex h-full flex-col text-[12px]">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
        <span className="font-medium">Secret scan</span>
        {findings && (
          <span className={cn("text-[11px]", tree + hist ? "text-red-500" : "text-emerald-600")}>
            {tree + hist ? `${tree} in files${history ? ` · ${hist} only in history` : ""}` : "nothing found"}
          </span>
        )}
        <span className="flex-1" />
        <label className="flex items-center gap-1 text-[11.5px]">
          <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} />
          Include git history
        </label>
        {tests > 0 && (
          <label className="flex items-center gap-1 text-[11.5px] text-muted-foreground">
            <input type="checkbox" checked={showTests} onChange={(e) => setShowTests(e.target.checked)} />
            {tests} in tests / fixtures
          </label>
        )}
        <button type="button" className="rounded px-2 py-0.5 hover:bg-muted" onClick={() => void installHook(root)}>
          Install pre-commit hook
        </button>
        <button type="button" className="rounded px-2 py-0.5 hover:bg-muted" disabled={busy} onClick={() => void scan()}>
          {busy ? "Scanning…" : "Rescan"}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {error && <div className="p-3 text-destructive">{error}</div>}
        {hist > 0 && (
          <div className="m-3 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-[11.5px]">
            Secrets that were ever committed stay in git history even after the file changes. Treat them as leaked: revoke / rotate them at the provider, then rewrite history only if you must.
          </div>
        )}
        {findings && !groups.length && !busy && <div className="p-4 text-muted-foreground">No secrets found{history ? " in the files or the history" : " in the working tree"}. Ignore rules live in .gearsecretsignore.</div>}
        {groups.map(([key, list]) => (
          <div key={key}>
            <div className="sticky top-0 z-10 flex items-center gap-2 bg-background/95 px-3 py-1 text-[11.5px] font-medium backdrop-blur">
              <span>{list[0].file}</span>
              {list[0].commit && <span className="rounded bg-amber-500/15 px-1 text-[10.5px] font-normal text-amber-600">history</span>}
              <span className="font-normal text-muted-foreground">{list.length}</span>
            </div>
            {list.map((f) => (
              <Row key={`${f.fingerprint}-${f.line}-${f.commit ?? ""}`} f={f} root={root} onIgnored={(whole) => setFindings((fs) => fs?.filter((x) => (whole ? x.file !== f.file : x.fingerprint !== f.fingerprint)) ?? null)} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
});

