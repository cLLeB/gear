// Editor commands for code and prose tools (see codeTools.ts / prose.ts) plus
// clipboard history, snippets, scratchpad, file info, hex view and data URIs.

import { snippet } from "@codemirror/autocomplete";
import { indentUnit } from "@codemirror/language";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { appDataDir } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { compactRelativeTime } from "@/lib/toolkit/compactRelativeTime";
import { native } from "@/modules/ai/lib/native";
import { clearClipHistory, clipHistory } from "@/modules/clipboard/history";
import { openTextViewer } from "@/modules/compare/CompareDialog";
import { confirmPick, inputBox, quickPick } from "@/modules/quick-pick";
import { getFeature } from "@/modules/settings/useFeature";
import { guardedPasteIntoLeaf } from "@/modules/terminal/lib/rendererPool";
import { readTerminalClipboard, writeTerminalClipboard } from "@/modules/terminal/lib/terminalClipboard";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { getActiveEditor } from "../activeEditor";
import type { CodeActionDescriptor } from "../codeActions";
import { replaceTarget } from "./commands";
import {
  addLineNumbers,
  applySurround,
  concatToTemplate,
  debugLogFor,
  extractVariable,
  langFamily,
  removeDebugLines,
  removeLineNumbers,
  suggestName,
  surroundTemplates,
} from "./codeTools";
import { base64ToBytes, describeBytes, hexDump, mimeForPath } from "./hexdump";
import { extractLinks, headingAnchors, htmlToMarkdown, lintProse, renumberLists } from "./prose";

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

function family(view: EditorView, lang: string) {
  return langFamily(lang, getActiveEditor()?.view === view ? (getActiveEditor()?.path ?? "") : "");
}

/** The selection, or the identifier/expression at the cursor. */
function exprAtCursor(view: EditorView): { from: number; to: number; text: string } | null {
  const sel = view.state.selection.main;
  if (!sel.empty) return { from: sel.from, to: sel.to, text: view.state.sliceDoc(sel.from, sel.to) };
  const line = view.state.doc.lineAt(sel.head);
  for (const m of line.text.matchAll(/[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*|\[[^\]]+\])*/g)) {
    const from = line.from + m.index!;
    if (from <= sel.head && sel.head <= from + m[0].length) return { from, to: from + m[0].length, text: m[0] };
  }
  return null;
}

export function insertDebugLogCmd(view: EditorView, lang: string): boolean {
  const target = exprAtCursor(view);
  if (!target) {
    toast.info("Put the cursor on a variable or select an expression");
    return false;
  }
  const line = view.state.doc.lineAt(target.to);
  const indent = /^\s*/.exec(line.text)![0];
  const path = getActiveEditor()?.path ?? "";
  const stmt = debugLogFor(family(view, lang), target.text.trim(), `${baseName(path) || "untitled"}:${line.number + 1}`);
  // Below the statement; after an opening brace, indent one level more.
  const extra = /[{:(]\s*$/.test(line.text) ? view.state.facet(indentUnit) : "";
  view.dispatch({ changes: { from: line.to, insert: `\n${indent}${extra}${stmt}` }, scrollIntoView: true, userEvent: "input" });
  return true;
}

export async function removeDebugLogsCmd(view: EditorView, lang: string): Promise<void> {
  const fam = family(view, lang);
  const mode = await quickPick(
    [
      { label: "Only prints Gear inserted (marked 🔍)", value: false },
      { label: "All print / console.log statements in this file", value: true },
    ],
    { title: "Remove debug logs" },
  );
  if (mode === undefined) return;
  const { text, removed } = removeDebugLines(view.state.doc.toString(), mode, fam);
  if (!removed) {
    toast.info("No debug statements found");
    return;
  }
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, userEvent: "input" });
  toast.success(`Removed ${removed} line${removed === 1 ? "" : "s"}`);
}

export async function surroundWithCmd(view: EditorView, lang: string): Promise<void> {
  const fam = family(view, lang);
  const sel = view.state.selection.main;
  const from = view.state.doc.lineAt(sel.from).from;
  const to = view.state.doc.lineAt(sel.to).to;
  const tpl = await quickPick(surroundTemplates(fam).map((t) => ({ label: t.label, value: t.template })), { title: "Surround with…" });
  if (!tpl) return;
  const body = view.state.sliceDoc(from, to);
  const base = /^\s*/.exec(body)![0];
  const out = applySurround(tpl, body, base, view.state.facet(indentUnit));
  view.dispatch({ changes: { from, to, insert: out }, selection: EditorSelection.cursor(from + out.length), userEvent: "input" });
  view.focus();
}

export async function extractVariableCmd(view: EditorView, lang: string): Promise<void> {
  const sel = view.state.selection.main;
  if (sel.empty) {
    toast.info("Select the expression to extract");
    return;
  }
  const expr = view.state.sliceDoc(sel.from, sel.to).trim();
  const name = await inputBox({ title: "Variable name", value: suggestName(expr) });
  if (!name?.trim()) return;
  const fam = family(view, lang);
  const { declaration, reference } = extractVariable(fam, name.trim(), expr);
  const line = view.state.doc.lineAt(sel.from);
  const indent = /^\s*/.exec(line.text)![0];
  const text = view.state.doc.toString();
  // Replace every identical occurrence after the declaration point in the same block? Keep it local: same line onwards, same text.
  const occurrences: { from: number; to: number }[] = [];
  let at = text.indexOf(expr, line.from);
  while (at >= 0 && occurrences.length < 50) {
    occurrences.push({ from: at, to: at + expr.length });
    at = text.indexOf(expr, at + expr.length);
  }
  let targets = [{ from: sel.from, to: sel.to }];
  if (occurrences.length > 1 && (await confirmPick(`Replace all ${occurrences.length} occurrences below?`, "Replace all", expr))) targets = occurrences;
  view.dispatch({
    changes: [{ from: line.from, insert: `${indent}${declaration}\n` }, ...targets.map((t) => ({ ...t, insert: reference }))],
    userEvent: "input",
  });
  view.focus();
}

export function concatToTemplateCmd(view: EditorView): boolean {
  return replaceTarget(view, "Template literal", (t) => {
    const out = concatToTemplate(t);
    if (!out) throw new Error("Select a string concatenation like 'a' + b + 'c'");
    return out;
  });
}

export async function proseLintCmd(view: EditorView): Promise<void> {
  const sel = view.state.selection.main;
  const base = sel.empty ? 0 : sel.from;
  const issues = lintProse(sel.empty ? view.state.doc.toString() : view.state.sliceDoc(sel.from, sel.to));
  if (!issues.length) {
    toast.success("No prose issues found");
    return;
  }
  const pick = await quickPick(
    issues.map((i) => {
      const line = view.state.doc.lineAt(base + i.from);
      return { label: i.message, description: `line ${line.number} · ${i.kind}`, detail: line.text.trim().slice(0, 120), value: i };
    }),
    { title: `${issues.length} writing suggestion${issues.length === 1 ? "" : "s"}` },
  );
  if (!pick) return;
  view.dispatch({ selection: EditorSelection.range(base + pick.from, base + pick.to), scrollIntoView: true });
  view.focus();
}

export async function checkMarkdownLinksCmd(view: EditorView): Promise<void> {
  const path = getActiveEditor()?.path;
  const text = view.state.doc.toString();
  const links = extractLinks(text);
  const dir = path ? path.replace(/[\\/][^\\/]*$/, "") : app().workspaceRoot() ?? "";
  const own = headingAnchors(text);
  const broken: { line: number; target: string; why: string }[] = [];
  const anchorCache = new Map<string, Set<string> | null>();
  for (const l of links) {
    if (/^(https?|mailto|ftp|tel|data):/i.test(l.target)) continue;
    const [file, anchor] = l.target.split("#");
    if (!file) {
      if (anchor && !own.has(decodeURIComponent(anchor).toLowerCase())) broken.push({ line: l.line, target: l.target, why: "no heading with this anchor" });
      continue;
    }
    const abs = file.startsWith("/") && app().workspaceRoot() ? `${app().workspaceRoot()}${file}` : `${dir}/${decodeURIComponent(file)}`;
    let stat: { kind: string } | null = null;
    try {
      stat = await invoke<{ kind: string }>("fs_stat", { path: abs, workspace: currentWorkspaceEnv() });
    } catch {
      broken.push({ line: l.line, target: l.target, why: "file not found" });
      continue;
    }
    if (anchor && stat.kind === "file" && /\.(md|markdown|mdx)$/i.test(file)) {
      if (!anchorCache.has(abs)) {
        const r = await native.readFile(abs).catch(() => null);
        anchorCache.set(abs, r?.kind === "text" ? headingAnchors(r.content) : null);
      }
      const set = anchorCache.get(abs);
      if (set && !set.has(decodeURIComponent(anchor).toLowerCase())) broken.push({ line: l.line, target: l.target, why: "anchor not found in that file" });
    }
  }
  if (!broken.length) {
    toast.success(`All ${links.length} local link${links.length === 1 ? "" : "s"} resolve`, { description: "External URLs are not checked." });
    return;
  }
  const pick = await quickPick(
    broken.map((b) => ({ label: b.target, description: `line ${b.line} · ${b.why}`, value: b.line })),
    { title: `${broken.length} broken link${broken.length === 1 ? "" : "s"}` },
  );
  if (pick) {
    const line = view.state.doc.line(pick);
    view.dispatch({ selection: EditorSelection.cursor(line.from), scrollIntoView: true });
    view.focus();
  }
}

export const renumberListsCmd = (view: EditorView) => replaceTarget(view, "Renumber lists", renumberLists);

export async function htmlToMarkdownCmd(view: EditorView): Promise<void> {
  const sel = view.state.selection.main;
  if (!sel.empty) {
    replaceTarget(view, "HTML → Markdown", htmlToMarkdown);
    return;
  }
  // No selection: paste the clipboard's HTML (rich copy from a browser) as Markdown.
  let html = "";
  try {
    for (const item of await navigator.clipboard.read()) {
      if (item.types.includes("text/html")) {
        html = await (await item.getType("text/html")).text();
        break;
      }
    }
  } catch {
    /* fall back to plain text */
  }
  if (!html) html = await readTerminalClipboard();
  if (!html.trim()) {
    toast.info("Copy some formatted text or HTML first, or select HTML to convert");
    return;
  }
  const md = htmlToMarkdown(html);
  view.dispatch({ changes: { from: sel.from, insert: md }, selection: EditorSelection.cursor(sel.from + md.length), userEvent: "input" });
  view.focus();
}

export async function lineNumbersCmd(view: EditorView): Promise<void> {
  const mode = await quickPick(
    [
      { label: "Add line numbers (1. …)", value: "add" },
      { label: "Add line numbers (1: …)", value: "colon" },
      { label: "Remove leading line numbers", value: "remove" },
    ],
    { title: "Line numbers" },
  );
  if (!mode) return;
  replaceTarget(view, "Line numbers", (t) => (mode === "remove" ? removeLineNumbers(t) : addLineNumbers(t, 1, mode === "colon" ? ": " : ". ")));
}

// ── clipboard history ─────────────────────────────────────────────────────

export async function pasteFromHistory(): Promise<void> {
  const list = clipHistory();
  if (!list.length) {
    toast.info("Nothing copied yet in this session");
    return;
  }
  const now = Date.now();
  const pick = await quickPick(
    [
      ...list.map((c) => ({
        label: c.text.replace(/\s+/g, " ").trim().slice(0, 120),
        description: `${compactRelativeTime(c.at, now)} · ${c.text.length} chars${c.text.includes("\n") ? ` · ${c.text.split("\n").length} lines` : ""}`,
        value: c.text as string | null,
      })),
      { label: "Clear clipboard history", value: null },
    ],
    { title: "Clipboard history", placeholder: "Pick an entry to paste it" },
  );
  if (pick === undefined) return;
  if (pick === null) return clearClipHistory();
  const leaf = app().activeTerminalLeaf();
  if (leaf !== null) {
    guardedPasteIntoLeaf(leaf, pick);
    return;
  }
  const ed = getActiveEditor();
  if (ed) {
    ed.view.dispatch(ed.view.state.replaceSelection(pick));
    ed.view.focus();
    return;
  }
  await writeTerminalClipboard(pick);
  toast.success("Copied back to the clipboard");
}

// ── snippets ──────────────────────────────────────────────────────────────

interface UserSnippet {
  name: string;
  body: string;
  lang?: string;
}

const BUILTIN_SNIPPETS: UserSnippet[] = [
  { name: "React component", lang: "js", body: "export function ${1:Component}(${2:props}) {\n\treturn <div>${3}</div>;\n}\n" },
  { name: "useEffect", lang: "js", body: "useEffect(() => {\n\t${1}\n\treturn () => {${2}};\n}, [${3}]);" },
  { name: "Vitest test", lang: "js", body: 'describe("${1:subject}", () => {\n\tit("${2:does something}", () => {\n\t\texpect(${3}).toBe(${4});\n\t});\n});' },
  { name: "async function", lang: "js", body: "async function ${1:name}(${2}) {\n\t${3}\n}" },
  { name: "Python main guard", lang: "py", body: 'def main() -> None:\n\t${1:pass}\n\n\nif __name__ == "__main__":\n\tmain()\n' },
  { name: "Python dataclass", lang: "py", body: "@dataclass\nclass ${1:Name}:\n\t${2:field}: ${3:str}\n" },
  { name: "Rust test module", lang: "rs", body: "#[cfg(test)]\nmod tests {\n\tuse super::*;\n\n\t#[test]\n\tfn ${1:works}() {\n\t\t${2}\n\t}\n}" },
  { name: "Go error check", lang: "go", body: "if err != nil {\n\treturn ${1:nil, }err\n}" },
  { name: "Go table test", lang: "go", body: 'func Test${1:Name}(t *testing.T) {\n\ttests := []struct {\n\t\tname string\n\t\t${2}\n\t}{\n\t\t{name: "${3}"},\n\t}\n\tfor _, tt := range tests {\n\t\tt.Run(tt.name, func(t *testing.T) {\n\t\t\t${4}\n\t\t})\n\t}\n}' },
  { name: "Bash strict header", lang: "sh", body: "#!/usr/bin/env bash\nset -euo pipefail\nIFS=$'\\n\\t'\n\n${1}" },
  { name: "Markdown details", body: "<details>\n<summary>${1:Summary}</summary>\n\n${2}\n\n</details>" },
  { name: "TODO with date", body: "TODO(${1:me}, ${CURRENT_YEAR}-${CURRENT_MONTH}-${CURRENT_DATE}): ${2}" },
];

function expandVariables(body: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ed = getActiveEditor();
  const vars: Record<string, string> = {
    CURRENT_YEAR: String(d.getFullYear()),
    CURRENT_MONTH: pad(d.getMonth() + 1),
    CURRENT_DATE: pad(d.getDate()),
    CURRENT_HOUR: pad(d.getHours()),
    CURRENT_MINUTE: pad(d.getMinutes()),
    TM_FILENAME: ed?.path ? baseName(ed.path) : "",
    TM_FILENAME_BASE: ed?.path ? baseName(ed.path).replace(/\.[^.]+$/, "") : "",
    UUID: crypto.randomUUID(),
  };
  return body.replace(/\$\{([A-Z_]+)\}|\$([A-Z_]{4,})/g, (m, a?: string, b?: string) => vars[(a ?? b)!] ?? m);
}

export function userSnippets(): UserSnippet[] {
  try {
    const raw = getFeature("editor.snippets");
    const parsed = JSON.parse(raw || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((s): s is UserSnippet => !!s && typeof s.name === "string" && typeof s.body === "string") : [];
  } catch {
    return [];
  }
}

export async function insertSnippetCmd(view: EditorView, lang: string): Promise<void> {
  const fam = family(view, lang);
  const all = [...userSnippets().map((s) => ({ ...s, user: true })), ...BUILTIN_SNIPPETS.map((s) => ({ ...s, user: false }))].filter((s) => !s.lang || s.lang === fam || s.lang === lang);
  const pick = await quickPick(
    all.map((s) => ({ label: s.name, description: s.user ? "your snippet" : "built-in", detail: s.body.replace(/\s+/g, " ").slice(0, 100), value: s })),
    { title: "Insert snippet", placeholder: "Add your own under Settings → Features → Snippets", emptyText: "No snippets for this language" },
  );
  if (!pick) return;
  const sel = view.state.selection.main;
  // CodeMirror snippets use ${n:placeholder} / ${n} like VS Code; tabs follow the file's indent.
  const body = expandVariables(pick.body).replace(/\$(\d+)/g, "${$1}").replace(/\t/g, view.state.facet(indentUnit));
  snippet(body.replace(/\$\{SELECTION\}|\$\{TM_SELECTED_TEXT\}/g, view.state.sliceDoc(sel.from, sel.to)))(view, null, sel.from, sel.to);
  view.focus();
}

// ── scratchpad, file info, hex, data URI ──────────────────────────────────

export async function openScratchpad(): Promise<void> {
  const dir = (await appDataDir()).replace(/[\\/]+$/, "");
  const path = `${dir}/scratchpad.md`;
  const exists = await native.readFile(path).then(() => true).catch(() => false);
  if (!exists) await native.writeFile(path, "# Scratchpad\n\nNotes here are kept between sessions.\n", "user");
  app().openFile(path);
}

async function readBytes(path: string, max?: number) {
  return invoke<{ data: string; size: number; truncated: boolean }>("fs_read_bytes", { path, maxBytes: max ?? null, workspace: currentWorkspaceEnv() });
}

function requirePath(): string | null {
  const p = getActiveEditor()?.path;
  if (!p) toast.error("Open a saved file in the editor first");
  return p ?? null;
}

export async function fileInfoCmd(): Promise<void> {
  const path = requirePath();
  if (!path) return;
  const ed = getActiveEditor()!;
  const [stat, head] = await Promise.all([
    invoke<{ size: number; mtime: number }>("fs_stat", { path, workspace: currentWorkspaceEnv() }).catch(() => null),
    readBytes(path, 64 * 1024).catch(() => null),
  ]);
  const info = head ? describeBytes(base64ToBytes(head.data)) : null;
  const doc = ed.view.state.doc;
  const words = doc.toString().match(/\S+/g)?.length ?? 0;
  const digest = head && !head.truncated ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", base64ToBytes(head.data))), (b) => b.toString(16).padStart(2, "0")).join("") : null;
  const repo = await native.gitResolveRepo(path.replace(/[\\/][^\\/]*$/, "")).catch(() => null);
  let lastCommit = "";
  if (repo) {
    const rel = path.replace(/\\/g, "/").slice(repo.repoRoot.replace(/\\/g, "/").replace(/\/+$/, "").length + 1);
    const r = await native.runCommand(`git log -1 --format="%h %an, %ar: %s" -- "${rel}"`, repo.repoRoot, 10).catch(() => null);
    lastCommit = r?.stdout.trim() || "not committed";
  }
  const rows = [
    ["Path", path],
    ["Size", stat ? `${stat.size.toLocaleString()} bytes` : "?"],
    ["Modified", stat ? new Date(stat.mtime).toLocaleString() : "?"],
    ["Lines / words / chars", `${doc.lines.toLocaleString()} / ${words.toLocaleString()} / ${doc.length.toLocaleString()}`],
    ["Encoding", info?.encoding ?? "?"],
    ["Line endings", info?.eol ?? "?"],
    ["Language", ed.languageId || "plain text"],
    ["SHA-256", digest ?? "(file larger than 64 KiB — use Tools: File checksum)"],
    ...(repo ? [["Last commit", lastCommit]] : []),
  ];
  const pick = await quickPick(rows.map(([k, v]) => ({ label: v, description: k, value: v })), { title: baseName(path), placeholder: "Pick a value to copy" });
  if (pick) {
    await writeTerminalClipboard(pick);
    toast.success("Copied");
  }
}

export async function hexViewCmd(): Promise<void> {
  const path = requirePath();
  if (!path) return;
  const r = await readBytes(path, 256 * 1024).catch((e) => {
    toast.error("Could not read the file", { description: String(e) });
    return null;
  });
  if (!r) return;
  openTextViewer(`${baseName(path)} — hex${r.truncated ? ` (first 256 KiB of ${r.size.toLocaleString()} bytes)` : ""}`, hexDump(base64ToBytes(r.data)));
}

export async function copyDataUriCmd(): Promise<void> {
  const path = requirePath();
  if (!path) return;
  const r = await readBytes(path, 10 * 1024 * 1024).catch(() => null);
  if (!r || r.truncated) {
    toast.error("File too large for a data URI (10 MB max)");
    return;
  }
  const uri = `data:${mimeForPath(path)};base64,${r.data}`;
  await writeTerminalClipboard(uri);
  toast.success("Copied data URI", { description: `${(uri.length / 1024).toFixed(1)} KB` });
}

export async function goToClipboardLocation(): Promise<void> {
  const clip = (await readTerminalClipboard()).trim();
  const m = /^(?:file:\/\/)?(.+?)(?:[:(](\d+)(?:[:,](\d+))?\)?)?$/.exec(clip.split("\n")[0]);
  if (!m || !m[1]) {
    toast.info("Copy a location like src/app.ts:42 first");
    return;
  }
  let p = m[1].replace(/^["']|["']$/g, "");
  const root = app().workspaceRoot();
  if (!/^([A-Za-z]:[\\/]|\/|\\\\)/.test(p) && root) p = `${root.replace(/[\\/]+$/, "")}/${p.replace(/^\.\//, "")}`;
  const ok = await invoke("fs_stat", { path: p, workspace: currentWorkspaceEnv() }).then(() => true).catch(() => false);
  if (!ok) {
    toast.error("No such file", { description: p });
    return;
  }
  app().openFile(p, m[2] ? Number(m[2]) : undefined);
}

export const CODE_TOOL_ACTIONS: CodeActionDescriptor[] = [
  { id: "code.insertDebugLog", label: "Insert debug log for variable / selection", keywords: ["console.log", "print", "debug", "turbo console log", "dbg", "log"], run: (v, l) => insertDebugLogCmd(v, l) },
  { id: "code.removeDebugLogs", label: "Remove debug logs…", keywords: ["console.log", "print", "debug", "clean", "remove"], run: (v, l) => void removeDebugLogsCmd(v, l) },
  { id: "code.surroundWith", label: "Surround with (try/catch, if, for…)…", keywords: ["wrap", "try", "catch", "if", "for", "block", "region"], run: (v, l) => void surroundWithCmd(v, l) },
  { id: "code.extractVariable", label: "Extract to variable…", keywords: ["refactor", "extract", "variable", "const", "introduce"], run: (v, l) => void extractVariableCmd(v, l) },
  { id: "code.concatToTemplate", label: "Convert string concatenation to template literal", keywords: ["template", "string", "concat", "backtick", "interpolate"], run: (v) => concatToTemplateCmd(v) },
  { id: "text.proseLint", label: "Check writing (repeated words, passive voice, wordiness)", keywords: ["prose", "grammar", "writing", "lint", "style", "write-good", "docs"], run: (v) => void proseLintCmd(v) },
  { id: "md.checkLinks", label: "Markdown: Check local links and anchors", keywords: ["markdown", "links", "broken", "dead", "anchor", "readme"], run: (v) => void checkMarkdownLinksCmd(v) },
  { id: "md.renumberLists", label: "Markdown: Renumber ordered lists", keywords: ["markdown", "list", "numbers", "renumber", "ordered"], run: (v) => renumberListsCmd(v) },
  { id: "md.htmlToMarkdown", label: "Markdown: Convert HTML / paste rich text as Markdown", keywords: ["html", "markdown", "paste", "convert", "rich text", "web page"], run: (v) => void htmlToMarkdownCmd(v) },
  { id: "text.lineNumbers", label: "Add / remove line numbers…", keywords: ["line numbers", "numbering", "prefix", "strip"], run: (v) => void lineNumbersCmd(v) },
  { id: "text.insertSnippet", label: "Insert snippet…", keywords: ["snippet", "template", "boilerplate", "tab stops"], run: (v, l) => void insertSnippetCmd(v, l) },
];

export const FILE_TOOL_ACTIONS = [
  { id: "clipboard.history", label: "Paste from clipboard history…", keywords: ["clipboard", "history", "paste", "copied", "ring", "previous"], run: pasteFromHistory },
  { id: "file.scratchpad", label: "Open scratchpad", keywords: ["notes", "scratch", "memo", "jot", "todo"], run: openScratchpad },
  { id: "file.info", label: "File: Show info (size, encoding, line endings, SHA-256, last commit)", keywords: ["file", "info", "properties", "encoding", "eol", "crlf", "hash"], run: fileInfoCmd },
  { id: "file.hexView", label: "File: View as hex dump", keywords: ["hex", "binary", "xxd", "bytes", "dump"], run: hexViewCmd },
  { id: "file.dataUri", label: "File: Copy as data URI (base64)", keywords: ["data uri", "base64", "embed", "image", "inline"], run: copyDataUriCmd },
  { id: "file.gotoClipboard", label: "Go to file:line from clipboard", keywords: ["open", "location", "stack trace", "path", "line", "clipboard"], run: goToClipboardLocation },
];
