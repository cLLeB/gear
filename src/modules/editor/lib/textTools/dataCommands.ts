// Editor commands for data and text utilities: JSON/YAML paths, types from
// JSON, curl conversion, statistics, extra sorts, number bases, case, and
// suspicious-character cleanup.

import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { toast } from "sonner";
import { quickPick, inputBox } from "@/modules/quick-pick";
import { parseJson5 } from "@/lib/lang/json5";
import { readTerminalClipboard, writeTerminalClipboard } from "@/modules/terminal/lib/terminalClipboard";
import type { CodeActionDescriptor } from "../codeActions";
import { replaceTarget, targetRange, transformSelections } from "./commands";
import { formatPath, jsonPathAt, yamlPathAt, type PathFormat } from "./jsonPath";
import { jsonToTypes, type TypeTarget } from "./jsonTypes";
import { parseYaml } from "./yaml";
import { curlToFetch, curlToPowerShell, curlToPython, parseCurl } from "./curl";
import {
  cleanSuspiciousChars,
  findSuspiciousChars,
  formatMinutes,
  integerForms,
  parseIntegerLiteral,
  sentenceCase,
  shuffleLines,
  sortByColumn,
  sortByLength,
  sortNatural,
  sortNumeric,
  swapCase,
  textStats,
  titleCase,
} from "./textMisc";

async function copy(text: string, what: string): Promise<void> {
  await writeTerminalClipboard(text);
  toast.success(`Copied ${what}`, { description: text.length > 120 ? `${text.slice(0, 120)}…` : text });
}

/** Ask whether generated code goes to the clipboard or below the source. */
async function deliver(view: EditorView, code: string, title: string): Promise<void> {
  const where = await quickPick(
    [
      { label: "Copy to clipboard", value: "copy" as const },
      { label: "Insert below", value: "insert" as const },
      { label: "Replace source", value: "replace" as const },
    ],
    { title },
  );
  if (!where) return;
  if (where === "copy") return copy(code, title);
  const { from, to } = targetRange(view);
  const insert = where === "replace" ? code : `\n${code}`;
  const at = where === "replace" ? from : view.state.doc.lineAt(to).to;
  view.dispatch({
    changes: { from: at, to: where === "replace" ? to : at, insert },
    selection: EditorSelection.range(at, at + insert.length),
    scrollIntoView: true,
    userEvent: "input",
  });
  view.focus();
}

function isYaml(languageId: string, text: string): boolean {
  return /ya?ml/i.test(languageId) || (!/^\s*[[{]/.test(text) && /^\s*[\w"'-]+\s*:/m.test(text));
}

export async function copyDataPathCmd(view: EditorView, languageId: string): Promise<void> {
  const text = view.state.doc.toString();
  const head = view.state.selection.main.head;
  const yaml = isYaml(languageId, text);
  const path = yaml ? yamlPathAt(text, head) : jsonPathAt(text, head);
  if (!path.length) {
    toast.info("Put the cursor on a key or value inside the document");
    return;
  }
  const formats: { label: string; value: PathFormat }[] = [
    { label: "JSONPath", value: "jsonpath" },
    { label: "jq", value: "jq" },
    { label: "JavaScript", value: "js" },
    { label: "JSON Pointer", value: "pointer" },
    { label: "Dotted (lodash / yq keys)", value: "dotted" },
  ];
  const pick = await quickPick(
    formats.map((f) => ({ label: formatPath(path, f.value), description: f.label, value: f.value })),
    { title: `Copy ${yaml ? "YAML" : "JSON"} path` },
  );
  if (pick) await copy(formatPath(path, pick), "path");
}

export async function jsonToTypesCmd(view: EditorView, languageId: string): Promise<void> {
  const { text } = targetRange(view);
  let value: unknown;
  try {
    value = isYaml(languageId, text) ? parseYaml(text) : parseJson5(text);
  } catch (e) {
    toast.error("Select a JSON (or YAML) sample", { description: e instanceof Error ? e.message : String(e) });
    return;
  }
  const target = await quickPick(
    [
      { label: "TypeScript interfaces", value: "typescript" as TypeTarget },
      { label: "Zod schema", value: "zod" as TypeTarget },
      { label: "Go structs", value: "go" as TypeTarget },
      { label: "Rust (serde) structs", value: "rust" as TypeTarget },
      { label: "Python dataclasses", value: "python" as TypeTarget },
    ],
    { title: "Generate types from JSON" },
  );
  if (!target) return;
  const name = await inputBox({ title: "Root type name", value: "Root" });
  if (name === undefined || name === null) return;
  await deliver(view, jsonToTypes(value, target, name.trim() || "Root"), "Generated types");
}

export async function convertCurlCmd(view: EditorView): Promise<void> {
  let { text } = targetRange(view);
  if (!/\bcurl\b/.test(text)) text = await readTerminalClipboard();
  const start = text.search(/\bcurl(\.exe)?\s/);
  if (start < 0) {
    toast.error("No curl command found", { description: "Select one, or copy one (e.g. DevTools → Copy as cURL)." });
    return;
  }
  let req;
  try {
    req = parseCurl(text.slice(start));
  } catch (e) {
    toast.error("Could not parse the curl command", { description: e instanceof Error ? e.message : String(e) });
    return;
  }
  const target = await quickPick(
    [
      { label: "JavaScript fetch", value: curlToFetch },
      { label: "Python requests", value: curlToPython },
      { label: "PowerShell Invoke-RestMethod", value: curlToPowerShell },
    ],
    { title: `${req.method} ${req.url}` },
  );
  if (target) await deliver(view, target(req), "Converted request");
}

export async function textStatsCmd(view: EditorView): Promise<void> {
  const sel = view.state.selection.main;
  const text = sel.empty ? view.state.doc.toString() : view.state.sliceDoc(sel.from, sel.to);
  const s = textStats(text);
  const rows = [
    ["Words", s.words.toLocaleString()],
    ["Characters", `${s.characters.toLocaleString()} (${s.charactersNoSpaces.toLocaleString()} without spaces)`],
    ["Lines", s.lines.toLocaleString()],
    ["Sentences", s.sentences.toLocaleString()],
    ["Paragraphs", s.paragraphs.toLocaleString()],
    ["Unique words", s.uniqueWords.toLocaleString()],
    ["Reading time", formatMinutes(s.readingMinutes)],
    ["Speaking time", formatMinutes(s.speakingMinutes)],
    ["Most used", s.topWords.map(([w, n]) => `${w} ×${n}`).join(", ") || "—"],
  ];
  const pick = await quickPick(
    rows.map(([k, v]) => ({ label: v, description: k, value: v })),
    { title: `Statistics — ${sel.empty ? "whole file" : "selection"}`, placeholder: "Pick a value to copy" },
  );
  if (pick) await copy(pick, "value");
}

function sortCmd(view: EditorView, label: string, fn: (lines: string[]) => string[]): boolean {
  const sel = view.state.selection.main;
  const from = sel.empty ? 0 : view.state.doc.lineAt(sel.from).from;
  const to = sel.empty ? view.state.doc.length : view.state.doc.lineAt(sel.to).to;
  const text = view.state.sliceDoc(from, to);
  const trailing = text.endsWith("\n");
  const lines = (trailing ? text.slice(0, -1) : text).split("\n");
  const out = fn(lines).join("\n") + (trailing ? "\n" : "");
  if (out === text) {
    toast.info(`${label}: already in order`);
    return false;
  }
  view.dispatch({ changes: { from, to, insert: out }, selection: EditorSelection.range(from, from + out.length), userEvent: "input" });
  return true;
}

export async function sortLinesByCmd(view: EditorView): Promise<void> {
  const pick = await quickPick(
    [
      { label: "Natural (file2 before file10)", value: "natural" },
      { label: "Natural, descending", value: "natural-desc" },
      { label: "By length", value: "length" },
      { label: "By length, longest first", value: "length-desc" },
      { label: "By number", value: "numeric" },
      { label: "By number, descending", value: "numeric-desc" },
      { label: "By column…", value: "column" },
      { label: "Shuffle", value: "shuffle" },
    ],
    { title: "Sort lines" },
  );
  if (!pick) return;
  const desc = pick.endsWith("-desc");
  if (pick === "column") {
    const raw = await inputBox({ title: "Sort by column number (1-based; prefix - for descending)", value: "1" });
    const n = Number.parseInt((raw ?? "").replace("-", ""), 10);
    if (!n || n < 1) return;
    sortCmd(view, "Sort", (l) => sortByColumn(l, n, (raw ?? "").trim().startsWith("-")));
    return;
  }
  const fn =
    pick === "shuffle" ? shuffleLines : pick.startsWith("natural") ? (l: string[]) => sortNatural(l, desc) : pick.startsWith("length") ? (l: string[]) => sortByLength(l, desc) : (l: string[]) => sortNumeric(l, desc);
  sortCmd(view, "Sort", fn);
  view.focus();
}

export async function convertNumberCmd(view: EditorView): Promise<void> {
  const sel = view.state.selection.main;
  let from = sel.from;
  let to = sel.to;
  if (sel.empty) {
    const line = view.state.doc.lineAt(sel.head);
    const re = /-?(0x[0-9a-f_]+|0b[01_]+|0o[0-7_]+|\d[\d_]*)/gi;
    for (const m of line.text.matchAll(re)) {
      const s = line.from + m.index!;
      if (s <= sel.head && sel.head <= s + m[0].length) {
        from = s;
        to = s + m[0].length;
      }
    }
  }
  const raw = view.state.sliceDoc(from, to);
  const value = parseIntegerLiteral(raw);
  if (value === null) {
    toast.info("Put the cursor on an integer (decimal, 0x, 0b or 0o)");
    return;
  }
  const pick = await quickPick(
    integerForms(value).map((f) => ({ label: f.value, description: f.label, value: f.value })),
    { title: `Convert ${raw}`, placeholder: "Pick a form to replace the number with (Esc to cancel)" },
  );
  if (!pick) return;
  view.dispatch({ changes: { from, to, insert: pick }, selection: EditorSelection.range(from, from + pick.length), userEvent: "input" });
  view.focus();
}

export async function changeCaseCmd(view: EditorView): Promise<void> {
  const pick = await quickPick(
    [
      { label: "UPPER CASE", value: (s: string) => s.toUpperCase() },
      { label: "lower case", value: (s: string) => s.toLowerCase() },
      { label: "Title Case", value: titleCase },
      { label: "Sentence case", value: sentenceCase },
      { label: "sWAP cASE", value: swapCase },
    ],
    { title: "Change case" },
  );
  if (pick) transformSelections(view, "Change case", pick);
}

export async function findSuspiciousCmd(view: EditorView): Promise<void> {
  const hits = findSuspiciousChars(view.state.doc.toString());
  if (!hits.length) {
    toast.success("No invisible, bidi or look-alike characters");
    return;
  }
  const pick = await quickPick(
    [
      { label: `Remove all ${hits.filter((h) => h.kind !== "homoglyph").length} invisible / bidi characters and normalise spaces`, value: -1 },
      ...hits.map((h, i) => {
        const line = view.state.doc.lineAt(h.from);
        return { label: h.label, description: `line ${line.number}`, detail: line.text.trim().slice(0, 100), value: i };
      }),
    ],
    { title: `${hits.length} suspicious character${hits.length === 1 ? "" : "s"}` },
  );
  if (pick === undefined || pick === null) return;
  if (pick === -1) {
    replaceTarget(view, "Clean characters", cleanSuspiciousChars);
    return;
  }
  const h = hits[pick];
  view.dispatch({ selection: EditorSelection.range(h.from, h.to), scrollIntoView: true });
  view.focus();
}

export const DATA_TEXT_ACTIONS: CodeActionDescriptor[] = [
  { id: "text.copyDataPath", label: "Copy JSON / YAML path at cursor…", keywords: ["json", "yaml", "path", "jq", "jsonpath", "pointer", "key", "breadcrumb", "copy"], run: (v, lang) => void copyDataPathCmd(v, lang) },
  { id: "text.jsonToTypes", label: "Generate types from JSON (TS, Zod, Go, Rust, Python)…", keywords: ["json", "types", "interface", "quicktype", "struct", "schema", "zod", "dataclass", "serde"], run: (v, lang) => void jsonToTypesCmd(v, lang) },
  { id: "text.convertCurl", label: "Convert curl to fetch / Python / PowerShell…", keywords: ["curl", "http", "request", "fetch", "requests", "postman", "api", "copy as curl"], run: (v) => void convertCurlCmd(v) },
  { id: "text.stats", label: "Word count & text statistics", keywords: ["words", "count", "characters", "reading time", "statistics", "length"], run: (v) => void textStatsCmd(v) },
  { id: "text.sortLinesBy", label: "Sort lines by… (natural, length, number, column, shuffle)", keywords: ["sort", "natural", "numeric", "length", "column", "shuffle", "random"], run: (v) => void sortLinesByCmd(v) },
  { id: "text.convertNumber", label: "Convert number (hex / binary / octal / decimal)…", keywords: ["hex", "binary", "octal", "decimal", "base", "radix", "convert", "number"], run: (v) => void convertNumberCmd(v) },
  { id: "text.changeCase", label: "Change case (upper, lower, title, sentence, swap)…", keywords: ["case", "upper", "lower", "title", "capitalize", "sentence", "swap"], run: (v) => void changeCaseCmd(v) },
  { id: "text.suspiciousChars", label: "Find invisible / bidi / look-alike characters", keywords: ["unicode", "zero width", "bidi", "trojan source", "homoglyph", "invisible", "security", "nbsp"], run: (v) => void findSuspiciousCmd(v) },
];
