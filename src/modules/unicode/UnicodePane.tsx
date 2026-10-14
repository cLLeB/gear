// gear-unicode://: what is really in a piece of text — every character with
// its code point and encodings, hidden and bidi characters (Trojan Source),
// look-alike letters, normalization, and escapes in several languages.

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { copyToClipboard, toolPaneHandle } from "@/modules/tools/paneHandle";
import { clean, codePoints, escapeText, normalizations, stats, unescapeText, type EscapeStyle, type IssueKind } from "./model";

export const UNICODE_PATH = "gear-unicode://Unicode";
const KEY = "gear.unicode.text";
const CHAR_LIMIT = 5000;

/** Text handed over by a palette command, with the file it came from. */
let seed: { text: string; path: string | null } | null = null;
/** The open pane takes text handed over after it mounted. */
let deliver: ((s: { text: string; path: string | null }) => void) | null = null;

function handOver(s: { text: string; path: string | null }): void {
  if (deliver) deliver(s);
  else seed = s;
  app().openFile(UNICODE_PATH);
}

function remembered(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

/** Opens the inspector on the editor's selection, or on what was there last time. */
export function openUnicode(): void {
  const view = getActiveEditor()?.view;
  const sel = view ? view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) : "";
  if (sel) handOver({ text: sel, path: null });
  else app().openFile(UNICODE_PATH);
}

/** Checks the whole current file for hidden, bidi and look-alike characters. */
export function checkCurrentFile(): void {
  const ed = getActiveEditor();
  if (!ed?.view) return void toast.info("Open a file first.");
  handOver({ text: ed.view.state.doc.toString(), path: ed.path ?? null });
}

const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";
const ISSUE_LABEL: Record<IssueKind, string> = {
  bidi: "Bidi controls",
  invisible: "Invisible",
  space: "Odd spaces",
  confusable: "Look-alikes",
  control: "Control chars",
  private: "Private use",
  replacement: "Lost characters (\ufffd)",
};
const ISSUE_COLOR: Record<IssueKind, string> = {
  bidi: "bg-red-500/25",
  invisible: "bg-red-500/20",
  space: "bg-amber-500/25",
  confusable: "bg-amber-500/25",
  control: "bg-red-500/20",
  private: "bg-sky-500/20",
  replacement: "bg-red-500/20",
};
const STYLES: { id: EscapeStyle; label: string }[] = [
  { id: "js", label: "JavaScript" },
  { id: "json", label: "JSON" },
  { id: "python", label: "Python" },
  { id: "rust", label: "Rust" },
  { id: "java", label: "Java / C#" },
  { id: "css", label: "CSS" },
  { id: "html", label: "HTML" },
  { id: "url", label: "URL" },
];

/** How a character is drawn in the table: invisible ones get a visible stand-in. */
function glyph(ch: string, cp: number): string {
  if (cp === 0x20) return "␠";
  if (cp === 0x09) return "⇥";
  if (cp === 0x0a) return "↵";
  if (cp === 0x0d) return "␍";
  if (cp < 0x20) return String.fromCodePoint(0x2400 + cp);
  if (/\p{Cf}|\p{Zs}|\p{Zl}|\p{Zp}/u.test(ch)) return "◌";
  if (/\p{M}/u.test(ch)) return `◌${ch}`;
  return ch;
}

type Tab = "chars" | "normalize" | "escape";

export const UnicodePane = forwardRef<EditorPaneHandle, { path: string }>(function UnicodePane({ path }, ref) {
  const [source, setSource] = useState<string | null>(() => seed?.path ?? null);
  const [text, setTextState] = useState(() => {
    const s = seed?.text ?? remembered();
    seed = null;
    return s;
  });
  const [tab, setTab] = useState<Tab>("chars");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [style, setStyle] = useState<EscapeStyle>("js");
  const [escaped, setEscaped] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const live = useRef(text);
  live.current = text;

  const setText = (v: string, keepSource = false) => {
    setTextState(v);
    if (!keepSource) setSource(null);
    setSelected(null);
    try {
      // Whole files are not worth keeping between sessions.
      if (v.length < 20000) localStorage.setItem(KEY, v);
    } catch {
      // Not remembered, then.
    }
  };

  useEffect(() => {
    deliver = (s) => {
      setText(s.text, true);
      setSource(s.path);
      setTab("chars");
    };
    return () => {
      deliver = null;
    };
  });

  useImperativeHandle(ref, () => toolPaneHandle(path, { getSelection: () => live.current || null }), [path]);

  const points = useMemo(() => codePoints(text, Infinity), [text]);
  const st = useMemo(() => stats(text, points), [text, points]);
  const issueKinds = (Object.keys(st.issues) as IssueKind[]).filter((k) => st.issues[k] > 0);
  const rows = useMemo(() => (onlyIssues ? points.filter((p) => p.issue) : points).slice(0, CHAR_LIMIT), [points, onlyIssues]);
  const norms = useMemo(() => (tab === "normalize" ? normalizations(text) : []), [tab, text]);
  const current = selected !== null ? points[selected] : null;

  /** The editor that holds the source file, when it is still unchanged. */
  const sourceView = () => {
    const ed = getActiveEditor();
    return source && ed?.path === source && ed.view && ed.view.state.doc.toString() === text ? ed.view : null;
  };

  const reveal = (offset: number, length: number) => {
    const view = sourceView();
    if (!view) return;
    view.dispatch({ selection: { anchor: offset, head: offset + length }, scrollIntoView: true });
  };

  const cleanKinds = (kinds: IssueKind[]) => {
    const r = clean(text, { kinds: new Set(kinds) });
    if (!r.changed) return;
    const view = sourceView();
    if (view) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: r.text } });
      toast.success(`Cleaned ${r.changed} character${r.changed === 1 ? "" : "s"} in the file (Ctrl+Z undoes it)`);
      setText(r.text, true);
    } else {
      setText(r.text);
      toast.success(`Cleaned ${r.changed} character${r.changed === 1 ? "" : "s"}`);
    }
  };

  const copy = (v: string, what: string) => void copyToClipboard(v).then(() => toast.success(`${what} copied`));

  return (
    <div className="flex h-full flex-col text-[12.5px]">
      <div className="space-y-1.5 border-b border-border/60 p-2">
        <textarea
          className="h-24 w-full resize-y rounded border border-border/60 bg-background px-2 py-1 font-mono text-[13px] outline-none focus:border-ring"
          data-unicode-input
          value={text.length > 200000 ? text.slice(0, 200000) : text}
          readOnly={text.length > 200000}
          spellCheck={false}
          placeholder="Paste text to see every character in it — or run “Unicode: Check this file for hidden characters”."
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground" data-unicode-stats>
          <span>{st.codePoints.toLocaleString()} code points</span>
          <span>{st.graphemes.toLocaleString()} visible characters</span>
          <span>{st.utf8Bytes.toLocaleString()} bytes in UTF-8</span>
          <span>{st.utf16Units.toLocaleString()} UTF-16 units (JS length)</span>
          <span>
            {st.words.toLocaleString()} words · {st.lines.toLocaleString()} lines
          </span>
          {st.scripts.length > 0 && <span>{st.scripts.map((s) => s.script).join(", ")}</span>}
          {source && <span className="text-foreground">From {source.split(/[\\/]/).pop()}</span>}
        </div>
        {issueKinds.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5" data-unicode-issues>
            {issueKinds.map((k) => (
              <span key={k} className={cn("rounded px-1.5 py-0.5", ISSUE_COLOR[k])} data-issue-kind={k}>
                {ISSUE_LABEL[k]}: {st.issues[k]}
              </span>
            ))}
            <span className="flex-1" />
            <button type="button" className={btn} data-unicode-clean-hidden onClick={() => cleanKinds(["bidi", "invisible", "control", "space", "replacement"])} title="Removes bidi controls, invisible and control characters; turns odd spaces into plain spaces">
              Clean hidden characters
            </button>
            {st.issues.confusable > 0 && (
              <button type="button" className={btn} data-unicode-clean-confusable onClick={() => cleanKinds(["confusable"])} title="Swaps look-alike letters, smart quotes and dashes for plain ASCII">
                Replace look-alikes
              </button>
            )}
          </div>
        ) : (
          text && <div className="text-emerald-600" data-unicode-clean>No hidden, bidi or look-alike characters.</div>
        )}
      </div>
      <div className="flex items-center gap-1 border-b border-border/60 px-2 py-1">
        {(
          [
            ["chars", "Characters"],
            ["normalize", "Normalization"],
            ["escape", "Escape / unescape"],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button key={t} type="button" data-unicode-tab={t} className={cn(btn, tab === t && "bg-muted font-medium")} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
        <span className="flex-1" />
        {tab === "chars" && (
          <label className="flex items-center gap-1 text-[11.5px] text-muted-foreground">
            <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />
            Only problem characters
          </label>
        )}
      </div>
      {tab === "chars" && (
        <div className="flex min-h-0 flex-1">
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead className="sticky top-0 bg-background text-left text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-2 py-1 font-normal">#</th>
                  <th className="px-2 py-1 font-normal">Char</th>
                  <th className="px-2 py-1 font-normal">Code point</th>
                  <th className="px-2 py-1 font-normal">Name / category</th>
                  <th className="px-2 py-1 font-normal">Script</th>
                  <th className="px-2 py-1 font-normal">UTF-8</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr
                    key={p.index}
                    data-unicode-row={p.index}
                    className={cn("cursor-pointer border-b border-border/20 hover:bg-muted/50", p.issue && ISSUE_COLOR[p.issue.kind], selected === p.index && "outline outline-1 outline-ring")}
                    onClick={() => (setSelected(p.index), reveal(p.offset, p.char.length))}
                    title={p.issue?.message}
                  >
                    <td className="px-2 py-0.5 tabular-nums text-muted-foreground">{p.index}</td>
                    <td className="px-2 py-0.5 text-[15px]">{glyph(p.char, p.cp)}</td>
                    <td className="px-2 py-0.5 font-mono">{p.hex}</td>
                    <td className="px-2 py-0.5">
                      {p.name}
                      {p.issue && <span className="ml-2 text-[11px] text-muted-foreground">— {p.issue.message}</span>}
                    </td>
                    <td className="px-2 py-0.5 text-muted-foreground">{p.script}</td>
                    <td className="px-2 py-0.5 font-mono text-muted-foreground">{p.utf8.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {points.length > CHAR_LIMIT && !onlyIssues && <div className="p-2 text-muted-foreground">Showing the first {CHAR_LIMIT.toLocaleString()} characters; tick “Only problem characters” to see every issue.</div>}
            {!text && <div className="p-3 text-muted-foreground">Nothing to inspect yet.</div>}
          </div>
          {current && (
            <div className="w-[300px] shrink-0 space-y-2 overflow-auto border-l border-border/60 p-3" data-unicode-detail>
              <div className="text-center text-[48px] leading-none">{glyph(current.char, current.cp)}</div>
              <div className="text-center font-medium">{current.name}</div>
              <table className="w-full text-[12px]">
                <tbody>
                  {[
                    ["Code point", current.hex],
                    ["Decimal", String(current.cp)],
                    ["Category", current.category],
                    ["Script", current.script],
                    ["UTF-8", current.utf8.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ")],
                    ["UTF-16", current.utf16.map((u) => u.toString(16).toUpperCase().padStart(4, "0")).join(" ")],
                    ["JavaScript", escapeText(current.char, "js")],
                    ["Python", escapeText(current.char, "python")],
                    ["HTML", escapeText(current.char, "html")],
                    ["CSS", escapeText(current.char, "css").trim()],
                    ["URL", encodeURIComponent(current.char)],
                  ].map(([k, v]) => (
                    <tr key={k} className="cursor-pointer hover:bg-muted/50" onClick={() => copy(v, k)} title="Click to copy">
                      <td className="py-0.5 pr-2 text-muted-foreground">{k}</td>
                      <td className="break-all py-0.5 font-mono">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {current.issue && <div className="rounded bg-amber-500/10 px-2 py-1 text-amber-700 dark:text-amber-400">{current.issue.message}.</div>}
            </div>
          )}
        </div>
      )}
      {tab === "normalize" && (
        <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3" data-unicode-normalize>
          <div className="text-muted-foreground">Two strings that look the same can differ in code points: é can be one character (NFC) or e plus a combining accent (NFD). The K forms also fold compatibility characters such as ﬁ → fi and ² → 2.</div>
          {norms.map((n) => (
            <div key={n.form} className="flex items-start gap-3 border-b border-border/30 pb-2">
              <span className="w-12 font-medium">{n.form}</span>
              <span className={cn("w-40 shrink-0", n.same ? "text-emerald-600" : "text-amber-600")}>{n.same ? "already in this form" : `differs · ${n.codePoints} code points`}</span>
              <span className="min-w-0 flex-1 truncate font-mono">{n.text.slice(0, 300)}</span>
              <button type="button" className={btn} disabled={n.same} onClick={() => setText(n.text)}>
                Use
              </button>
              <button type="button" className={btn} onClick={() => copy(n.text, n.form)}>
                Copy
              </button>
            </div>
          ))}
        </div>
      )}
      {tab === "escape" && (
        <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
          <div className="flex flex-wrap gap-1">
            {STYLES.map((s) => (
              <button key={s.id} type="button" data-escape-style={s.id} className={cn(btn, style === s.id && "bg-muted font-medium")} onClick={() => setStyle(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="text-muted-foreground">The text above with every non-ASCII and invisible character written as an escape:</div>
          <pre className="whitespace-pre-wrap break-all rounded bg-muted/40 p-2 font-mono text-[12px]" data-unicode-escaped>
            {escapeText(text.slice(0, 100000), style)}
          </pre>
          <button type="button" className={btn} disabled={!text} onClick={() => copy(escapeText(text, style), "Escaped text")}>
            Copy
          </button>
          <div className="pt-3 text-muted-foreground">Paste escapes to read them back (é, \u{"{"}1F600{"}"}, \x41, U+00E9, &amp;#233;, %C3%A9):</div>
          <textarea className="h-20 w-full resize-y rounded border border-border/60 bg-background px-2 py-1 font-mono outline-none focus:border-ring" data-unicode-unescape value={escaped} spellCheck={false} onChange={(e) => setEscaped(e.target.value)} />
          {escaped && (
            <div className="flex items-start gap-2">
              <pre className="min-w-0 flex-1 whitespace-pre-wrap break-all rounded bg-muted/40 p-2 text-[13px]" data-unicode-unescaped>
                {unescapeText(escaped)}
              </pre>
              <button type="button" className={btn} onClick={() => setText(unescapeText(escaped))}>
                Inspect
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export const UNICODE_ACTIONS = [
  { id: "unicode.open", label: "Unicode: Inspect characters (selection or pasted text)", keywords: ["unicode", "character", "code point", "utf-8", "invisible", "zero width", "emoji", "escape", "normalize", "nfc"], run: openUnicode },
  { id: "unicode.checkFile", label: "Unicode: Check this file for hidden, bidi and look-alike characters", keywords: ["trojan source", "bidi", "invisible", "zero width", "homoglyph", "confusable", "hidden characters", "security", "nbsp"], run: checkCurrentFile },
];
