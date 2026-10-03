// Editor text tools exposed as CodeMirror commands, palette actions ("Text"
// group) and keybindings. Pure logic lives in sibling modules; this file
// only maps it onto selections.

import { EditorSelection, type EditorState, type SelectionRange } from "@codemirror/state";
import { EditorView, type KeyBinding } from "@codemirror/view";
import type { CodeActionDescriptor } from "../codeActions";
import { incrementAt } from "./increment";
import { cycleToken, tokenAt } from "./cycleWord";
import { findEnclosingPair, pairFor, wrap, type Pair } from "./surround";
import { inputBox, quickPick } from "@/modules/quick-pick";
import { parseJson5 } from "@/lib/lang/json5";
import { toast } from "sonner";
import { detectJsonIndent, parseYaml, sortKeysDeep, toYaml } from "./yaml";
import { CODECS, type CodecId } from "./encoding";
import { allHashes } from "./hash";
import { convertTimestamp, nanoid, ulid, uuidV4, uuidV7 } from "./ids";
import { findJwt, inspectJwt } from "./jwtInspect";
import { calculate, formatResult, sumNumbers } from "./calc";
import { describeCron, findCron, upcomingRuns } from "./cronExplain";
import { findColors, formatColor, type ColorFormat } from "./colors";
import {
  allStoredBookmarks,
  clearAllStoredBookmarks,
  clearBookmarks,
  gotoBookmark,
  toggleBookmark,
} from "../bookmarks";
import { app } from "@/app/appBridge";
import { documentOutline, markdownHeadings } from "./outline";
import { getActiveEditor } from "../activeEditor";
import { computeRename, prepareRename } from "@/lib/lang/rename";
import { parseSequenceSpec } from "./sequence";
import { toggleWrap, upsertToc } from "./markdown";
import { formatSql } from "./sql";
import { formatMarkup, minifyMarkup } from "./markup";
import { convertQuotes, nextQuote, stringAt } from "./quotes";
import { sortJsImports, sortPythonImports } from "./sortImports";
import { rewrap } from "./rewrap";
import { alignLines } from "./align";
import { resolveAll, type Resolution } from "./conflicts";
import { gotoConflict, resolveConflictAtCursor } from "../conflictLens";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  alignDelimited,
  csvToMarkdown,
  formatAllMarkdownTables,
  formatMarkdownTable,
  markdownToCsv,
  shrinkDelimited,
} from "./tables";

type RangeEdit = { from: number; to: number; insert: string; select?: "all" | "end" };

/**
 * Apply an edit per selection range (multi-cursor aware). Ranges whose
 * function returns null are left alone; returns false if nothing changed.
 */
export function editEachRange(
  view: EditorView,
  fn: (range: SelectionRange, state: EditorState) => RangeEdit | null,
): boolean {
  const { state } = view;
  const tr = state.changeByRange((range) => {
    const edit = fn(range, state);
    if (!edit) return { range };
    const end = edit.from + edit.insert.length;
    const next =
      edit.select === "all"
        ? EditorSelection.range(edit.from, end)
        : edit.select === "end"
          ? EditorSelection.cursor(end)
          : range.empty
            ? EditorSelection.cursor(end) // like Vim: cursor lands on the edited token's end
            : EditorSelection.range(edit.from, end);
    return {
      changes: { from: edit.from, to: edit.to, insert: edit.insert },
      range: next,
    };
  });
  if (tr.changes.empty) return false;
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input" }));
  return true;
}

export function incrementCmd(delta: number) {
  return (view: EditorView): boolean =>
    editEachRange(view, (range, state) => {
      const line = state.doc.lineAt(range.head);
      const hit = incrementAt(line.text, range.head - line.from, delta);
      if (!hit) return null;
      return { from: line.from + hit.from, to: line.from + hit.to, insert: hit.text, select: range.empty ? undefined : "all" };
    });
}

export function cycleWordCmd(direction: 1 | -1) {
  return (view: EditorView): boolean =>
    editEachRange(view, (range, state) => {
      const line = state.doc.lineAt(range.head);
      const tok = range.empty
        ? tokenAt(line.text, range.head - line.from)
        : range.from >= line.from && range.to <= line.to
          ? { from: range.from - line.from, to: range.to - line.from, text: state.sliceDoc(range.from, range.to) }
          : null;
      if (!tok) return null;
      const next = cycleToken(tok.text, direction);
      if (next === null) return null;
      return { from: line.from + tok.from, to: line.from + tok.to, insert: next, select: range.empty ? "end" : "all" };
    });
}

const SURROUND_CHOICES = ['"', "'", "`", "(", "[", "{", "<>", "**", "_", "~~"];

async function choosePair(title: string): Promise<Pair | undefined> {
  const choice = await quickPick(
    [
      ...SURROUND_CHOICES.map((c) => {
        const p = c === "<>" ? { open: "<", close: ">" } : pairFor(c);
        return { label: `${p.open} … ${p.close}`, value: p as Pair | "tag" };
      }),
      { label: "HTML/XML tag…", detail: "e.g. div, span class=\"x\", a href=\"#\"", value: "tag" as const },
    ],
    { title, placeholder: "Pick a pair or type a tag name", allowCustom: false },
  );
  if (choice === "tag") {
    const tag = await inputBox({ title: "Tag", placeholder: 'div class="box"', validate: (v) => (/^[A-Za-z]/.test(v.trim()) ? null : "Enter a tag name") });
    return tag ? pairFor(`<${tag.trim()}>`) : undefined;
  }
  return choice;
}

export async function surroundSelection(view: EditorView): Promise<boolean> {
  if (view.state.selection.ranges.every((r) => r.empty)) {
    // Like vim-surround's `ysiw`: wrap the word under each cursor.
    view.dispatch({
      selection: EditorSelection.create(
        view.state.selection.ranges.map((r) => {
          const w = view.state.wordAt(r.head);
          return w ? EditorSelection.range(w.from, w.to) : r;
        }),
        view.state.selection.mainIndex,
      ),
    });
  }
  const pair = await choosePair("Surround with");
  if (!pair) return false;
  view.focus();
  return editEachRange(view, (range, state) =>
    range.empty ? null : { from: range.from, to: range.to, insert: wrap(state.sliceDoc(range.from, range.to), pair), select: "all" },
  );
}

/** Remove (or, with `replacement`, change) the innermost pair around each range. */
function editEnclosing(view: EditorView, replacement: Pair | null): boolean {
  const doc = view.state.doc.toString();
  const changes: Array<{ from: number; to: number; insert: string }> = [];
  const seen = new Set<number>();
  for (const r of view.state.selection.ranges) {
    const p = findEnclosingPair(doc, r.from, r.to);
    if (!p || seen.has(p.openFrom)) continue;
    seen.add(p.openFrom);
    changes.push({ from: p.openFrom, to: p.openTo, insert: replacement?.open ?? "" });
    changes.push({ from: p.closeFrom, to: p.closeTo, insert: replacement?.close ?? "" });
  }
  if (changes.length === 0) return false;
  view.dispatch({ changes, scrollIntoView: true, userEvent: "input" });
  return true;
}

export const removeSurroundCmd = (view: EditorView) => editEnclosing(view, null);

export async function changeSurround(view: EditorView): Promise<boolean> {
  const doc = view.state.doc.toString();
  const r = view.state.selection.main;
  if (!findEnclosingPair(doc, r.from, r.to)) return false;
  const pair = await choosePair("Change surrounding pair to");
  if (!pair) return false;
  view.focus();
  return editEnclosing(view, pair);
}

/** The main selection, or the whole document when nothing is selected. */
function targetRange(view: EditorView): { from: number; to: number; text: string } {
  const sel = view.state.selection.main;
  const from = sel.empty ? 0 : sel.from;
  const to = sel.empty ? view.state.doc.length : sel.to;
  return { from, to, text: view.state.sliceDoc(from, to) };
}

function replaceTarget(view: EditorView, label: string, transform: (text: string) => string): boolean {
  const { from, to, text } = targetRange(view);
  let out: string;
  try {
    out = transform(text);
  } catch (e) {
    toast.error(`${label} failed`, { description: e instanceof Error ? e.message : String(e) });
    return false;
  }
  if (out === text) return false;
  view.dispatch({
    changes: { from, to, insert: out },
    selection: EditorSelection.range(from, from + out.length),
    scrollIntoView: true,
    userEvent: "input",
  });
  view.focus();
  return true;
}

export const jsonToYamlCmd = (view: EditorView) => replaceTarget(view, "JSON → YAML", (t) => toYaml(parseJson5(t)));
export const yamlToJsonCmd = (view: EditorView) =>
  replaceTarget(view, "YAML → JSON", (t) => `${JSON.stringify(parseYaml(t), null, 2)}\n`);
export const sortJsonKeysCmd = (view: EditorView) =>
  replaceTarget(view, "Sort JSON keys", (t) => {
    const trailing = t.endsWith("\n") ? "\n" : "";
    return JSON.stringify(sortKeysDeep(parseJson5(t)), null, detectJsonIndent(t)) + trailing;
  });

export const formatTablesCmd = (view: EditorView) =>
  view.state.selection.main.empty
    ? replaceTarget(view, "Format tables", formatAllMarkdownTables)
    : replaceTarget(view, "Format table", formatMarkdownTable);

/**
 * Transform every selection; an empty selection means its whole line. Errors
 * are reported once and leave the document untouched.
 */
export function transformSelections(view: EditorView, label: string, fn: (text: string) => string): boolean {
  let error: unknown = null;
  const ranges = view.state.selection.ranges.map((r) => {
    if (!r.empty) return { from: r.from, to: r.to };
    const line = view.state.doc.lineAt(r.head);
    const lead = line.text.length - line.text.trimStart().length;
    return { from: line.from + lead, to: line.to - (line.text.length - line.text.trimEnd().length) };
  });
  const changes = ranges.map(({ from, to }) => {
    try {
      return { from, to, insert: fn(view.state.sliceDoc(from, to)) };
    } catch (e) {
      error ??= e;
      return { from, to, insert: view.state.sliceDoc(from, to) };
    }
  });
  if (error) {
    toast.error(`${label} failed`, { description: error instanceof Error ? error.message : String(error) });
    return false;
  }
  view.dispatch({ changes, scrollIntoView: true, userEvent: "input" });
  view.focus();
  return true;
}

async function codecCmd(view: EditorView, mode: "encode" | "decode"): Promise<boolean> {
  const id = await quickPick(
    (Object.keys(CODECS) as CodecId[]).map((k) => ({ label: CODECS[k].label, value: k })),
    { title: mode === "encode" ? "Encode selection as" : "Decode selection from" },
  );
  if (!id) return false;
  const { label, codec } = CODECS[id];
  return transformSelections(view, `${mode === "encode" ? "Encode" : "Decode"} ${label}`, codec[mode]);
}

export async function hashSelectionCmd(view: EditorView): Promise<boolean> {
  const sel = view.state.selection.main;
  const whole = sel.empty;
  const text = whole ? view.state.doc.toString() : view.state.sliceDoc(sel.from, sel.to);
  const pick = await quickPick(
    allHashes(text).then((list) =>
      list.map((h) => ({ label: h.digest, description: h.algo, keywords: [h.algo], value: h })),
    ),
    {
      title: `Hashes of ${whole ? "the whole file" : `the selection (${text.length} chars)`}`,
      placeholder: "Pick a digest to copy",
    },
  );
  if (!pick) return false;
  const action = await quickPick(
    [
      { label: "Copy to clipboard", value: "copy" as const },
      ...(whole ? [] : [{ label: "Replace selection", value: "replace" as const }]),
      { label: "Insert after selection", value: "insert" as const },
    ],
    { title: `${pick.algo}: ${pick.digest}` },
  );
  if (!action) return false;
  if (action === "copy") {
    await navigator.clipboard.writeText(pick.digest).catch(() => {});
    toast.success(`Copied ${pick.algo}`, { description: pick.digest });
    return true;
  }
  const at = whole ? view.state.doc.length : sel.to;
  view.dispatch(
    action === "replace"
      ? { changes: { from: sel.from, to: sel.to, insert: pick.digest } }
      : { changes: { from: at, insert: ` ${pick.digest}` } },
  );
  view.focus();
  return true;
}

/** Insert a freshly generated value at every cursor (replacing selections). */
function insertGenerated(gen: () => string) {
  return (view: EditorView): boolean =>
    editEachRange(view, (range) => ({ from: range.from, to: range.to, insert: gen(), select: "end" }));
}

export async function insertTimestampCmd(view: EditorView): Promise<boolean> {
  const now = new Date();
  const choice = await quickPick(
    [
      { label: now.toISOString(), description: "ISO-8601 UTC", value: now.toISOString() },
      { label: String(Math.floor(now.getTime() / 1000)), description: "Unix seconds", value: String(Math.floor(now.getTime() / 1000)) },
      { label: String(now.getTime()), description: "Unix milliseconds", value: String(now.getTime()) },
      { label: now.toISOString().slice(0, 10), description: "Date", value: now.toISOString().slice(0, 10) },
      { label: now.toUTCString(), description: "RFC 7231 (HTTP)", value: now.toUTCString() },
    ],
    { title: "Insert timestamp" },
  );
  if (!choice) return false;
  view.focus();
  return insertGenerated(() => choice)(view);
}

/** Epoch ⇄ ISO for each selection, or the timestamp-looking token at the cursor. */
export function convertTimestampCmd(view: EditorView): boolean {
  let failed = false;
  const changed = editEachRange(view, (range, state) => {
    let from = range.from;
    let to = range.to;
    if (range.empty) {
      const line = state.doc.lineAt(range.head);
      const rel = range.head - line.from;
      const re = /\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?|\d{9,19}/g;
      const m = [...line.text.matchAll(re)].find((x) => x.index! <= rel && rel <= x.index! + x[0].length);
      if (!m) return null;
      from = line.from + m.index!;
      to = from + m[0].length;
    }
    const out = convertTimestamp(state.sliceDoc(from, to));
    if (out === null) {
      failed = true;
      return null;
    }
    return { from, to, insert: out, select: "all" };
  });
  if (!changed && failed) toast.error("Not a timestamp", { description: "Select a Unix epoch or an ISO-8601 date." });
  return changed;
}

/** Decode a JWT from the selection, the cursor line, the file or the clipboard. */
export async function inspectJwtCmd(view: EditorView | null): Promise<boolean> {
  let token: string | null = null;
  if (view) {
    const sel = view.state.selection.main;
    token =
      findJwt(view.state.sliceDoc(sel.from, sel.to)) ??
      findJwt(view.state.doc.lineAt(sel.head).text) ??
      findJwt(view.state.doc.toString());
  }
  if (!token) token = findJwt(await navigator.clipboard.readText().catch(() => ""));
  if (!token) {
    toast.error("No JWT found", { description: "Select a token or copy one to the clipboard." });
    return false;
  }
  const report = inspectJwt(token);
  if (!report) {
    toast.error("That token does not decode as a JWT");
    return false;
  }
  const json = JSON.stringify({ header: report.header, payload: report.payload }, null, 2);
  const picked = await quickPick(
    [
      { label: "Copy decoded header and payload as JSON", group: "Actions", value: json },
      ...report.rows.map((r) => ({ label: `${r.key}: ${r.value}`, description: r.note, group: "Claims", value: r.value })),
    ],
    { title: `JWT · ${report.summary} (signature not verified)`, placeholder: "Filter claims; Enter copies" },
  );
  if (picked === undefined) return false;
  await navigator.clipboard.writeText(picked).catch(() => {});
  toast.success("Copied", { description: picked.length > 80 ? `${picked.slice(0, 80)}…` : picked });
  return true;
}

export function sumSelectionsCmd(view: EditorView): boolean {
  const texts = view.state.selection.ranges.map((r) =>
    r.empty ? view.state.doc.lineAt(r.head).text : view.state.sliceDoc(r.from, r.to),
  );
  const { sum, count } = sumNumbers(texts);
  if (count === 0) {
    toast.info("No numbers in the selection");
    return false;
  }
  const avg = formatResult(sum / count);
  toast.info(`Sum ${formatResult(sum)}`, { description: `${count} number${count === 1 ? "" : "s"} · average ${avg}` });
  return true;
}

export async function explainCronCmd(view: EditorView): Promise<boolean> {
  const sel = view.state.selection.main;
  const text = sel.empty ? view.state.doc.lineAt(sel.head).text : view.state.sliceDoc(sel.from, sel.to);
  const expr = sel.empty ? findCron(text) : (findCron(text) ?? text.trim());
  if (!expr) {
    toast.error("No cron expression on this line");
    return false;
  }
  let description: string;
  let runs: Date[];
  try {
    description = describeCron(expr);
    runs = upcomingRuns(expr, 8);
  } catch (e) {
    toast.error(`Invalid cron expression: ${expr}`, { description: e instanceof Error ? e.message : String(e) });
    return false;
  }
  await quickPick(
    [
      { label: description, description: expr, group: "Meaning", value: description },
      ...runs.map((d) => ({
        label: d.toISOString().replace("T", " ").slice(0, 16) + " UTC",
        description: d.toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" }),
        group: "Next runs",
        value: d.toISOString(),
      })),
    ],
    { title: `cron: ${expr}`, placeholder: "Enter copies the selected line" },
  ).then((v) => {
    if (v) void navigator.clipboard.writeText(v).catch(() => {});
  });
  return true;
}

/** Convert every colour literal in the selections (or cursor lines) to one notation. */
export async function convertColorsCmd(view: EditorView): Promise<boolean> {
  const format = await quickPick<ColorFormat>(
    [
      { label: "Hex", description: "#rrggbb", value: "hex" },
      { label: "RGB", description: "rgb(r, g, b)", value: "rgb" },
      { label: "HSL", description: "hsl(h, s%, l%)", value: "hsl" },
    ],
    { title: "Convert colours to" },
  );
  if (!format) return false;
  view.focus();
  return transformSelections(view, "Convert colours", (text) => {
    let out = "";
    let last = 0;
    for (const c of findColors(text)) {
      out += text.slice(last, c.from) + formatColor(c.color, format);
      last = c.to;
    }
    return out + text.slice(last);
  });
}

export async function listBookmarks(): Promise<void> {
  const all = allStoredBookmarks();
  if (all.length === 0) {
    toast.info("No bookmarks yet", { description: "Toggle one with Mod+Alt+K in the editor." });
    return;
  }
  const pick = await quickPick(
    all.map((b) => ({
      label: b.preview || "(blank line)",
      description: `${b.path.replace(/^.*[\\/]/, "")}:${b.line}`,
      detail: b.path,
      group: b.path.replace(/^.*[\\/]/, ""),
      value: b,
    })),
    { title: "Bookmarks", placeholder: "Search bookmarks…" },
  );
  if (pick) app().openFile(pick.path, pick.line);
}

export function clearEveryBookmark(): void {
  clearAllStoredBookmarks();
  toast.success("All bookmarks cleared", { description: "Open editors keep theirs until closed." });
}

const KIND_ICON: Record<string, string> = {
  function: "ƒ",
  method: "ƒ",
  class: "◇",
  interface: "◈",
  type: "τ",
  enum: "∈",
  struct: "▣",
  trait: "◈",
  module: "▤",
  variable: "𝑥",
};

export async function goToSymbolCmd(view: EditorView, languageId: string): Promise<boolean> {
  const source = view.state.doc.toString();
  let items = documentOutline(source, languageId);
  if (items.length === 0) items = markdownHeadings(source);
  if (items.length === 0) {
    toast.info("No symbols found in this file");
    return false;
  }
  const pick = await quickPick(
    items.map((it) => ({
      label: `${"  ".repeat(it.depth)}${KIND_ICON[it.kind] ?? "#"} ${it.name}`,
      description: `${it.kind} · line ${view.state.doc.lineAt(it.from).number}`,
      detail: it.container || undefined,
      keywords: [it.name, it.container, it.kind],
      value: it,
    })),
    { title: "Go to symbol in file", placeholder: "Type a symbol name…" },
  );
  if (!pick) return false;
  // Select the name itself when it can be found on the declaration line.
  const line = view.state.doc.lineAt(pick.from);
  const at = line.text.indexOf(pick.name, pick.from - line.from);
  const anchor = at === -1 ? pick.from : line.from + at;
  view.dispatch({
    selection: at === -1 ? { anchor } : { anchor, head: anchor + pick.name.length },
    effects: EditorView.scrollIntoView(anchor, { y: "center" }),
  });
  view.focus();
  return true;
}

/** Prompt for "line" or "line:column" and jump there in the active editor. */
export async function goToLinePrompt(): Promise<void> {
  const active = getActiveEditor();
  if (!active) {
    toast.error("Open a file in the editor first");
    return;
  }
  const { view } = active;
  const total = view.state.doc.lines;
  const current = view.state.doc.lineAt(view.state.selection.main.head).number;
  const value = await inputBox({
    title: "Go to line",
    placeholder: `1–${total}, optionally :column (current ${current})`,
    validate: (v) => (/^\s*[-+]?\d+(\s*[:,]\s*\d+)?\s*$/.test(v) || v.trim() === "" ? null : "Use line or line:column"),
  });
  if (!value?.trim()) return;
  const [rawLine, rawCol] = value.split(/[:,]/).map((x) => x.trim());
  // "+5" / "-5" are relative to the current line, like Vim and Sublime.
  let line = /^[+-]/.test(rawLine) ? current + Number(rawLine) : Number(rawLine);
  line = Math.min(Math.max(1, line), total);
  const l = view.state.doc.line(line);
  const pos = Math.min(l.to, l.from + Math.max(0, Number(rawCol ?? 1) - 1));
  view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
  view.focus();
}

/** Scope-aware rename of the symbol under the cursor using the in-process binder. */
export async function renameSymbolLocal(view: EditorView, languageId: string): Promise<boolean> {
  const source = view.state.doc.toString();
  const offset = view.state.selection.main.head;
  const prep = prepareRename(source, languageId, offset);
  if ("error" in prep) {
    toast.error("Can't rename here", { description: prep.error });
    return false;
  }
  const newName = await inputBox({
    title: `Rename '${prep.placeholder}'`,
    value: prep.placeholder,
    prompt: "Renames this binding and its uses in scope; shadowed names, strings and comments are left alone.",
    validate: (v) => {
      if (v === prep.placeholder) return null;
      const r = computeRename(source, languageId, offset, v);
      return "error" in r ? r.error : null;
    },
  });
  if (!newName || newName === prep.placeholder) return false;
  // The document may have changed while the box was open.
  if (view.state.doc.toString() !== source) {
    toast.error("The file changed during rename; try again");
    return false;
  }
  const result = computeRename(source, languageId, offset, newName);
  if ("error" in result) {
    toast.error("Rename failed", { description: result.error });
    return false;
  }
  view.dispatch({ changes: result.edits, userEvent: "input.rename", scrollIntoView: true });
  view.focus();
  toast.success(`Renamed ${result.edits.length} occurrence${result.edits.length === 1 ? "" : "s"}`);
  return true;
}

export async function insertSequenceCmd(view: EditorView): Promise<boolean> {
  const n = view.state.selection.ranges.length;
  const spec = await inputBox({
    title: `Insert sequence at ${n} cursor${n === 1 ? "" : "s"}`,
    value: "1",
    prompt: "start[,step] — 1 · 0,10 · 007 · 0x0a · a · A,2 · 1.5,0.5",
    validate: (v) => (parseSequenceSpec(v) ? null : "Use start[,step]; start may be a number, 007, 0x0f or a letter"),
  });
  if (spec === undefined) return false;
  const gen = parseSequenceSpec(spec)!;
  view.focus();
  // Number cursors in document order regardless of the order they were added.
  const order = view.state.selection.ranges.map((r, i) => ({ r, i })).sort((a, b) => a.r.from - b.r.from);
  const valueFor = new Map(order.map(({ i }, k) => [i, gen(k)]));
  let idx = 0;
  return editEachRange(view, (range) => {
    const value = valueFor.get(idx++) ?? "";
    return { from: range.from, to: range.to, insert: value, select: "end" };
  });
}

/** Put a cursor at the end of every line touched by the selections (VS Code Shift+Alt+I). */
export function cursorsAtLineEnds(view: EditorView): boolean {
  const { state } = view;
  const ranges: SelectionRange[] = [];
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number;
    // A selection ending at column 0 doesn't include that last line.
    const lastPos = r.to > r.from && state.doc.lineAt(r.to).from === r.to ? r.to - 1 : r.to;
    const last = state.doc.lineAt(lastPos).number;
    for (let n = first; n <= last; n++) ranges.push(EditorSelection.cursor(state.doc.line(n).to));
  }
  if (ranges.length <= 1) return false;
  view.dispatch({ selection: EditorSelection.create(ranges) });
  return true;
}

export function markdownTocCmd(view: EditorView): boolean {
  const doc = view.state.doc.toString();
  // Without markers, insert before the first second-level heading (after the intro).
  const firstH2 = doc.search(/^##\s/m);
  const { text, updated } = upsertToc(doc, firstH2 === -1 ? view.state.selection.main.head : firstH2);
  if (text === doc) return false;
  view.dispatch({ changes: { from: 0, to: doc.length, insert: text }, userEvent: "input" });
  toast.success(updated ? "Table of contents updated" : "Table of contents inserted");
  return true;
}

export function toggleMarkdownWrap(marker: string) {
  return (view: EditorView): boolean => {
    const doc = view.state.doc.toString();
    const tr = view.state.changeByRange((range) => {
      let { from, to } = range;
      if (range.empty) {
        const w = view.state.wordAt(range.head);
        if (w) ({ from, to } = w);
      }
      const r = toggleWrap(doc, from, to, marker);
      return {
        changes: { from: r.from, to: r.to, insert: r.insert },
        range: EditorSelection.range(r.selFrom, r.selTo),
      };
    });
    view.dispatch(view.state.update(tr, { userEvent: "input" }));
    return true;
  };
}

export async function markdownLinkCmd(view: EditorView): Promise<boolean> {
  const sel = view.state.selection.main;
  const text = view.state.sliceDoc(sel.from, sel.to);
  const clip = await navigator.clipboard.readText().catch(() => "");
  const url = await inputBox({
    title: "Link URL",
    value: /^https?:\/\//.test(clip.trim()) ? clip.trim() : "https://",
  });
  if (!url) return false;
  view.focus();
  const label = text || "link";
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: `[${label}](${url})` },
    selection: EditorSelection.range(sel.from + 1, sel.from + 1 + label.length),
  });
  return true;
}

export function cycleQuotesCmd(view: EditorView): boolean {
  let blocked = false;
  const changed = editEachRange(view, (range, state) => {
    const line = state.doc.lineAt(range.head);
    const lit = stringAt(line.text, range.head - line.from);
    if (!lit) return null;
    const text = line.text.slice(lit.from, lit.to);
    let to = nextQuote(lit.quote);
    let out = convertQuotes(text, to);
    if (out === null && lit.quote === "`") return ((blocked = true), null);
    if (out === null) {
      to = nextQuote(to);
      out = convertQuotes(text, to);
    }
    if (out === null) return null;
    return { from: line.from + lit.from, to: line.from + lit.to, insert: out, select: range.empty ? undefined : "all" };
  });
  if (!changed && blocked) toast.info("Template literals with ${…} can't change quote style");
  return changed;
}

export function sortImportsCmd(view: EditorView, languageId: string): boolean {
  const lang = languageId.toLowerCase();
  const doc = view.state.doc.toString();
  const sorter = /python|^py$/.test(lang)
    ? sortPythonImports
    : /javascript|typescript|jsx|tsx|^js$|^ts$|svelte|vue/.test(lang)
      ? sortJsImports
      : null;
  if (!sorter) {
    toast.info("Sort imports supports JavaScript, TypeScript and Python");
    return false;
  }
  const next = sorter(doc);
  if (next === doc) {
    toast.info("Imports are already sorted");
    return false;
  }
  // Minimal change range so the cursor and undo history stay sensible.
  let a = 0;
  while (a < doc.length && doc[a] === next[a]) a++;
  let b = 0;
  while (b < doc.length - a && doc[doc.length - 1 - b] === next[next.length - 1 - b]) b++;
  view.dispatch({ changes: { from: a, to: doc.length - b, insert: next.slice(a, next.length - b) }, userEvent: "input" });
  return true;
}

/** Rewrap the selected lines, or the paragraph around the cursor, at the wrap column. */
export function rewrapCmd(view: EditorView): boolean {
  const { state } = view;
  const width = usePreferencesStore.getState().wordWrapColumn || 80;
  const sel = state.selection.main;
  let first = state.doc.lineAt(sel.from).number;
  let last = state.doc.lineAt(sel.to > sel.from && state.doc.lineAt(sel.to).from === sel.to ? sel.to - 1 : sel.to).number;
  if (sel.empty) {
    const blank = (n: number) => /^\s*(\/\/+|#+|\*|--|;+|>+)?\s*$/.test(state.doc.line(n).text);
    if (blank(first)) return false;
    while (first > 1 && !blank(first - 1)) first--;
    while (last < state.doc.lines && !blank(last + 1)) last++;
  }
  const lines: string[] = [];
  for (let n = first; n <= last; n++) lines.push(state.doc.line(n).text);
  const next = rewrap(lines, width).join("\n");
  const from = state.doc.line(first).from;
  const to = state.doc.line(last).to;
  if (next === state.sliceDoc(from, to)) return false;
  view.dispatch({ changes: { from, to, insert: next }, userEvent: "input" });
  return true;
}

/** Align the selected lines (or the block around the cursor) on =, :, => … */
export function alignCmd(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  let first = state.doc.lineAt(sel.from).number;
  let last = state.doc.lineAt(sel.to > sel.from && state.doc.lineAt(sel.to).from === sel.to ? sel.to - 1 : sel.to).number;
  if (sel.empty) {
    const indent = (n: number) => /^\s*/.exec(state.doc.line(n).text)![0];
    const base = indent(first);
    const same = (n: number) => state.doc.line(n).text.trim() !== "" && indent(n) === base;
    while (first > 1 && same(first - 1)) first--;
    while (last < state.doc.lines && same(last + 1)) last++;
  }
  const lines: string[] = [];
  for (let n = first; n <= last; n++) lines.push(state.doc.line(n).text);
  const next = alignLines(lines).join("\n");
  const from = state.doc.line(first).from;
  const to = state.doc.line(last).to;
  if (next === state.sliceDoc(from, to)) return false;
  view.dispatch({ changes: { from, to, insert: next }, userEvent: "input" });
  return true;
}

function resolveAllCmd(view: EditorView, how: Resolution): boolean {
  const doc = view.state.doc.toString();
  const { text, count } = resolveAll(doc, how);
  if (count === 0) {
    toast.info("No merge conflicts in this file");
    return false;
  }
  view.dispatch({ changes: { from: 0, to: doc.length, insert: text }, userEvent: "input" });
  toast.success(`Resolved ${count} conflict${count === 1 ? "" : "s"} (${how})`);
  return true;
}

function conflictAtCursor(how: Resolution) {
  return (view: EditorView): boolean => {
    if (resolveConflictAtCursor(view, how)) return true;
    toast.info("Put the cursor inside a conflict block");
    return false;
  };
}

export const TEXT_ACTIONS: CodeActionDescriptor[] = [
  { id: "merge.next", label: "Merge: Next conflict", keywords: ["merge", "conflict", "git", "next"], run: (v) => gotoConflict(v, 1) },
  { id: "merge.prev", label: "Merge: Previous conflict", keywords: ["merge", "conflict", "git", "previous"], run: (v) => gotoConflict(v, -1) },
  { id: "merge.acceptCurrent", label: "Merge: Accept current change", keywords: ["merge", "conflict", "ours", "head"], run: (v) => conflictAtCursor("current")(v) },
  { id: "merge.acceptIncoming", label: "Merge: Accept incoming change", keywords: ["merge", "conflict", "theirs"], run: (v) => conflictAtCursor("incoming")(v) },
  { id: "merge.acceptBoth", label: "Merge: Accept both changes", keywords: ["merge", "conflict", "both"], run: (v) => conflictAtCursor("both")(v) },
  { id: "merge.acceptAllCurrent", label: "Merge: Accept all current", keywords: ["merge", "conflict", "ours", "all"], run: (v) => resolveAllCmd(v, "current") },
  { id: "merge.acceptAllIncoming", label: "Merge: Accept all incoming", keywords: ["merge", "conflict", "theirs", "all"], run: (v) => resolveAllCmd(v, "incoming") },
  { id: "text.align", label: "Align on = / : / => …", keywords: ["align", "columns", "assignments", "tabular", "better align", "beautify"], run: (v) => alignCmd(v) },
  { id: "text.rewrap", label: "Rewrap paragraph / comment", keywords: ["wrap", "reflow", "gq", "fill", "paragraph", "comment", "column"], run: (v) => rewrapCmd(v) },
  { id: "text.sortImports", label: "Organize imports (sort, group, merge)", keywords: ["imports", "sort", "isort", "organize", "group", "javascript", "typescript", "python"], run: (v, lang) => sortImportsCmd(v, lang) },
  { id: "text.cycleQuotes", label: "Switch quote style (' → \" → `)", keywords: ["quotes", "string", "single", "double", "backtick", "template"], run: (v) => cycleQuotesCmd(v) },
  { id: "text.formatMarkup", label: "Format XML / HTML", keywords: ["xml", "html", "svg", "pretty", "indent", "beautify"], run: (v) => replaceTarget(v, "Format markup", (t) => formatMarkup(t) + (t.endsWith("\n") ? "\n" : "")) },
  { id: "text.minifyMarkup", label: "Minify XML / HTML", keywords: ["xml", "html", "svg", "minify", "compact"], run: (v) => replaceTarget(v, "Minify markup", minifyMarkup) },
  { id: "text.formatSql", label: "Format SQL", keywords: ["sql", "query", "pretty", "beautify", "postgres", "mysql"], run: (v) => replaceTarget(v, "Format SQL", (t) => formatSql(t) + (t.endsWith("\n") ? "\n" : "")) },
  { id: "md.toc", label: "Markdown: Insert / update table of contents", keywords: ["markdown", "toc", "contents", "headings", "readme"], run: (v) => markdownTocCmd(v) },
  { id: "md.bold", label: "Markdown: Toggle bold", keywords: ["markdown", "bold", "strong", "**"], run: (v) => toggleMarkdownWrap("**")(v) },
  { id: "md.italic", label: "Markdown: Toggle italic", keywords: ["markdown", "italic", "emphasis", "_"], run: (v) => toggleMarkdownWrap("_")(v) },
  { id: "md.code", label: "Markdown: Toggle inline code", keywords: ["markdown", "code", "backtick"], run: (v) => toggleMarkdownWrap("`")(v) },
  { id: "md.strike", label: "Markdown: Toggle strikethrough", keywords: ["markdown", "strike", "~~"], run: (v) => toggleMarkdownWrap("~~")(v) },
  { id: "md.link", label: "Markdown: Insert link", keywords: ["markdown", "link", "url", "anchor"], run: (v) => void markdownLinkCmd(v) },
  { id: "text.insertSequence", label: "Insert sequence at cursors…", keywords: ["numbers", "multi-cursor", "increment", "enumerate", "counter", "letters"], run: (v) => void insertSequenceCmd(v) },
  { id: "text.cursorsAtLineEnds", label: "Add cursors to line ends", keywords: ["multi-cursor", "multiple", "selection", "lines", "column"], run: (v) => cursorsAtLineEnds(v) },
  { id: "text.renameSymbol", label: "Rename symbol (in file)", keywords: ["rename", "refactor", "identifier", "variable", "f2"], run: (v, lang) => void renameSymbolLocal(v, lang) },
  { id: "text.goToSymbol", label: "Go to symbol in file…", keywords: ["outline", "symbol", "function", "class", "heading", "navigate", "@"], run: (v, lang) => void goToSymbolCmd(v, lang) },
  { id: "text.toggleBookmark", label: "Toggle bookmark", keywords: ["bookmark", "mark", "line", "pin"], run: (v) => toggleBookmark(v) },
  { id: "text.nextBookmark", label: "Go to next bookmark", keywords: ["bookmark", "jump", "next"], run: (v) => gotoBookmark(v, 1) },
  { id: "text.prevBookmark", label: "Go to previous bookmark", keywords: ["bookmark", "jump", "previous"], run: (v) => gotoBookmark(v, -1) },
  { id: "text.clearBookmarks", label: "Clear bookmarks in this file", keywords: ["bookmark", "remove", "clear"], run: (v) => clearBookmarks(v) },
  { id: "text.convertColors", label: "Convert colours to hex / rgb / hsl…", keywords: ["color", "colour", "css", "hex", "rgb", "hsl", "convert"], run: (v) => void convertColorsCmd(v) },
  { id: "text.explainCron", label: "Explain cron expression", keywords: ["cron", "crontab", "schedule", "next run", "github actions"], run: (v) => void explainCronCmd(v) },
  { id: "text.evaluate", label: "Evaluate math (replace)", keywords: ["calculate", "calculator", "math", "expression", "compute"], run: (v) => transformSelections(v, "Evaluate", calculate) },
  { id: "text.evaluateAppend", label: "Evaluate math (append = result)", keywords: ["calculate", "calculator", "math", "expression", "equals"], run: (v) => transformSelections(v, "Evaluate", (t) => `${t.replace(/\s*=\s*$/, "")} = ${calculate(t)}`) },
  { id: "text.sum", label: "Sum numbers in selections", keywords: ["sum", "total", "average", "add up", "statistics"], run: (v) => sumSelectionsCmd(v) },
  { id: "text.inspectJwt", label: "Inspect JWT", keywords: ["jwt", "token", "decode", "claims", "bearer", "auth", "expiry"], run: (v) => void inspectJwtCmd(v) },
  { id: "text.uuidV4", label: "Insert UUID v4", keywords: ["uuid", "guid", "random", "id", "generate"], run: (v) => insertGenerated(() => uuidV4())(v) },
  { id: "text.uuidV7", label: "Insert UUID v7 (time-ordered)", keywords: ["uuid", "guid", "sortable", "id", "generate"], run: (v) => insertGenerated(() => uuidV7())(v) },
  { id: "text.ulid", label: "Insert ULID", keywords: ["ulid", "sortable", "id", "generate"], run: (v) => insertGenerated(() => ulid())(v) },
  { id: "text.nanoid", label: "Insert NanoID", keywords: ["nanoid", "short", "id", "generate"], run: (v) => insertGenerated(() => nanoid())(v) },
  { id: "text.insertTimestamp", label: "Insert timestamp…", keywords: ["date", "time", "now", "epoch", "iso"], run: (v) => void insertTimestampCmd(v) },
  { id: "text.convertTimestamp", label: "Convert timestamp (epoch ⇄ ISO)", keywords: ["epoch", "unix", "iso", "date", "time", "convert"], run: (v) => convertTimestampCmd(v) },
  { id: "text.hash", label: "Hash selection (SHA-256, SHA-1, MD5, CRC32…)", keywords: ["hash", "digest", "checksum", "sha", "md5", "crc", "fingerprint"], run: (v) => void hashSelectionCmd(v) },
  { id: "text.encode", label: "Encode selection…", keywords: ["base64", "url", "html", "entities", "escape", "hex", "unicode", "json"], run: (v) => void codecCmd(v, "encode") },
  { id: "text.decode", label: "Decode selection…", keywords: ["base64", "url", "html", "entities", "unescape", "hex", "unicode", "json"], run: (v) => void codecCmd(v, "decode") },
  { id: "text.base64Encode", label: "Base64 encode", keywords: ["base64", "encode"], run: (v) => transformSelections(v, "Base64 encode", CODECS.base64.codec.encode) },
  { id: "text.base64Decode", label: "Base64 decode", keywords: ["base64", "decode"], run: (v) => transformSelections(v, "Base64 decode", CODECS.base64.codec.decode) },
  { id: "text.urlEncode", label: "URL encode", keywords: ["url", "percent", "encode", "uri"], run: (v) => transformSelections(v, "URL encode", CODECS.url.codec.encode) },
  { id: "text.urlDecode", label: "URL decode", keywords: ["url", "percent", "decode", "uri"], run: (v) => transformSelections(v, "URL decode", CODECS.url.codec.decode) },
  { id: "text.formatTables", label: "Format Markdown table(s)", keywords: ["markdown", "table", "align", "pipe", "pretty"], run: (v) => formatTablesCmd(v) },
  { id: "text.csvToMarkdown", label: "Convert CSV/TSV to Markdown table", keywords: ["csv", "tsv", "markdown", "table", "convert"], run: (v) => replaceTarget(v, "CSV → Markdown", csvToMarkdown) },
  { id: "text.markdownToCsv", label: "Convert Markdown table to CSV", keywords: ["csv", "markdown", "table", "convert", "export"], run: (v) => replaceTarget(v, "Markdown → CSV", markdownToCsv) },
  { id: "text.alignCsv", label: "Align CSV/TSV columns", keywords: ["csv", "tsv", "align", "columns", "rainbow", "pad"], run: (v) => replaceTarget(v, "Align columns", alignDelimited) },
  { id: "text.shrinkCsv", label: "Shrink CSV/TSV columns", keywords: ["csv", "tsv", "shrink", "compact", "unalign"], run: (v) => replaceTarget(v, "Shrink columns", shrinkDelimited) },
  { id: "text.jsonToYaml", label: "Convert JSON to YAML", keywords: ["yaml", "json", "convert", "transform", "config"], run: (v) => jsonToYamlCmd(v) },
  { id: "text.yamlToJson", label: "Convert YAML to JSON", keywords: ["yaml", "json", "convert", "transform", "config"], run: (v) => yamlToJsonCmd(v) },
  { id: "text.sortJsonKeys", label: "Sort JSON keys (deep)", keywords: ["json", "sort", "keys", "alphabetical", "normalize"], run: (v) => sortJsonKeysCmd(v) },
  { id: "text.surround", label: "Surround with…", keywords: ["wrap", "quotes", "brackets", "tag", "vim-surround", "ys"], run: (v) => void surroundSelection(v) },
  { id: "text.removeSurround", label: "Remove surrounding pair", keywords: ["unwrap", "delete", "quotes", "brackets", "tag", "ds"], run: (v) => removeSurroundCmd(v) },
  { id: "text.changeSurround", label: "Change surrounding pair…", keywords: ["replace", "quotes", "brackets", "tag", "cs"], run: (v) => void changeSurround(v) },
  { id: "text.cycleWord", label: "Toggle word (true/false, let/const, ===/!==…)", keywords: ["cycle", "toggle", "boolean", "flip", "opposite", "switch"], run: (v) => cycleWordCmd(1)(v) },
  { id: "text.cycleWordBack", label: "Toggle word backwards", keywords: ["cycle", "toggle", "previous"], run: (v) => cycleWordCmd(-1)(v) },
  { id: "text.increment", label: "Increment number", keywords: ["increase", "plus", "ctrl-a", "counter", "date"], run: (v) => incrementCmd(1)(v) },
  { id: "text.decrement", label: "Decrement number", keywords: ["decrease", "minus", "ctrl-x", "counter", "date"], run: (v) => incrementCmd(-1)(v) },
  { id: "text.increment10", label: "Increment number by 10", keywords: ["increase", "plus", "ten"], run: (v) => incrementCmd(10)(v) },
  { id: "text.decrement10", label: "Decrement number by 10", keywords: ["decrease", "minus", "ten"], run: (v) => incrementCmd(-10)(v) },
];

export function textToolsKeymap(getLanguageId: () => string = () => ""): KeyBinding[] {
  return [
    { key: "Mod-Shift-o", preventDefault: true, run: (v) => (void goToSymbolCmd(v, getLanguageId()), true) },
    { key: "Mod-Alt-=", preventDefault: true, run: incrementCmd(1) },
    { key: "Mod-Alt--", preventDefault: true, run: incrementCmd(-1) },
    { key: "Mod-Alt-t", preventDefault: true, run: cycleWordCmd(1) },
    { key: "Mod-Alt-Shift-t", preventDefault: true, run: cycleWordCmd(-1) },
    { key: "Mod-Alt-s", preventDefault: true, run: (v) => (void surroundSelection(v), true) },
    { key: "Shift-Alt-i", preventDefault: true, run: cursorsAtLineEnds },
    { key: "Mod-Alt-'", preventDefault: true, run: cycleQuotesCmd },
    { key: "Shift-Alt-o", preventDefault: true, run: (v) => sortImportsCmd(v, getLanguageId()) },
    { key: "Alt-q", preventDefault: true, run: rewrapCmd },
    { key: "Mod-Alt-a", preventDefault: true, run: alignCmd },
  ];
}
