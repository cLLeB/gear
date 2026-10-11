// Editor commands for the third text-tools set (see text3.ts).

import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { diff as jsonDiff, type Json } from "@/lib/lang/jsonDiff";
import { parseJson5 } from "@/lib/lang/json5";
import { openCompare } from "@/modules/compare/CompareDialog";
import { inputBox, quickPick } from "@/modules/quick-pick";
import { readTerminalClipboard, writeTerminalClipboard } from "@/modules/terminal/lib/terminalClipboard";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { parseToml } from "@/modules/tools/formats";
import { xmlToJson } from "@/modules/tools/formats";
import { getActiveEditor } from "../activeEditor";
import type { CodeActionDescriptor } from "../codeActions";
import { replaceTarget, targetRange, transformSelections } from "./commands";
import { base64ToBytes } from "./hexdump";
import { parseYaml } from "./yaml";
import {
  base32Decode,
  base32Encode,
  base58Decode,
  base58Encode,
  colorScaleCss,
  escapeFor,
  flattenJson,
  fromBinary,
  fromMorse,
  inspectId,
  inspectUrl,
  joinLines,
  jsLiteralToJson,
  jsonSchemaFrom,
  lineFrequencies,
  markdownToHtml,
  minifySql,
  rot13,
  splitToLines,
  sqlInList,
  sqlKeywordCase,
  toBinary,
  toJsLiteral,
  toMorse,
  transposeCsv,
  unescapeFrom,
  unflattenJson,
  validateJson,
  wrapLines,
  type EscapeTarget,
} from "./text3";

const pretty = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

async function copy(text: string, what: string) {
  await writeTerminalClipboard(text);
  toast.success(`Copied ${what}`);
}

/** Token under the cursor using a custom character class, or the selection. */
function tokenAt(view: EditorView, re: RegExp): { from: number; to: number; text: string } | null {
  const sel = view.state.selection.main;
  if (!sel.empty) return { from: sel.from, to: sel.to, text: view.state.sliceDoc(sel.from, sel.to) };
  const line = view.state.doc.lineAt(sel.head);
  for (const m of line.text.matchAll(re)) {
    const from = line.from + m.index!;
    if (from <= sel.head && sel.head <= from + m[0].length) return { from, to: from + m[0].length, text: m[0] };
  }
  return null;
}

export async function jsLiteralCmd(view: EditorView): Promise<void> {
  const dir = await quickPick(
    [
      { label: "JSON → JavaScript object literal", value: "toJs" },
      { label: "JavaScript / JSON5 literal → strict JSON", value: "toJson" },
    ],
    { title: "Convert" },
  );
  if (dir === "toJs") replaceTarget(view, "To JS literal", (t) => toJsLiteral(JSON.parse(t)));
  else if (dir === "toJson") replaceTarget(view, "To JSON", jsLiteralToJson);
}

const ESCAPE_TARGETS: { label: string; value: EscapeTarget }[] = [
  { label: "C / Java / JavaScript string", value: "java" },
  { label: "Python string", value: "python" },
  { label: "Bash / sh (single-quoted)", value: "shell" },
  { label: "PowerShell (single-quoted)", value: "powershell" },
  { label: "SQL string literal", value: "sql" },
  { label: "Regular expression (literal match)", value: "regex" },
  { label: "CSV field", value: "csv" },
  { label: "XML / HTML text", value: "xml" },
];

export async function escapeForCmd(view: EditorView): Promise<void> {
  const mode = await quickPick(
    [
      ...ESCAPE_TARGETS.map((t) => ({ label: `Escape for ${t.label}`, value: { t: t.value, un: false } })),
      ...ESCAPE_TARGETS.map((t) => ({ label: `Unescape ${t.label}`, value: { t: t.value, un: true } })),
    ],
    { title: "Escape / unescape selection" },
  );
  if (mode) transformSelections(view, "Escape", (s) => (mode.un ? unescapeFrom(s, mode.t) : escapeFor(s, mode.t)));
}

export async function joinSplitCmd(view: EditorView): Promise<void> {
  const mode = await quickPick(
    [
      { label: "Join lines with a separator…", value: "join" },
      { label: "Join lines as quoted, comma-separated list", value: "quoted" },
      { label: "Lines → SQL IN (…) list", value: "in" },
      { label: "Split by a delimiter into lines…", value: "split" },
      { label: "Wrap each line with prefix / suffix…", value: "wrap" },
    ],
    { title: "Join / split / wrap lines" },
  );
  if (!mode) return;
  if (mode === "quoted") return void replaceTarget(view, "Join", (t) => joinLines(t, ", ", '"'));
  if (mode === "in") return void replaceTarget(view, "IN list", sqlInList);
  if (mode === "join") {
    const sep = await inputBox({ title: "Separator", value: ", " });
    if (sep !== undefined) replaceTarget(view, "Join", (t) => joinLines(t, sep.replace(/\\n/g, "\n").replace(/\\t/g, "\t")));
    return;
  }
  if (mode === "split") {
    const d = await inputBox({ title: "Delimiter (\\t for tab)", value: "," });
    if (d) replaceTarget(view, "Split", (t) => splitToLines(t, d));
    return;
  }
  const pre = await inputBox({ title: "Prefix for each line", value: "- " });
  if (pre === undefined) return;
  const suf = await inputBox({ title: "Suffix for each line", value: "" });
  if (suf !== undefined) replaceTarget(view, "Wrap", (t) => wrapLines(t, pre, suf));
}

export const transposeCmd = (v: EditorView) => replaceTarget(v, "Transpose", transposeCsv);
export const frequencyCmd = (v: EditorView) => replaceTarget(v, "Count lines", (t) => lineFrequencies(t, false));

export function compareSelectionsCmd(view: EditorView): void {
  const ranges = view.state.selection.ranges.filter((r) => !r.empty);
  if (ranges.length !== 2) return void toast.info("Make two selections (Alt/Option + drag, or Ctrl/Cmd + select) to compare them");
  const [a, b] = ranges.map((r) => view.state.sliceDoc(r.from, r.to));
  openCompare({ title: "Compare selections", originalLabel: "first selection", modifiedLabel: "second selection", original: a, modified: b, languageHint: getActiveEditor()?.path });
}

export async function pasteImageMarkdownCmd(view: EditorView): Promise<void> {
  const path = getActiveEditor()?.path;
  if (!path) return void toast.error("Save the Markdown file first");
  const tmp = await invoke<string | null>("clipboard_save_image").catch(() => null);
  if (!tmp) return void toast.info("No image on the clipboard");
  const dir = path.replace(/[\\/][^\\/]*$/, "");
  const sub = await inputBox({ title: "Save image into folder (relative to this file)", value: "assets" });
  if (sub === undefined) return;
  const target = sub.trim() ? `${dir}/${sub.trim()}` : dir;
  await invoke("fs_create_dir", { path: target, workspace: currentWorkspaceEnv() }).catch(() => {});
  const bytes = await invoke<{ data: string }>("fs_read_bytes", { path: tmp, maxBytes: null, workspace: currentWorkspaceEnv() });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const saved = await invoke<string>("fs_write_new", { destDir: target, name: `image-${stamp}.png`, content: Array.from(base64ToBytes(bytes.data)), workspace: currentWorkspaceEnv() });
  const rel = saved.replace(/\\/g, "/").slice(dir.replace(/\\/g, "/").length + 1);
  const sel = view.state.selection.main;
  const alt = view.state.sliceDoc(sel.from, sel.to) || "image";
  const insert = `![${alt}](${rel.includes(" ") ? `<${rel}>` : rel})`;
  view.dispatch({ changes: { from: sel.from, to: sel.to, insert }, selection: EditorSelection.cursor(sel.from + insert.length), userEvent: "input" });
  view.focus();
}

export async function calloutCmd(view: EditorView): Promise<void> {
  const kind = await quickPick(["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"].map((k) => ({ label: k, value: k })), { title: "Insert GitHub callout" });
  if (!kind) return;
  const sel = view.state.selection.main;
  const body = view.state.sliceDoc(sel.from, sel.to) || "Text";
  const insert = `> [!${kind}]\n${body.split("\n").map((l) => `> ${l}`).join("\n")}\n`;
  view.dispatch({ changes: { from: sel.from, to: sel.to, insert }, userEvent: "input" });
}

export async function colorScaleCmd(view: EditorView): Promise<void> {
  const tok = tokenAt(view, /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g);
  const hex = tok?.text ?? (await inputBox({ title: "Base colour", value: "#3b82f6" }));
  if (!hex) return;
  const name = await inputBox({ title: "Palette name", value: "brand" });
  if (!name) return;
  const format = await quickPick(
    [
      { label: "CSS custom properties", value: "css" as const },
      { label: "Tailwind theme colours", value: "tailwind" as const },
      { label: "SCSS variables", value: "scss" as const },
    ],
    { title: `${hex} → 50…950 scale` },
  );
  if (!format) return;
  try {
    const out = colorScaleCss(hex, name, format);
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    view.dispatch({ changes: { from: line.to, insert: `\n${out}` }, userEvent: "input" });
  } catch (e) {
    toast.error(String(e instanceof Error ? e.message : e));
  }
}

export async function moreEncodingsCmd(view: EditorView): Promise<void> {
  const codec = await quickPick(
    [
      { label: "Base32 encode", value: base32Encode },
      { label: "Base32 decode", value: base32Decode },
      { label: "Base58 encode (Bitcoin alphabet)", value: base58Encode },
      { label: "Base58 decode", value: base58Decode },
      { label: "ROT13", value: rot13 },
      { label: "Text → Morse", value: toMorse },
      { label: "Morse → text", value: fromMorse },
      { label: "Text → binary (UTF-8 bytes)", value: toBinary },
      { label: "Binary → text", value: fromBinary },
    ],
    { title: "More encodings" },
  );
  if (codec) transformSelections(view, "Encode", codec);
}

async function showRows(title: string, rows: { label: string; value: string }[]) {
  const pick = await quickPick(rows.map((r) => ({ label: r.value, description: r.label, value: r.value })), { title, placeholder: "Pick a value to copy" });
  if (pick) await copy(pick, "value");
}

export async function inspectIdCmd(view: EditorView): Promise<void> {
  const tok = tokenAt(view, /[0-9a-fA-F-]{24,36}|[0-9A-Za-z]{26}|\d{15,20}/g);
  if (!tok) return void toast.info("Put the cursor on a UUID, ULID, ObjectId or Snowflake id");
  try {
    await showRows(tok.text, inspectId(tok.text));
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
  }
}

export async function inspectUrlCmd(view: EditorView): Promise<void> {
  const tok = tokenAt(view, /\b[a-z][\w+.-]*:\/\/[^\s"'<>`)]+/gi);
  if (!tok) return void toast.info("Put the cursor on a URL");
  try {
    await showRows(tok.text, inspectUrl(tok.text));
  } catch (e) {
    toast.error("Not a valid URL", { description: String(e) });
  }
}

export function validateCmd(view: EditorView, lang: string): void {
  const text = view.state.doc.toString();
  const path = getActiveEditor()?.path ?? "";
  const kind = /\.ya?ml$/i.test(path) || /yaml/.test(lang) ? "YAML" : /\.toml$/i.test(path) ? "TOML" : /\.(xml|svg|xsd|plist|csproj)$/i.test(path) ? "XML" : "JSON";
  const jump = (line: number, column = 1) => {
    const l = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)));
    view.dispatch({ selection: EditorSelection.cursor(Math.min(l.to, l.from + column - 1)), scrollIntoView: true });
    view.focus();
  };
  try {
    if (kind === "JSON") {
      const err = validateJson(text);
      if (err) {
        jump(err.line, err.column);
        return void toast.error(`Invalid JSON at line ${err.line}, column ${err.column}`, { description: err.message });
      }
    } else if (kind === "YAML") parseYaml(text);
    else if (kind === "TOML") parseToml(text);
    else xmlToJson(text);
    toast.success(`Valid ${kind}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const line = /line (\d+)/i.exec(msg)?.[1];
    if (line) jump(Number(line));
    toast.error(`Invalid ${kind}`, { description: msg });
  }
}

export async function jsonSchemaCmd(view: EditorView): Promise<void> {
  const { text } = targetRange(view);
  let value: unknown;
  try {
    value = parseJson5(text);
  } catch (e) {
    return void toast.error("Select a JSON sample", { description: String(e) });
  }
  const title = await inputBox({ title: "Schema title", value: "Root" });
  if (title === undefined) return;
  await copy(pretty(jsonSchemaFrom(value, title || undefined)), "JSON Schema");
}

export async function flattenCmd(view: EditorView): Promise<void> {
  const mode = await quickPick(
    [
      { label: "Flatten nested JSON to dotted keys", value: "flat" },
      { label: "Unflatten dotted keys to nested JSON", value: "unflat" },
    ],
    { title: "Flatten / unflatten JSON" },
  );
  if (mode) replaceTarget(view, "Flatten", (t) => pretty(mode === "flat" ? flattenJson(parseJson5(t)) : unflattenJson(parseJson5(t) as Record<string, unknown>)));
}

export async function jsonDiffCmd(view: EditorView): Promise<void> {
  const { text } = targetRange(view);
  let a: Json;
  let b: Json;
  try {
    a = parseJson5(text) as Json;
    b = parseJson5(await readTerminalClipboard()) as Json;
  } catch (e) {
    return void toast.error("Both the editor (or selection) and the clipboard must hold JSON", { description: String(e) });
  }
  const ops = jsonDiff(a, b);
  if (!ops.length) return void toast.success("Structurally identical (key order ignored)");
  const describe = (o: (typeof ops)[number]) =>
    o.op === "add" ? `+ ${o.path} = ${JSON.stringify(o.value).slice(0, 80)}` : o.op === "remove" ? `− ${o.path}` : o.op === "replace" ? `~ ${o.path} → ${JSON.stringify(o.value).slice(0, 80)}` : `↷ ${o.from} → ${o.path}`;
  const pick = await quickPick(
    [{ label: `Copy as JSON Patch (${ops.length} operation${ops.length === 1 ? "" : "s"})`, value: "__patch" }, ...ops.map((o) => ({ label: describe(o), value: describe(o) }))],
    { title: "Editor JSON → clipboard JSON" },
  );
  if (pick === "__patch") await copy(pretty(ops), "JSON Patch");
}

export async function copyMarkdownAsHtmlCmd(view: EditorView): Promise<void> {
  const { text } = targetRange(view);
  const html = markdownToHtml(text);
  try {
    await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) })]);
    toast.success("Copied as rich text", { description: "Paste into email, Docs or a CMS." });
  } catch {
    await copy(html, "HTML source");
  }
}

export async function sqlCaseCmd(view: EditorView): Promise<void> {
  const mode = await quickPick(
    [
      { label: "UPPERCASE SQL keywords", value: "upper" },
      { label: "lowercase SQL keywords", value: "lower" },
      { label: "Minify SQL (one line)", value: "min" },
    ],
    { title: "SQL" },
  );
  if (mode) replaceTarget(view, "SQL", (t) => (mode === "min" ? `${minifySql(t)}\n` : sqlKeywordCase(t, mode === "upper")));
}

export const TEXT3_ACTIONS: CodeActionDescriptor[] = [
  { id: "text.jsLiteral", label: "Convert JSON ⇄ JavaScript object literal", keywords: ["json5", "object literal", "unquote keys", "javascript", "convert"], run: (v) => void jsLiteralCmd(v) },
  { id: "text.escapeFor", label: "Escape / unescape for a language (C, Python, shell, SQL, regex…)…", keywords: ["escape", "unescape", "string literal", "quote", "regex", "sql", "shell"], run: (v) => void escapeForCmd(v) },
  { id: "text.joinSplit", label: "Join / split / wrap lines (SQL IN list, quoted list…)…", keywords: ["join", "split", "comma", "list", "in clause", "prefix", "suffix", "wrap"], run: (v) => void joinSplitCmd(v) },
  { id: "text.transposeCsv", label: "Transpose CSV / TSV (rows ⇄ columns)", keywords: ["transpose", "csv", "pivot", "rows", "columns"], run: (v) => transposeCmd(v) },
  { id: "text.lineFrequency", label: "Count duplicate lines (frequency table)", keywords: ["uniq -c", "count", "frequency", "histogram", "duplicates"], run: (v) => frequencyCmd(v) },
  { id: "text.compareSelections", label: "Compare two selections", keywords: ["diff", "compare", "selections", "multi-cursor"], run: (v) => compareSelectionsCmd(v) },
  { id: "md.pasteImage", label: "Markdown: Paste clipboard image (save file + insert link)", keywords: ["markdown", "image", "screenshot", "paste", "assets"], run: (v) => void pasteImageMarkdownCmd(v) },
  { id: "md.callout", label: "Markdown: Insert callout (NOTE / TIP / WARNING…)", keywords: ["markdown", "callout", "admonition", "note", "warning", "github"], run: (v) => void calloutCmd(v) },
  { id: "text.colorScale", label: "Generate colour scale (50–950) from a colour", keywords: ["palette", "tints", "shades", "tailwind", "css variables", "colour", "color"], run: (v) => void colorScaleCmd(v) },
  { id: "text.moreEncodings", label: "Encode / decode: Base32, Base58, ROT13, Morse, binary…", keywords: ["base32", "base58", "rot13", "morse", "binary", "encode", "decode"], run: (v) => void moreEncodingsCmd(v) },
  { id: "text.inspectId", label: "Inspect ID at cursor (UUID version/time, ULID, ObjectId, Snowflake)", keywords: ["uuid", "ulid", "objectid", "snowflake", "timestamp", "decode id"], run: (v) => void inspectIdCmd(v) },
  { id: "text.inspectUrl", label: "Inspect URL at cursor (host, path, query parameters)", keywords: ["url", "query", "params", "decode", "parse"], run: (v) => void inspectUrlCmd(v) },
  { id: "text.validate", label: "Validate JSON / YAML / TOML / XML (jump to the error)", keywords: ["validate", "lint", "syntax", "json", "yaml", "toml", "xml", "error"], run: (v, l) => validateCmd(v, l) },
  { id: "text.jsonSchema", label: "Generate JSON Schema from a sample (copies it)", keywords: ["json schema", "schema", "validate", "draft 2020-12"], run: (v) => void jsonSchemaCmd(v) },
  { id: "text.flattenJson", label: "Flatten / unflatten JSON (dotted keys)", keywords: ["flatten", "unflatten", "dot notation", "keys", "i18n"], run: (v) => void flattenCmd(v) },
  { id: "text.jsonDiff", label: "Compare JSON structurally with clipboard (JSON Patch)", keywords: ["json diff", "patch", "rfc 6902", "compare", "structural"], run: (v) => void jsonDiffCmd(v) },
  { id: "md.copyHtml", label: "Markdown: Copy as rich text / HTML", keywords: ["markdown", "html", "rich text", "email", "copy", "render"], run: (v) => void copyMarkdownAsHtmlCmd(v) },
  { id: "text.sqlCase", label: "SQL: Keyword case / minify…", keywords: ["sql", "uppercase", "keywords", "minify", "one line"], run: (v) => void sqlCaseCmd(v) },
];
