// Editor text tools exposed as CodeMirror commands, palette actions ("Text"
// group) and keybindings. Pure logic lives in sibling modules; this file
// only maps it onto selections.

import { EditorSelection, type EditorState, type SelectionRange } from "@codemirror/state";
import type { EditorView, KeyBinding } from "@codemirror/view";
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

export const TEXT_ACTIONS: CodeActionDescriptor[] = [
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

export function textToolsKeymap(): KeyBinding[] {
  return [
    { key: "Mod-Alt-=", preventDefault: true, run: incrementCmd(1) },
    { key: "Mod-Alt--", preventDefault: true, run: incrementCmd(-1) },
    { key: "Mod-Alt-t", preventDefault: true, run: cycleWordCmd(1) },
    { key: "Mod-Alt-Shift-t", preventDefault: true, run: cycleWordCmd(-1) },
    { key: "Mod-Alt-s", preventDefault: true, run: (v) => (void surroundSelection(v), true) },
  ];
}
