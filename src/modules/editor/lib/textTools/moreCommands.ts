// Editor commands: send the .http request under the cursor, select all regex
// matches, insert fake data, paste a URL as a Markdown link, and copy code as
// a fenced Markdown block.

import { EditorSelection, type SelectionRange } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { IS_WINDOWS } from "@/lib/platform";
import { inputBox, quickPick } from "@/modules/quick-pick";
import { readTerminalClipboard, writeTerminalClipboard } from "@/modules/terminal/lib/terminalClipboard";
import { isLeafCommandRunning } from "@/modules/terminal/lib/useTerminalSession";
import { guardedSubmit } from "@/modules/terminal/features/guardedSubmit";
import { targetLeaf } from "@/modules/terminal/features/sessionTools";
import { parseFindQuery } from "@/modules/workspace/replace";
import type { CodeActionDescriptor } from "../codeActions";
import { getActiveEditor } from "../activeEditor";
import { FAKE_KINDS, type FakeKind } from "./fakeData";
import { requestAt, toCurl, toCurlPowerShell } from "./httpFile";

export async function sendHttpRequestCmd(view: EditorView): Promise<void> {
  const req = requestAt(view.state.doc.toString(), view.state.selection.main.head);
  if (!req) {
    toast.info("Put the cursor inside a request (METHOD URL, headers, blank line, body)");
    return;
  }
  const unresolved = /\{\{\s*([\w.-]+)\s*\}\}/.exec(`${req.url} ${req.headers.map((h) => h[1]).join(" ")} ${req.body ?? ""}`);
  if (unresolved) {
    toast.warning(`Variable {{${unresolved[1]}}} is not defined`, { description: "Define it with @name = value at the top of the file." });
  }
  const command = IS_WINDOWS ? toCurlPowerShell(req) : toCurl(req);
  const leaf = targetLeaf();
  if (leaf !== null && !isLeafCommandRunning(leaf)) {
    if (await guardedSubmit(leaf, command)) toast.success(`${req.method} ${req.url}`, { description: "Sent to the terminal" });
    return;
  }
  const path = getActiveEditor()?.path;
  app().openTerminal({ cwd: path ? path.replace(/[\\/][^\\/]*$/, "") : null, command });
}

export async function selectAllRegexCmd(view: EditorView): Promise<void> {
  const input = await inputBox({ title: "Select all matches", placeholder: "text, or /regex/ with i and w flags" });
  if (!input) return;
  let q;
  try {
    q = parseFindQuery(input);
  } catch (e) {
    toast.error("Invalid regular expression", { description: String(e) });
    return;
  }
  const sel = view.state.selection.main;
  const scopeFrom = sel.empty ? 0 : sel.from;
  const text = sel.empty ? view.state.doc.toString() : view.state.sliceDoc(sel.from, sel.to);
  const ranges: SelectionRange[] = [];
  for (const m of text.matchAll(q.regex)) {
    if (!m[0]) continue;
    ranges.push(EditorSelection.range(scopeFrom + m.index!, scopeFrom + m.index! + m[0].length));
    if (ranges.length >= 10_000) break;
  }
  if (!ranges.length) {
    toast.info("No matches");
    return;
  }
  view.dispatch({ selection: EditorSelection.create(ranges), scrollIntoView: true });
  view.focus();
  toast.success(`${ranges.length} match${ranges.length === 1 ? "" : "es"} selected${sel.empty ? "" : " in the selection"}`);
}

export async function insertFakeDataCmd(view: EditorView): Promise<void> {
  const kind = await quickPick(
    (Object.keys(FAKE_KINDS) as FakeKind[]).map((k) => ({ label: FAKE_KINDS[k].label, description: FAKE_KINDS[k].gen(Math.random), value: k })),
    { title: "Insert fake data", placeholder: "One value per cursor" },
  );
  if (!kind) return;
  view.dispatch(
    view.state.changeByRange((range) => {
      const insert = FAKE_KINDS[kind].gen(Math.random);
      return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(range.from + insert.length) };
    }),
  );
  view.focus();
}

export async function pasteAsLinkCmd(view: EditorView): Promise<void> {
  const url = (await readTerminalClipboard()).trim();
  if (!/^(https?|ftp|mailto):\S+$|^\S+\.\S+\/\S*$/i.test(url)) {
    toast.info("Copy a URL first");
    return;
  }
  const sel = view.state.selection.main;
  const text = view.state.sliceDoc(sel.from, sel.to);
  const label = text || "link text";
  const insert = `[${label}](${url})`;
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert },
    selection: text ? EditorSelection.cursor(sel.from + insert.length) : EditorSelection.range(sel.from + 1, sel.from + 1 + label.length),
    userEvent: "input",
  });
  view.focus();
}

const FENCE_LANG: Record<string, string> = {
  ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", mjs: "js", cjs: "js", py: "python", rs: "rust", go: "go", rb: "ruby",
  java: "java", kt: "kotlin", swift: "swift", c: "c", h: "c", cpp: "cpp", cc: "cpp", hpp: "cpp", cs: "csharp",
  php: "php", sh: "bash", bash: "bash", zsh: "zsh", ps1: "powershell", sql: "sql", json: "json", yaml: "yaml",
  yml: "yaml", toml: "toml", md: "markdown", html: "html", css: "css", scss: "scss", xml: "xml", vue: "vue", svelte: "svelte",
};

export async function copyAsMarkdownCmd(view: EditorView): Promise<void> {
  const ed = getActiveEditor();
  const sel = view.state.selection.main;
  const from = sel.empty ? 0 : view.state.doc.lineAt(sel.from).from;
  const to = sel.empty ? view.state.doc.length : view.state.doc.lineAt(sel.to).to;
  const code = view.state.sliceDoc(from, to).replace(/\s+$/, "");
  const path = ed?.path ?? "";
  const root = app().workspaceRoot()?.replace(/\\/g, "/").replace(/\/+$/, "");
  const shown = root && path.replace(/\\/g, "/").startsWith(`${root}/`) ? path.replace(/\\/g, "/").slice(root.length + 1) : path.split(/[\\/]/).pop() ?? "";
  const ext = /\.([^.\\/]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";
  const fence = code.includes("```") ? "````" : "```";
  const startLine = view.state.doc.lineAt(from).number;
  const endLine = view.state.doc.lineAt(to).number;
  const header = shown ? `\`${shown}${sel.empty ? "" : `:${startLine}${endLine > startLine ? `-${endLine}` : ""}`}\`\n\n` : "";
  await writeTerminalClipboard(`${header}${fence}${FENCE_LANG[ext] ?? ext}\n${code}\n${fence}\n`);
  toast.success("Copied as Markdown", { description: shown || undefined });
}

export const MORE_TEXT_ACTIONS: CodeActionDescriptor[] = [
  { id: "text.sendHttpRequest", label: "Send HTTP request under cursor (.http / .rest)", keywords: ["http", "rest client", "request", "api", "curl", "postman", "send"], run: (v) => void sendHttpRequestCmd(v) },
  { id: "text.selectAllRegex", label: "Select all matches (regex, multi-cursor)…", keywords: ["regex", "select", "find all", "multi-cursor", "occurrences", "matches"], run: (v) => void selectAllRegexCmd(v) },
  { id: "text.fakeData", label: "Insert fake data (names, e-mails, lorem ipsum…)…", keywords: ["lorem", "ipsum", "fake", "faker", "mock", "dummy", "placeholder", "test data"], run: (v) => void insertFakeDataCmd(v) },
  { id: "text.pasteAsLink", label: "Markdown: Paste URL as link", keywords: ["markdown", "link", "url", "paste", "hyperlink"], run: (v) => void pasteAsLinkCmd(v) },
  { id: "text.copyAsMarkdown", label: "Copy as Markdown code block (with path)", keywords: ["markdown", "code block", "fence", "share", "copy", "chat", "issue"], run: (v) => void copyAsMarkdownCmd(v) },
];
