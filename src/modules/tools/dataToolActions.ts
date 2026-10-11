// Editor commands for data and config files (see dataTools.ts).

import type { EditorView } from "@codemirror/view";
import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { parseJson5 } from "@/lib/lang/json5";
import { validate, type Schema } from "@/lib/lang/jsonSchema";
import { native } from "@/modules/ai/lib/native";
import { openTextViewer } from "@/modules/compare/CompareDialog";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import type { CodeActionDescriptor } from "@/modules/editor/lib/codeActions";
import { replaceTarget, targetRange } from "@/modules/editor/lib/textTools/commands";
import { parseYaml } from "@/modules/editor/lib/textTools/yaml";
import { inputBox, quickPick } from "@/modules/quick-pick";
import { readTerminalClipboard, writeTerminalClipboard } from "@/modules/terminal/lib/terminalClipboard";
import {
  barrelFor,
  columnAt,
  csvColumnStats,
  csvFilter,
  csvSort,
  detectDelimiter,
  duplicateKeys,
  editTable,
  endpointCurl,
  lintDockerfile,
  lintK8s,
  lintWorkflow,
  openApiBase,
  openApiEndpoints,
  queryPath,
  reindentPaste,
  renderStats,
  splitYamlDocs,
  tableBounds,
  toggleArrow,
  type LintIssue,
  type TableOp,
} from "./dataTools";
import { parseCsv } from "@/lib/lang/csv";

function fail(e: unknown): void {
  toast.error(e instanceof Error ? e.message : String(e));
}

function isYaml(view: EditorView): boolean {
  const p = getActiveEditor()?.path ?? "";
  if (/\.ya?ml$/i.test(p)) return true;
  if (/\.json5?$/i.test(p)) return false;
  return !/^\s*[[{]/.test(view.state.doc.toString());
}

function parseDoc(view: EditorView): unknown {
  const text = view.state.doc.toString();
  return isYaml(view) ? parseYaml(text) : parseJson5(text);
}

function goLine(view: EditorView, line: number): void {
  const l = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)));
  view.dispatch({ selection: { anchor: l.from }, scrollIntoView: true });
  view.focus();
}

/** Best-effort line for a JSON Pointer: the last key's occurrence after its parents. */
function lineForPointer(text: string, pointer: string): number {
  const parts = pointer.split("/").slice(1).map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  let at = 0;
  for (const p of parts) {
    if (/^\d+$/.test(p)) continue;
    const re = new RegExp(`(["']?)${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1\\s*:`, "g");
    re.lastIndex = at;
    const m = re.exec(text);
    if (m) at = m.index;
  }
  return text.slice(0, at).split("\n").length;
}

async function jsonPathQuery(view: EditorView): Promise<void> {
  let doc: unknown;
  try {
    doc = parseDoc(view);
  } catch (e) {
    return fail(e);
  }
  const path = await inputBox({ title: "JSONPath query", placeholder: "$.items[?(@.price < 10)].name   ·   $..id   ·   $.users[0:5]", value: "$." });
  if (!path) return;
  try {
    const hits = queryPath(doc, path);
    if (!hits.length) return void toast.info("No matches");
    const pick = await quickPick(
      [
        { label: `📋 Copy all ${hits.length} result(s) as JSON`, value: -1 },
        { label: "📄 Open results in a viewer", value: -2 },
        ...hits.slice(0, 500).map((h, i) => ({ label: h.path, description: JSON.stringify(h.value)?.slice(0, 120), value: i })),
      ],
      { title: `${hits.length} match(es) for ${path}` },
    );
    if (pick === undefined) return;
    const json = JSON.stringify(hits.map((h) => h.value), null, 2);
    if (pick === -1) {
      await writeTerminalClipboard(json);
      toast.success("Copied");
    } else if (pick === -2) openTextViewer(`JSONPath ${path}`, json, "json");
    else {
      const ptr = `/${hits[pick].path.replace(/^\$/, "").replace(/\['([^']*)'\]/g, ".$1").replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean).join("/")}`;
      goLine(view, lineForPointer(view.state.doc.toString(), ptr));
    }
  } catch (e) {
    fail(e);
  }
}

async function validateWithSchema(view: EditorView): Promise<void> {
  let doc: unknown;
  try {
    doc = parseDoc(view);
  } catch (e) {
    return fail(e);
  }
  const root = app().workspaceRoot();
  const own = (doc as { $schema?: string })?.$schema;
  const options: { label: string; description?: string; value: string }[] = [{ label: "📋 Schema from clipboard", value: "clipboard" }];
  if (own && !/^https?:/.test(own)) options.unshift({ label: `$schema: ${own}`, description: "declared in the document", value: `rel:${own}` });
  if (root) {
    const g = await native.glob({ pattern: "**/*{schema,Schema}*.{json,yaml,yml}", root, maxResults: 200 }).catch(() => null);
    for (const h of g?.hits ?? []) if (!/node_modules/.test(h.rel)) options.push({ label: h.rel, value: h.path });
  }
  const pick = await quickPick(options, { title: "Validate against which JSON Schema?" });
  if (!pick) return;
  let schemaText: string;
  if (pick === "clipboard") schemaText = await readTerminalClipboard();
  else {
    const path = pick.startsWith("rel:") ? `${(getActiveEditor()?.path ?? "").replace(/[\\/][^\\/]*$/, "")}/${pick.slice(4)}` : pick;
    const r = await native.readFile(path).catch(() => null);
    if (r?.kind !== "text") return void toast.error(`Can't read ${path}`);
    schemaText = r.content;
  }
  let schema: Schema;
  try {
    schema = (/^\s*[[{]/.test(schemaText) ? parseJson5(schemaText) : parseYaml(schemaText)) as Schema;
  } catch (e) {
    return fail(e);
  }
  const errors = validate(schema, doc);
  if (!errors.length) return void toast.success("Valid ✓");
  const text = view.state.doc.toString();
  const sel = await quickPick(
    errors.map((e) => ({ label: e.message, description: `${e.path || "/"} · ${e.keyword}`, value: e })),
    { title: `${errors.length} schema error(s)` },
  );
  if (sel) goLine(view, lineForPointer(text, sel.path));
}

async function openApiExplorer(view: EditorView): Promise<void> {
  let doc: unknown;
  try {
    doc = parseDoc(view);
    const eps = openApiEndpoints(doc);
    const colour: Record<string, string> = { GET: "🟢", POST: "🟡", PUT: "🔵", PATCH: "🟣", DELETE: "🔴" };
    const ep = await quickPick(
      eps.map((e) => ({ label: `${colour[e.method] ?? "⚪"} ${e.method.padEnd(6)} ${e.path}`, description: [e.summary, e.tags.join(", ")].filter(Boolean).join(" · "), value: e })),
      { title: `${eps.length} endpoint(s) · ${openApiBase(doc)}` },
    );
    if (!ep) return;
    const act = await quickPick(
      [
        { label: "Go to definition", value: "go" },
        { label: "Copy curl command", value: "curl" },
        { label: "Run with curl in a terminal", value: "run" },
        { label: "Show parameters", value: "params" },
      ],
      { title: `${ep.method} ${ep.path}` },
    );
    const base = openApiBase(doc);
    if (act === "go") {
      const text = view.state.doc.toString();
      const i = text.search(new RegExp(`^\\s*["']?${ep.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']?\\s*:`, "m"));
      if (i >= 0) {
        const after = text.slice(i).search(new RegExp(`^\\s*["']?${ep.method.toLowerCase()}["']?\\s*:`, "m"));
        goLine(view, text.slice(0, i + Math.max(0, after)).split("\n").length);
      }
    } else if (act === "curl") {
      await writeTerminalClipboard(endpointCurl(ep, base));
      toast.success("curl copied");
    } else if (act === "run") app().openTerminal({ command: endpointCurl(ep, base).replace(/ \\\n {2}/g, " ") });
    else if (act === "params") openTextViewer(`${ep.method} ${ep.path}`, `${ep.summary}\n\nParameters:\n${ep.params.map((p) => `- ${p}`).join("\n") || "(none)"}\n${ep.hasBody ? "\nRequest body: yes\n" : ""}`, "markdown");
  } catch (e) {
    fail(e);
  }
}

async function lintConfig(view: EditorView): Promise<void> {
  const path = getActiveEditor()?.path?.replace(/\\/g, "/") ?? "";
  const text = view.state.doc.toString();
  let issues: LintIssue[];
  let kind: string;
  try {
    if (/(^|\/)(Dockerfile|Containerfile)[^/]*$|\.dockerfile$/i.test(path) || /^\s*FROM\s+\S+/im.test(text.split("\n").find((l) => l.trim() && !l.startsWith("#")) ?? "")) {
      kind = "Dockerfile";
      issues = lintDockerfile(text);
    } else if (/\.github\/workflows\//.test(path) || (/^jobs:/m.test(text) && /^on:/m.test(text))) {
      kind = "GitHub Actions workflow";
      issues = lintWorkflow(parseYaml(text), text);
    } else if (/^\s*kind:\s*\w+/m.test(text) && /^\s*apiVersion:/m.test(text)) {
      kind = "Kubernetes manifest";
      issues = lintK8s(splitYamlDocs(text).map((d) => parseYaml(d)), text);
    } else return void toast.info("Not a Dockerfile, GitHub Actions workflow or Kubernetes manifest");
  } catch (e) {
    return fail(e);
  }
  if (!issues.length) return void toast.success(`${kind}: no issues`);
  const icon = { error: "⛔", warning: "⚠", info: "ℹ" };
  const pick = await quickPick(
    issues.map((i) => ({ label: `${icon[i.severity]} ${i.message}`, description: `line ${i.line} · ${i.rule}`, value: i })),
    { title: `${kind}: ${issues.filter((i) => i.severity === "error").length} error(s), ${issues.filter((i) => i.severity === "warning").length} warning(s)` },
  );
  if (pick) goLine(view, pick.line);
}

function csvStats(view: EditorView): void {
  const { text } = targetRange(view);
  const stats = csvColumnStats(text);
  if (!stats.length) return void toast.info("No CSV data");
  openTextViewer("Column statistics", renderStats(stats), "markdown");
}

async function csvFilterCmd(view: EditorView): Promise<void> {
  const expr = await inputBox({ title: "Keep rows where…", placeholder: "age > 30 and city = London   ·   name ~ ^A   ·   email contains @gmail   ·   phone empty" });
  if (!expr) return;
  let info = "";
  if (replaceTarget(view, "Filter rows", (t) => {
    const r = csvFilter(t, expr);
    info = `Kept ${r.kept} of ${r.total} rows`;
    return r.text;
  }) && info) toast.success(info);
}

async function csvSortCmd(view: EditorView): Promise<void> {
  const { text } = targetRange(view);
  const head = parseCsv(text.split(/\r?\n/, 1)[0], { delimiter: detectDelimiter(text) })[0] ?? [];
  if (!head.length) return;
  const col = await quickPick(head.flatMap((h) => [{ label: `${h} ↑`, value: { h, desc: false } }, { label: `${h} ↓`, value: { h, desc: true } }]), { title: "Sort rows by column" });
  if (col) replaceTarget(view, "Sort rows", (t) => csvSort(t, col.h, col.desc));
}

function tableAtCursor(view: EditorView): { from: number; to: number; text: string; column: number } | null {
  const doc = view.state.doc;
  const head = view.state.selection.main.head;
  const line = doc.lineAt(head);
  const lines = doc.toString().split("\n");
  const b = tableBounds(lines, line.number - 1);
  if (!b) {
    toast.info("Put the cursor inside a Markdown table");
    return null;
  }
  const from = doc.line(b.start + 1).from;
  const to = doc.line(b.end + 1).to;
  return { from, to, text: doc.sliceString(from, to), column: columnAt(line.text, head - line.from) };
}

async function mdTableCmd(view: EditorView, preset?: TableOp): Promise<void> {
  const t = tableAtCursor(view);
  if (!t) return;
  const op =
    preset ??
    (await quickPick<TableOp>(
      [
        { label: "Insert column left", value: "insertLeft" },
        { label: "Insert column right", value: "insertRight" },
        { label: "Delete column", value: "delete" },
        { label: "Move column left", value: "moveLeft" },
        { label: "Move column right", value: "moveRight" },
        { label: "Add row", value: "addRow" },
      ],
      { title: `Table column ${t.column + 1}` },
    ));
  if (!op) return;
  try {
    const out = editTable(t.text, t.column, op);
    view.dispatch({ changes: { from: t.from, to: t.to, insert: out } });
  } catch (e) {
    fail(e);
  }
}

async function pasteReindented(view: EditorView): Promise<void> {
  const clip = await readTerminalClipboard();
  if (!clip) return;
  const sel = view.state.selection.main;
  const line = view.state.doc.lineAt(sel.from);
  const indent = /^[ \t]*/.exec(line.text)![0];
  const atIndent = sel.from - line.from <= indent.length && !line.text.slice(0, sel.from - line.from).trim();
  const text = reindentPaste(clip, atIndent ? indent : /^[ \t]*/.exec(line.text)![0], true);
  const from = atIndent ? line.from + indent.length : sel.from;
  view.dispatch({ changes: { from, to: sel.to, insert: text }, selection: { anchor: from + text.length }, scrollIntoView: true });
}

async function barrelCmd(): Promise<void> {
  const path = getActiveEditor()?.path;
  if (!path) return void toast.info("Open a file in the folder first");
  const dir = path.replace(/[\\/][^\\/]*$/, "");
  const entries = await native.readDir(dir).catch(() => []);
  const files = entries.filter((e) => e.kind === "file").map((e) => e.name);
  const style = await quickPick(
    [
      { label: "export * from …", value: "star" as const },
      { label: "export { named } from … (explicit names)", value: "named" as const },
    ],
    { title: `Barrel for ${dir.replace(/^.*[\\/]/, "")}/` },
  );
  if (!style) return;
  const names: Record<string, string[]> = {};
  if (style === "named") {
    const { exportedNames } = await import("@/modules/workspace/analysis");
    for (const f of files) {
      const r = await native.readFile(`${dir}/${f}`).catch(() => null);
      if (r?.kind === "text") names[f.replace(/\.[^.]+$/, "")] = exportedNames(r.content).map((e) => e.name);
    }
  }
  const ts = files.some((f) => /\.tsx?$/.test(f));
  const target = `${dir}/index.${ts ? "ts" : "js"}`;
  const body = barrelFor(files, style, names);
  const existing = await native.readFile(target).catch(() => null);
  if (existing?.kind === "text" && existing.content.trim()) {
    const ok = await quickPick([{ label: "Overwrite", value: true }, { label: "Cancel", value: false }], { title: `${target.replace(/^.*[\\/]/, "")} already exists` });
    if (!ok) return;
  }
  await native.writeFile(target, body, "user");
  app().openFile(target);
  toast.success(`Wrote ${body.trim().split("\n").length} export(s)`);
}

function declarationRange(view: EditorView): { from: number; to: number } | null {
  const sel = view.state.selection.main;
  if (!sel.empty) return { from: view.state.doc.lineAt(sel.from).from, to: sel.to };
  const doc = view.state.doc;
  const header = /^\s*(export\s+)?(default\s+)?(async\s+)?function\b|^\s*(export\s+)?(const|let|var)\s+[\w$]+\s*(:[^=]+)?=\s*(async\s+)?(\([^)]*\)|[\w$]+)\s*(:[^=]+)?=>/;
  let n = doc.lineAt(sel.head).number;
  while (n >= 1 && !header.test(doc.line(n).text)) n--;
  if (n < 1) return null;
  const start = doc.line(n).from;
  const text = doc.sliceString(start);
  // Walk to the end of the body: matching brace for block bodies, else end of statement.
  const arrow = text.indexOf("=>");
  const brace = text.indexOf("{");
  const blockBody = brace >= 0 && (arrow < 0 || /^=>\s*\{/.test(text.slice(arrow)) || brace < arrow) ;
  if (!blockBody) {
    const end = text.search(/;\s*$|;\s*\n|\n\s*\n/m);
    return { from: start, to: start + (end < 0 ? text.length : end + 1) };
  }
  const open = arrow >= 0 && /^=>\s*\{/.test(text.slice(arrow)) ? text.indexOf("{", arrow) : brace;
  let depth = 0;
  let q: string | null = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === "\\") i++;
      else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") q = c;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return { from: start, to: start + i + 1 + (text[i + 1] === ";" ? 1 : 0) };
  }
  return null;
}

function toggleArrowCmd(view: EditorView): void {
  const r = declarationRange(view);
  if (!r) return void toast.info("Put the cursor in a function");
  try {
    const out = toggleArrow(view.state.doc.sliceString(r.from, r.to));
    view.dispatch({ changes: { from: r.from, to: r.to, insert: out } });
  } catch (e) {
    fail(e);
  }
}

async function duplicateKeysCmd(view: EditorView): Promise<void> {
  const dups = duplicateKeys(view.state.doc.toString(), isYaml(view));
  if (!dups.length) return void toast.success("No duplicate keys");
  const pick = await quickPick(dups.map((d) => ({ label: d.key, description: `line ${d.line} (first at ${d.first}) — the later one silently wins`, value: d })), { title: `${dups.length} duplicate key(s)` });
  if (pick) goLine(view, pick.line);
}

export const DATA2_ACTIONS: CodeActionDescriptor[] = [
  { id: "data.jsonPathQuery", label: "JSONPath query on this JSON / YAML…", keywords: ["jsonpath", "query", "jq", "filter", "select", "json", "yaml"], run: (v) => void jsonPathQuery(v) },
  { id: "data.validateSchema", label: "Validate against a JSON Schema…", keywords: ["schema", "json schema", "validate", "ajv", "yaml", "config"], run: (v) => void validateWithSchema(v) },
  { id: "data.openApi", label: "OpenAPI / Swagger: Browse endpoints", keywords: ["openapi", "swagger", "api", "endpoints", "rest", "curl"], run: (v) => void openApiExplorer(v) },
  { id: "data.lintDockerfile", label: "Lint Dockerfile (hadolint-style)", keywords: ["dockerfile", "hadolint", "docker", "lint", "container"], run: (v) => void lintConfig(v) },
  { id: "data.lintWorkflow", label: "Lint GitHub Actions workflow (pinning, injection, deprecated)", keywords: ["github actions", "workflow", "actionlint", "ci", "lint", "security"], run: (v) => void lintConfig(v) },
  { id: "data.lintK8s", label: "Lint Kubernetes manifest (limits, probes, root, secrets)", keywords: ["kubernetes", "k8s", "kube-score", "manifest", "lint", "security"], run: (v) => void lintConfig(v) },
  { id: "data.csvStats", label: "CSV: Column statistics", keywords: ["csv", "statistics", "profile", "summary", "columns", "describe"], run: csvStats },
  { id: "data.csvFilter", label: "CSV: Filter rows (age > 30 and city = London)…", keywords: ["csv", "filter", "where", "rows", "query"], run: (v) => void csvFilterCmd(v) },
  { id: "data.csvSort", label: "CSV: Sort rows by column…", keywords: ["csv", "sort", "order by", "rows", "column"], run: (v) => void csvSortCmd(v) },
  { id: "data.mdTableEdit", label: "Markdown table: Insert / delete / move column, add row…", keywords: ["markdown", "table", "column", "insert", "delete", "move"], run: (v) => void mdTableCmd(v) },
  { id: "data.mdTableSortAsc", label: "Markdown table: Sort by column at cursor ↑", keywords: ["markdown", "table", "sort", "ascending"], run: (v) => void mdTableCmd(v, "sortAsc") },
  { id: "data.mdTableSortDesc", label: "Markdown table: Sort by column at cursor ↓", keywords: ["markdown", "table", "sort", "descending"], run: (v) => void mdTableCmd(v, "sortDesc") },
  { id: "data.pasteReindent", label: "Paste and re-indent to the cursor", keywords: ["paste", "indent", "reindent", "smart paste", "format"], run: (v) => void pasteReindented(v) },
  { id: "data.barrel", label: "Generate barrel index for this folder", keywords: ["barrel", "index.ts", "exports", "re-export", "module"], run: () => void barrelCmd() },
  { id: "data.toggleArrow", label: "Convert function ⇄ arrow function", keywords: ["arrow", "function", "convert", "refactor", "lambda", "const"], run: toggleArrowCmd },
  { id: "data.duplicateKeys", label: "Find duplicate keys (JSON / YAML)", keywords: ["duplicate", "keys", "json", "yaml", "config", "overwrite"], run: (v) => void duplicateKeysCmd(v) },
];
