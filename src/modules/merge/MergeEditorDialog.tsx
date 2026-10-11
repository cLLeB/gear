// A three-way merge editor: "ours" on the left, the editable result in the
// middle, "theirs" on the right. Each conflict gets accept buttons on both
// sides and the inline lens in the result; non-conflicting changes from either
// side are already applied. Saving writes the file and stages it, and when the
// last conflict of a merge / rebase / cherry-pick is resolved it offers to
// continue the operation.

import { RangeSetBuilder, StateField, type Extension, type EditorState } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { app } from "@/app/appBridge";
import { native } from "@/modules/ai/lib/native";
import { conflictLens } from "@/modules/editor/lib/conflictLens";
import { buildSharedExtensions } from "@/modules/editor/lib/extensions";
import { resolveLanguageSync } from "@/modules/editor/lib/languageResolver";
import { parseConflicts } from "@/modules/editor/lib/textTools/conflicts";
import { EDITOR_THEME_EXT } from "@/modules/editor/lib/themes";
import { git } from "@/modules/git-actions/gitCli";
import { notifyGitChanged } from "@/modules/git-actions/partialApply";
import { confirmPick } from "@/modules/quick-pick";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { mergeRegions, operationFrom, regionSpans, renderResult, sidesFromMarkers, type Choice, type Region } from "./mergeModel";

export interface MergeRequest {
  absPath: string;
  /** Repo-relative path, when the file is an unmerged git path. */
  repoRoot: string | null;
  relPath: string | null;
  base: string;
  ours: string;
  theirs: string;
  oursLabel: string;
  theirsLabel: string;
  operation: ReturnType<typeof operationFrom>;
  eol: string;
}

export const useMergeStore = create<{ request: MergeRequest | null }>(() => ({ request: null }));

async function gitDirEntries(repoRoot: string): Promise<Set<string>> {
  const gd = (await git(repoRoot, ["rev-parse", "--absolute-git-dir"])).stdout.trim();
  const names = (await native.readDir(gd).catch(() => [])).map((e) => e.name);
  return new Set(names);
}

/** Open the merge editor for a file: git's conflict stages when available, else its conflict markers. */
export async function openMergeEditor(absPath: string): Promise<void> {
  const path = absPath.replace(/\\/g, "/");
  const file = await native.readFile(path).catch(() => null);
  const current = file?.kind === "text" ? file.content : "";
  const eol = current.includes("\r\n") ? "\r\n" : "\n";
  const repo = await native.gitResolveRepo(path.replace(/\/[^/]*$/, "")).catch(() => null);
  if (repo) {
    const root = repo.repoRoot.replace(/\\/g, "/").replace(/\/+$/, "");
    const rel = path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
    const [b, o, t] = await Promise.all([1, 2, 3].map((n) => git(root, ["show", `:${n}:${rel}`])));
    if (o.ok && t.ok) {
      const op = operationFrom(await gitDirEntries(root));
      const branch = (await git(root, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
      let theirsName = "incoming";
      if (op === "merge") theirsName = (await git(root, ["name-rev", "--name-only", "--exclude=tags/*", "MERGE_HEAD"])).stdout.trim() || "MERGE_HEAD";
      if (op === "cherry-pick") theirsName = `cherry-pick ${(await git(root, ["log", "-1", "--format=%h %s", "CHERRY_PICK_HEAD"])).stdout.trim()}`;
      if (op === "revert") theirsName = "revert";
      if (op === "rebase") theirsName = `your commit ${(await git(root, ["log", "-1", "--format=%h %s", "REBASE_HEAD"])).stdout.trim()}`;
      useMergeStore.setState({
        request: {
          absPath: path,
          repoRoot: root,
          relPath: rel,
          base: b.ok ? b.stdout : "",
          ours: o.stdout,
          theirs: t.stdout,
          // During a rebase "ours" is the branch being rebased onto.
          oursLabel: op === "rebase" ? `onto ${branch === "HEAD" ? "upstream" : branch}` : branch === "HEAD" ? "HEAD" : `${branch} (current)`,
          theirsLabel: theirsName,
          operation: op,
          eol,
        },
      });
      return;
    }
  }
  const sides = sidesFromMarkers(current);
  if (!sides) return void toast.info("This file has no merge conflicts");
  useMergeStore.setState({
    request: { absPath: path, repoRoot: null, relPath: null, base: sides.base, ours: sides.ours, theirs: sides.theirs, oursLabel: "current", theirsLabel: "incoming", operation: null, eol },
  });
}

// ── side panes ────────────────────────────────────────────────────────────

class AcceptWidget extends WidgetType {
  constructor(
    readonly side: "ours" | "theirs",
    readonly k: number,
    readonly onAccept: (k: number, c: Choice) => void,
  ) {
    super();
  }
  eq(o: AcceptWidget) {
    return o.k === this.k && o.side === this.side;
  }
  toDOM() {
    const row = document.createElement("div");
    row.className = "cm-merge-accept";
    const btn = (label: string, c: Choice, title: string) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.title = title;
      b.onmousedown = (e) => {
        e.preventDefault();
        this.onAccept(this.k, c);
      };
      row.appendChild(b);
    };
    if (this.side === "ours") {
      btn("Accept ours ≫", "ours", "Use this side for the conflict");
      btn("Ours + theirs", "ours+theirs", "Both, ours first");
    } else {
      btn("≪ Accept theirs", "theirs", "Use this side for the conflict");
      btn("Theirs + ours", "theirs+ours", "Both, theirs first");
    }
    const tag = document.createElement("span");
    tag.textContent = `conflict ${this.k + 1}`;
    row.appendChild(tag);
    return row;
  }
  ignoreEvent() {
    return true;
  }
}

const conflictLine = Decoration.line({ class: "cm-merge-conflict" });
const changedLine = Decoration.line({ class: "cm-merge-changed" });

function sideDecorations(state: EditorState, spans: ReturnType<typeof regionSpans>, side: "ours" | "theirs", onAccept: (k: number, c: Choice) => void): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const doc = state.doc;
  for (const s of spans) {
    const [from, to] = s[side];
    const changedHere = s.who === "conflict" || s.who === "both" || s.who === side;
    const anchorLine = Math.min(from + 1, doc.lines);
    const at = doc.line(anchorLine).from;
    if (s.who === "conflict") b.add(at, at, Decoration.widget({ widget: new AcceptWidget(side, s.conflictIndex, onAccept), block: true, side: -1 }));
    if (changedHere) for (let l = from + 1; l <= Math.min(to, doc.lines); l++) b.add(doc.line(l).from, doc.line(l).from, s.who === "conflict" ? conflictLine : changedLine);
  }
  return b.finish();
}

function sideExtension(spans: ReturnType<typeof regionSpans>, side: "ours" | "theirs", onAccept: (k: number, c: Choice) => void): Extension {
  return StateField.define<DecorationSet>({
    create: (s) => sideDecorations(s, spans, side, onAccept),
    update: (v) => v,
    provide: (f) => EditorView.decorations.from(f),
  });
}

const MERGE_THEME = EditorView.baseTheme({
  ".cm-merge-conflict": { backgroundColor: "rgba(245, 158, 11, 0.16)" },
  ".cm-merge-changed": { backgroundColor: "rgba(34, 197, 94, 0.12)" },
  ".cm-merge-accept": { display: "flex", gap: "8px", alignItems: "center", padding: "2px 6px", fontSize: "0.78em", fontFamily: "var(--font-sans, system-ui)" },
  ".cm-merge-accept button": { border: "1px solid color-mix(in srgb, currentColor 25%, transparent)", borderRadius: "4px", background: "transparent", color: "var(--color-primary, #3b82f6)", padding: "0 6px", cursor: "pointer", font: "inherit" },
  ".cm-merge-accept button:hover": { background: "color-mix(in srgb, currentColor 10%, transparent)" },
  ".cm-merge-accept span": { opacity: "0.55", marginLeft: "auto" },
});

const SHARED = buildSharedExtensions();
const READONLY = [EditorView.editable.of(false)];

// ── dialog ────────────────────────────────────────────────────────────────

function joinLines(lines: string[]): string {
  return lines.length ? `${lines.join("\n")}\n` : "";
}

export function MergeEditorDialog() {
  const request = useMergeStore((s) => s.request);
  if (!request) return null;
  return <MergeEditor key={`${request.absPath}|${request.ours.length}|${request.theirs.length}`} request={request} />;
}

function MergeEditor({ request }: { request: MergeRequest }) {
  const editorThemeId = usePreferencesStore((s) => s.editorTheme);
  const themeExt = EDITOR_THEME_EXT[editorThemeId] ?? EDITOR_THEME_EXT.atomone;
  const regions = useMemo<Region[]>(() => mergeRegions(request.base, request.ours, request.theirs), [request]);
  const spans = useMemo(() => regionSpans(regions), [regions]);
  const conflictRegions = useMemo(() => regions.filter((r): r is Extract<Region, { kind: "change" }> => r.kind === "change" && r.who === "conflict"), [regions]);
  const initial = useMemo(() => renderResult(regions, { ours: request.oursLabel, theirs: request.theirsLabel }).text, [regions, request]);
  const autoMerged = spans.filter((s) => s.who !== "conflict").length;
  const [result, setResult] = useState(initial);
  const [saving, setSaving] = useState(false);
  const left = useRef<ReactCodeMirrorRef>(null);
  const mid = useRef<ReactCodeMirrorRef>(null);
  const right = useRef<ReactCodeMirrorRef>(null);
  const remaining = useMemo(() => parseConflicts(result).length, [result]);
  const lang = useMemo(() => resolveLanguageSync(request.absPath), [request.absPath]);

  /** Index of the marker block in the result that belongs to conflict k (matched by content). */
  const blockFor = (text: string, k: number) => {
    const r = conflictRegions[k];
    const blocks = parseConflicts(text);
    return blocks.find((b) => b.current === joinLines(r.ours) && b.incoming === joinLines(r.theirs)) ?? null;
  };

  const acceptRef = useRef<(k: number, c: Choice) => void>(() => {});
  acceptRef.current = (k, c) => {
    const view = mid.current?.view;
    if (!view) return;
    const doc = view.state.doc.toString();
    const block = blockFor(doc, k);
    if (!block) return void toast.info("That conflict was already resolved or edited in the result");
    const r = conflictRegions[k];
    const lines = c === "ours" ? r.ours : c === "theirs" ? r.theirs : c === "ours+theirs" ? [...r.ours, ...r.theirs] : c === "theirs+ours" ? [...r.theirs, ...r.ours] : r.base;
    view.dispatch({ changes: { from: block.from, to: block.to, insert: joinLines(lines) }, selection: { anchor: block.from }, scrollIntoView: true, userEvent: "input" });
  };
  const onAccept = (k: number, c: Choice) => acceptRef.current(k, c);

  const leftExt = useMemo(() => [...SHARED, ...(lang ? [lang] : []), ...READONLY, sideExtension(spans, "ours", onAccept), MERGE_THEME], [spans, lang]);
  const rightExt = useMemo(() => [...SHARED, ...(lang ? [lang] : []), ...READONLY, sideExtension(spans, "theirs", onAccept), MERGE_THEME], [spans, lang]);
  const midExt = useMemo(() => [...SHARED, ...(lang ? [lang] : []), conflictLens(), MERGE_THEME], [lang]);

  // Proportional scroll sync: the result pane leads.
  useEffect(() => {
    const m = mid.current?.view?.scrollDOM;
    if (!m) return;
    const sync = () => {
      const ratio = m.scrollTop / Math.max(1, m.scrollHeight - m.clientHeight);
      for (const ref of [left, right]) {
        const s = ref.current?.view?.scrollDOM;
        if (s) s.scrollTop = ratio * (s.scrollHeight - s.clientHeight);
      }
    };
    m.addEventListener("scroll", sync, { passive: true });
    return () => m.removeEventListener("scroll", sync);
  });

  const goto = (dir: 1 | -1) => {
    const view = mid.current?.view;
    if (!view) return;
    const blocks = parseConflicts(view.state.doc.toString());
    if (!blocks.length) return void toast.success("No conflicts left");
    const head = view.state.selection.main.head;
    const next = dir > 0 ? (blocks.find((b) => b.from > head) ?? blocks[0]) : ([...blocks].reverse().find((b) => b.from < head) ?? blocks[blocks.length - 1]);
    view.dispatch({ selection: { anchor: next.from }, effects: EditorView.scrollIntoView(next.from, { y: "center" }) });
    view.focus();
    // Bring the matching region into view on both sides.
    const k = conflictRegions.findIndex((r) => joinLines(r.ours) === next.current && joinLines(r.theirs) === next.incoming);
    const span = spans.find((s) => s.conflictIndex === k);
    if (span) {
      for (const [ref, side] of [[left, "ours"], [right, "theirs"]] as const) {
        const v = ref.current?.view;
        if (!v) continue;
        const line = v.state.doc.line(Math.min(span[side][0] + 1, v.state.doc.lines));
        v.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: "center" }) });
      }
    }
  };

  const acceptAll = (c: Choice) => {
    const view = mid.current?.view;
    if (!view) return;
    const choices = conflictRegions.map(() => c);
    const text = renderResult(regions, { ours: request.oursLabel, theirs: request.theirsLabel }, choices).text;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  };

  const reset = () => {
    const view = mid.current?.view;
    if (view) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: initial } });
  };

  const close = () => useMergeStore.setState({ request: null });

  const save = async () => {
    if (saving) return;
    const text = mid.current?.view?.state.doc.toString() ?? result;
    const left = parseConflicts(text).length;
    if (left && !(await confirmPick(`${left} conflict(s) still have markers. Save without marking the file resolved?`, "Save anyway"))) return;
    setSaving(true);
    try {
      const out = request.eol === "\r\n" ? text.replace(/\r?\n/g, "\r\n") : text;
      await native.writeFile(request.absPath, out, "user");
      if (!left && request.repoRoot && request.relPath) {
        const r = await git(request.repoRoot, ["add", "--", request.relPath]);
        if (!r.ok) throw new Error(r.stderr.trim() || "git add failed");
        notifyGitChanged(request.repoRoot);
        const unmerged = (await git(request.repoRoot, ["diff", "--name-only", "--diff-filter=U"])).stdout.split("\n").filter(Boolean);
        close();
        if (!unmerged.length && request.operation) {
          const root = request.repoRoot;
          const op = request.operation;
          toast.success(`All conflicts resolved`, {
            duration: 60_000,
            action: { label: `Continue ${op}`, onClick: () => app().openTerminal({ cwd: root, command: `git -c core.editor=true ${op} --continue` }) },
          });
        } else if (unmerged.length) {
          toast.success(`Resolved ${request.relPath}`, {
            description: `${unmerged.length} file(s) still conflicted`,
            duration: 30_000,
            action: { label: "Next file", onClick: () => void openMergeEditor(`${request.repoRoot}/${unmerged[0]}`) },
          });
        } else toast.success(`Resolved ${request.relPath}`);
      } else {
        close();
        toast.success("Saved");
      }
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  };

  const name = request.absPath.replace(/^.*\//, "");
  const btn = "rounded border border-border/60 px-2 py-0.5 text-[11px] hover:bg-muted disabled:opacity-50";
  const basic = { lineNumbers: true, foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: false };
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="flex h-[calc(100vh-48px)] w-[calc(100vw-48px)] max-w-none flex-col gap-2 p-3 sm:max-w-none" onEscapeKeyDown={(e) => e.preventDefault()}>
        <div className="flex items-center gap-2 pr-12">
          <DialogTitle className="min-w-0 truncate text-sm">
            Merge {name}
            {request.operation ? <span className="ml-2 text-[11px] font-normal text-muted-foreground">({request.operation} in progress)</span> : null}
          </DialogTitle>
          <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] ${remaining ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-green-500/15 text-green-700 dark:text-green-300"}`}>
            {remaining ? `${remaining} of ${conflictRegions.length} conflict(s) left` : "No conflicts left"}
          </span>
          <span className="text-[11px] text-muted-foreground">{autoMerged} change(s) merged automatically</span>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" className={btn} onClick={() => goto(-1)} title="Previous conflict">
              ↑
            </button>
            <button type="button" className={btn} onClick={() => goto(1)} title="Next conflict">
              ↓
            </button>
            <button type="button" className={btn} onClick={() => acceptAll("ours")}>
              All ours
            </button>
            <button type="button" className={btn} onClick={() => acceptAll("theirs")}>
              All theirs
            </button>
            <button type="button" className={btn} onClick={reset}>
              Reset
            </button>
            <button type="button" className={`${btn} border-primary bg-primary text-primary-foreground hover:bg-primary/90`} disabled={saving} onClick={() => void save()}>
              {remaining || !request.repoRoot ? "Save" : "Save & mark resolved"}
            </button>
          </div>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-3 gap-2">
          {(
            [
              ["Ours", request.oursLabel, left, request.ours, leftExt, false],
              ["Result", "editable", mid, initial, midExt, true],
              ["Theirs", request.theirsLabel, right, request.theirs, rightExt, false],
            ] as const
          ).map(([title, label, ref, value, ext, editable]) => (
            <div key={title} className="flex min-h-0 flex-col overflow-hidden rounded-md border">
              <div className="flex h-7 shrink-0 items-center gap-2 border-b px-2 text-[11px]">
                <span className="font-medium">{title}</span>
                <span className="truncate text-muted-foreground" title={label}>
                  {label}
                </span>
              </div>
              <div className="min-h-0 flex-1">
                <CodeMirror
                  ref={ref}
                  value={value}
                  theme={themeExt}
                  extensions={ext}
                  editable={editable}
                  height="100%"
                  className={editable ? "h-full cm-merge-result" : "h-full"}
                  basicSetup={basic}
                  onChange={editable ? setResult : undefined}
                />
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
