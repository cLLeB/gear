// gear-regex://: write a regular expression against sample text and see the
// matches, the groups, a replacement preview and a plain-language explanation.

import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import { app } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { quickPick } from "@/modules/quick-pick";
import { toolPaneHandle } from "@/modules/tools/paneHandle";
import { codeFor, explain, FLAGS, LIBRARY, replaceAll, run, segments, type Lang } from "./model";

export const REGEX_PATH = "gear-regex://Regex";
const KEY = "gear.regexlab";

interface State {
  pattern: string;
  flags: string;
  text: string;
  replacement: string;
}

function initial(): State {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<State> | null;
    if (v && typeof v.pattern === "string") return { pattern: v.pattern, flags: String(v.flags ?? "g"), text: String(v.text ?? ""), replacement: String(v.replacement ?? "") };
  } catch {
    // Start from the example below.
  }
  return { pattern: LIBRARY[3].pattern, flags: LIBRARY[3].flags, text: LIBRARY[3].sample, replacement: "$<day>/$<month>/$<year>" };
}

export const useRegexLab = create<State>(initial);

function update(patch: Partial<State>): void {
  useRegexLab.setState(patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(useRegexLab.getState()));
  } catch {
    // Not remembered across restarts, then.
  }
}

/** Opens the workbench; a selection in the editor becomes the sample text. */
export function openRegexLab(): void {
  const view = getActiveEditor()?.view;
  const sel = view ? view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) : "";
  if (sel.trim()) update({ text: sel });
  app().openFile(REGEX_PATH);
}

const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";
const field = "rounded border border-border/60 bg-background px-1.5 py-1 font-mono text-[12.5px] outline-none focus:border-ring";
const LANGS: { id: Lang; label: string }[] = [
  { id: "javascript", label: "JavaScript" },
  { id: "python", label: "Python" },
  { id: "go", label: "Go" },
  { id: "rust", label: "Rust" },
  { id: "grep", label: "grep" },
];
const TINTS = ["bg-amber-400/40", "bg-sky-400/40"];

export const RegexPane = forwardRef<EditorPaneHandle, { path: string }>(function RegexPane({ path }, ref) {
  const { pattern, flags, text, replacement } = useRegexLab();
  const [tab, setTab] = useState<"matches" | "replace" | "explain" | "code">("matches");
  const [lang, setLang] = useState<Lang>("javascript");
  const [picked, setPicked] = useState<number | null>(null);

  useImperativeHandle(ref, () => toolPaneHandle(path, { getSelection: () => useRegexLab.getState().pattern }), [path]);

  const result = useMemo(() => run(pattern, flags, text), [pattern, flags, text]);
  const segs = useMemo(() => segments(text, result.matches), [text, result.matches]);
  const replaced = useMemo(() => (pattern && !result.error ? replaceAll(pattern, flags, text, replacement) : null), [pattern, flags, text, replacement, result.error]);
  const pieces = useMemo(() => explain(pattern), [pattern]);
  const groupCount = result.matches.reduce((m, x) => Math.max(m, x.groups.length), 0);
  const names = useMemo(() => [...new Set(result.matches.flatMap((m) => Object.keys(m.named)))], [result.matches]);

  const toggleFlag = (f: string) => update({ flags: flags.includes(f) ? flags.replace(f, "") : [...FLAGS].map((x) => x.flag).filter((x) => x === f || flags.includes(x)).join("") });

  const library = async () => {
    const pick = await quickPick(
      LIBRARY.map((l) => ({ label: l.name, detail: l.pattern, value: l })),
      { title: "Common patterns" },
    );
    if (pick) update({ pattern: pick.pattern, flags: pick.flags, text: pick.sample });
  };

  const fromEditor = () => {
    const view = getActiveEditor()?.view;
    if (!view) return void toast.info("Open a file first.");
    const { from, to } = view.state.selection.main;
    const body = from === to ? view.state.doc.toString() : view.state.sliceDoc(from, to);
    update({ text: body.length > 200000 ? body.slice(0, 200000) : body });
    if (body.length > 200000) toast.info("Only the first 200,000 characters were taken.");
  };

  const copy = (value: string, what: string) => void navigator.clipboard.writeText(value).then(() => toast.success(`${what} copied`));

  return (
    <div className="flex h-full flex-col text-[12.5px]">
      <div className="space-y-1.5 border-b border-border/60 p-2">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-muted-foreground">/</span>
          <input className={cn(field, "min-w-0 flex-1", result.error && "border-red-500")} data-regex-pattern value={pattern} spellCheck={false} placeholder="Regular expression" onChange={(e) => update({ pattern: e.target.value })} />
          <span className="font-mono text-muted-foreground">/{flags}</span>
          <button type="button" className={btn} onClick={() => void library()}>
            Common patterns…
          </button>
          <button type="button" className={btn} disabled={!pattern} onClick={() => copy(pattern, "Pattern")}>
            Copy
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {FLAGS.map((f) => (
            <button key={f.flag} type="button" data-flag={f.flag} className={cn(btn, flags.includes(f.flag) && "bg-muted font-medium")} title={f.hint} onClick={() => toggleFlag(f.flag)}>
              <span className="font-mono">{f.flag}</span> {f.name}
            </button>
          ))}
          <span className="flex-1" />
          {result.error ? (
            <span className="text-red-500" data-regex-error>
              {result.error}
            </span>
          ) : (
            <span className="text-muted-foreground" data-regex-count>
              {result.matches.length} {result.matches.length === 1 ? "match" : "matches"}
              {result.truncated && " (first 5,000)"}
            </span>
          )}
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-1/2 min-w-0 flex-col border-r border-border/60">
          <div className="flex items-center gap-1.5 border-b border-border/60 px-2 py-1">
            <span className="font-medium">Sample text</span>
            <span className="flex-1" />
            <button type="button" className={btn} title="Use the selection, or the whole file, from the editor" onClick={fromEditor}>
              From editor
            </button>
            <button type="button" className={btn} onClick={() => void navigator.clipboard.readText().then((t) => update({ text: t }), () => toast.error("Could not read the clipboard"))}>
              Paste
            </button>
          </div>
          <textarea className="h-[40%] w-full resize-none border-b border-border/60 bg-background p-2 font-mono text-[12.5px] outline-none" data-regex-text spellCheck={false} value={text} placeholder="Text to test against" onChange={(e) => update({ text: e.target.value })} />
          <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-[12.5px]" data-regex-preview>
            {segs.map((s, i) =>
              s.match < 0 ? (
                <span key={i}>{s.text}</span>
              ) : (
                <mark key={i} className={cn("cursor-pointer rounded-sm text-foreground", TINTS[s.match % 2], picked === s.match && "outline outline-2 outline-primary")} onClick={() => (setPicked(s.match), setTab("matches"))}>
                  {s.text}
                </mark>
              ),
            )}
            {!text && <span className="font-sans text-muted-foreground">Matches are highlighted here.</span>}
          </pre>
        </div>
        <div className="flex w-1/2 min-w-0 flex-col">
          <div className="flex items-center gap-1 border-b border-border/60 px-2 py-1">
            {(["matches", "replace", "explain", "code"] as const).map((t) => (
              <button key={t} type="button" data-tab={t} className={cn(btn, tab === t && "bg-muted font-medium")} onClick={() => setTab(t)}>
                {t === "matches" ? "Matches" : t === "replace" ? "Replace" : t === "explain" ? "Explain" : "Code"}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {tab === "matches" &&
              (result.matches.length === 0 ? (
                <div className="p-4 text-muted-foreground">{result.error ? "Fix the pattern to see matches." : pattern ? "No match in the sample text." : "Type a pattern."}</div>
              ) : (
                <table className="w-full border-collapse font-mono text-[12px]">
                  <thead>
                    <tr className="border-b border-border/60 text-left font-sans text-muted-foreground">
                      <th className="px-2 py-1 font-normal">#</th>
                      <th className="px-2 font-normal">at</th>
                      <th className="px-2 font-normal">match</th>
                      {Array.from({ length: groupCount }, (_, g) => {
                        const name = names.find((n) => result.matches.some((m) => m.named[n] !== undefined && m.named[n] === m.groups[g]));
                        return (
                          <th key={g} className="px-2 font-normal">
                            {name ? `${g + 1} (${name})` : `group ${g + 1}`}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {result.matches.slice(0, 500).map((m, i) => (
                      <tr key={i} className={cn("border-b border-border/30 hover:bg-muted/30", picked === i && "bg-muted/60")} onClick={() => setPicked(i)}>
                        <td className="px-2 py-0.5 text-muted-foreground">{i + 1}</td>
                        <td className="px-2 tabular-nums text-muted-foreground">
                          {m.index}–{m.end}
                        </td>
                        <td className="max-w-[260px] truncate px-2" title={m.text}>
                          {m.text === "" ? <span className="font-sans text-muted-foreground">(empty)</span> : m.text}
                        </td>
                        {Array.from({ length: groupCount }, (_, g) => (
                          <td key={g} className="max-w-[180px] truncate px-2" title={m.groups[g]}>
                            {m.groups[g] === undefined ? <span className="font-sans text-muted-foreground">—</span> : m.groups[g]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
            {tab === "matches" && result.matches.length > 0 && (
              <div className="flex gap-1 p-2">
                <button type="button" className={btn} onClick={() => copy(result.matches.map((m) => m.text).join("\n"), "Matches")}>
                  Copy all matches
                </button>
                {result.matches.length > 500 && <span className="text-muted-foreground">Showing the first 500 of {result.matches.length}.</span>}
              </div>
            )}
            {tab === "replace" && (
              <div className="space-y-1.5 p-2">
                <input className={cn(field, "w-full")} data-regex-replacement value={replacement} spellCheck={false} placeholder="Replacement — $1, $<name>, $& for the whole match" onChange={(e) => update({ replacement: e.target.value })} />
                {replaced && "result" in replaced ? (
                  <>
                    <pre className="max-h-[52vh] overflow-auto whitespace-pre-wrap break-words rounded border border-border/60 p-2 font-mono text-[12.5px]" data-regex-replaced>
                      {replaced.result}
                    </pre>
                    <button type="button" className={btn} onClick={() => copy(replaced.result, "Result")}>
                      Copy result
                    </button>
                    {!flags.includes("g") && <span className="ml-2 text-muted-foreground">Without the g flag only the first match is replaced.</span>}
                  </>
                ) : (
                  <div className="text-muted-foreground">{result.error ? "Fix the pattern first." : "Type a pattern."}</div>
                )}
              </div>
            )}
            {tab === "explain" &&
              (pieces.length === 0 ? (
                <div className="p-4 text-muted-foreground">Type a pattern to have it explained.</div>
              ) : (
                <div className="p-2" data-regex-explain>
                  {pieces.map((p, i) => (
                    <div key={i} className="flex gap-3 py-0.5" style={{ paddingLeft: p.depth * 16 }}>
                      <code className="min-w-[72px] shrink-0 rounded bg-muted/60 px-1 text-[12px]">{p.source}</code>
                      <span>{p.meaning}</span>
                    </div>
                  ))}
                </div>
              ))}
            {tab === "code" && (
              <div className="space-y-1.5 p-2">
                <div className="flex gap-1">
                  {LANGS.map((l) => (
                    <button key={l.id} type="button" className={cn(btn, lang === l.id && "bg-muted font-medium")} onClick={() => setLang(l.id)}>
                      {l.label}
                    </button>
                  ))}
                </div>
                <pre className="overflow-auto whitespace-pre-wrap break-words rounded border border-border/60 p-2 font-mono text-[12.5px]" data-regex-code>
                  {codeFor(lang, pattern, flags)}
                </pre>
                <button type="button" className={btn} onClick={() => copy(codeFor(lang, pattern, flags), "Code")}>
                  Copy code
                </button>
                {lang !== "javascript" && <div className="text-muted-foreground">Matches above use the JavaScript engine; other languages differ in a few details (lookbehind, Unicode classes, named groups).</div>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

export const REGEX_ACTIONS = [{ id: "regex.open", label: "Regex: Open the regex workbench", keywords: ["regex", "regexp", "regular expression", "pattern", "test", "match", "playground", "regex101"], run: openRegexLab }];
