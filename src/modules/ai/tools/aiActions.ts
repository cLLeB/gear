// AI palette tools built on the configured one-shot model: explain, document,
// test, review, rename, translate, PR descriptions, one-liners, output
// summaries, instruction edits and stack-trace explanations.

import { EditorSelection } from "@codemirror/state";
import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { generateOneShot, oneShotUnavailableReason } from "@/modules/ai/lib/oneShot";
import { native } from "@/modules/ai/lib/native";
import { openCompare, openTextViewer } from "@/modules/compare/CompareDialog";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { git, requireRepo } from "@/modules/git-actions/gitCli";
import { confirmPick, inputBox, quickPick } from "@/modules/quick-pick";
import { readTerminalClipboard, writeTerminalClipboard } from "@/modules/terminal/lib/terminalClipboard";
import { lastFinishedCommand } from "@/modules/terminal/lib/useTerminalSession";
import { indentBlock, langName, parseNameList, PROMPTS, stripFence, testFileFor, truncateMiddle } from "./prompts";

async function ask(title: string, system: string, prompt: string, maxOutputTokens = 1200): Promise<string | null> {
  const why = oneShotUnavailableReason();
  if (why) {
    toast.error("AI is not configured", { description: why });
    return null;
  }
  const t = toast.loading(title);
  try {
    return await generateOneShot({ system, prompt: truncateMiddle(prompt), maxOutputTokens, temperature: 0.2 });
  } catch (e) {
    toast.error("AI request failed", { description: e instanceof Error ? e.message : String(e) });
    return null;
  } finally {
    toast.dismiss(t);
  }
}

function editorContext() {
  const ed = getActiveEditor();
  if (!ed) {
    toast.error("Open a file in the editor first");
    return null;
  }
  const sel = ed.view.state.selection.main;
  const whole = sel.empty;
  const from = whole ? 0 : sel.from;
  const to = whole ? ed.view.state.doc.length : sel.to;
  return { ed, from, to, whole, code: ed.view.state.sliceDoc(from, to), lang: langName(ed.path ?? "", ed.languageId), file: ed.path?.split(/[\\/]/).pop() ?? "untitled" };
}

export async function aiExplain(): Promise<void> {
  const c = editorContext();
  if (!c) return;
  const reply = await ask("Explaining…", PROMPTS.explain.system, PROMPTS.explain.user(c.lang, c.code, c.file));
  if (reply) openTextViewer(`Explanation: ${c.whole ? c.file : "selection"}`, reply, "explanation.md");
}

export async function aiDocComment(): Promise<void> {
  const c = editorContext();
  if (!c) return;
  if (c.whole) return void toast.info("Select the function or class to document");
  const reply = await ask("Writing documentation…", PROMPTS.docComment.system, PROMPTS.docComment.user(c.lang, c.code), 600);
  if (!reply) return;
  const view = c.ed.view;
  const line = view.state.doc.lineAt(c.from);
  const indent = /^\s*/.exec(line.text)![0];
  const comment = stripFence(reply);
  // Python docstrings go inside the body; everything else goes above.
  if (/^\s*(""")/.test(comment) && /:\s*$/.test(line.text)) {
    const body = view.state.doc.line(Math.min(line.number + 1, view.state.doc.lines));
    const inner = /^\s*/.exec(body.text)![0] || `${indent}    `;
    view.dispatch({ changes: { from: line.to, insert: `\n${indentBlock(comment, inner)}` }, userEvent: "input" });
  } else view.dispatch({ changes: { from: line.from, insert: `${indentBlock(comment, indent)}\n` }, userEvent: "input" });
  toast.success("Documentation inserted", { description: "Undo with Ctrl/Cmd+Z if you don't like it." });
}

export async function aiTests(): Promise<void> {
  const c = editorContext();
  if (!c) return;
  const reply = await ask("Writing tests…", PROMPTS.tests.system, PROMPTS.tests.user(c.lang, c.code, c.file), 2500);
  if (!reply) return;
  const code = stripFence(reply);
  const where = await quickPick(
    [
      ...(c.ed.path ? [{ label: `Create ${testFileFor(c.ed.path).split(/[\\/]/).pop()}`, value: "file" }] : []),
      { label: "Copy to clipboard", value: "copy" },
      { label: "Preview", value: "view" },
    ],
    { title: "Generated tests" },
  );
  if (where === "copy") return void (await writeTerminalClipboard(code), toast.success("Copied tests"));
  if (where === "view") return openTextViewer("Generated tests", code, c.ed.path ?? "tests.ts");
  if (where === "file" && c.ed.path) {
    const path = testFileFor(c.ed.path);
    const exists = await native.readFile(path).then(() => true).catch(() => false);
    if (exists && !(await confirmPick(`${path.split(/[\\/]/).pop()} exists`, "Overwrite"))) return;
    await native.writeFile(path, code.endsWith("\n") ? code : `${code}\n`, "user");
    app().openFile(path);
  }
}

export async function aiReview(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const staged = await git(root, ["diff", "--cached"]);
  const diff = staged.stdout.trim() ? staged.stdout : (await git(root, ["diff"])).stdout;
  if (!diff.trim()) return void toast.info("No changes to review");
  const reply = await ask("Reviewing changes…", PROMPTS.review.system, PROMPTS.review.user(diff), 2000);
  if (reply) openTextViewer(`AI review of ${staged.stdout.trim() ? "staged" : "unstaged"} changes`, reply, "review.md");
}

export async function aiRename(): Promise<void> {
  const c = editorContext();
  if (!c) return;
  const view = c.ed.view;
  const head = view.state.selection.main.head;
  const word = view.state.wordAt(head);
  if (!word) return void toast.info("Put the cursor on an identifier");
  const name = view.state.sliceDoc(word.from, word.to);
  const line = view.state.doc.lineAt(head).number;
  const ctx = view.state.sliceDoc(view.state.doc.line(Math.max(1, line - 15)).from, view.state.doc.line(Math.min(view.state.doc.lines, line + 15)).to);
  const reply = await ask("Thinking of names…", PROMPTS.names.system, PROMPTS.names.user(c.lang, name, ctx), 200);
  if (!reply) return;
  const pick = await quickPick(parseNameList(reply).map((n) => ({ label: n, value: n })), { title: `Rename ${name} to…`, placeholder: "Renames every whole-word occurrence in this file" });
  if (!pick) return;
  const text = view.state.doc.toString();
  const changes = [...text.matchAll(new RegExp(`(?<![\\w$])${name.replace(/[$]/g, "\\$")}(?![\\w$])`, "g"))].map((m) => ({ from: m.index!, to: m.index! + name.length, insert: pick }));
  view.dispatch({ changes, userEvent: "input" });
  toast.success(`Renamed ${changes.length} occurrence${changes.length === 1 ? "" : "s"} in this file`);
}

const TARGETS = ["TypeScript", "JavaScript", "Python", "Rust", "Go", "Java", "Kotlin", "C#", "Swift", "Ruby", "PHP", "C++", "Bash", "PowerShell"];

export async function aiTranslate(): Promise<void> {
  const c = editorContext();
  if (!c) return;
  const to = await quickPick(TARGETS.filter((t) => !c.lang.startsWith(t)).map((t) => ({ label: t, value: t })), { title: `Translate ${c.whole ? c.file : "selection"} (${c.lang}) to…` });
  if (!to) return;
  const reply = await ask(`Translating to ${to}…`, PROMPTS.translate.system, PROMPTS.translate.user(c.lang, to, c.code), 3000);
  if (!reply) return;
  const code = stripFence(reply);
  const where = await quickPick(
    [
      { label: "Preview", value: "view" },
      { label: "Copy to clipboard", value: "copy" },
    ],
    { title: `${to} version` },
  );
  if (where === "view") openTextViewer(`${c.file} in ${to}`, code, `x.${{ TypeScript: "ts", JavaScript: "js", Python: "py", Rust: "rs", Go: "go", Java: "java", Kotlin: "kt", "C#": "cs", Swift: "swift", Ruby: "rb", PHP: "php", "C++": "cpp", Bash: "sh", PowerShell: "ps1" }[to]}`);
  else if (where === "copy") await writeTerminalClipboard(code);
}

export async function aiPrDescription(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const branch = (await git(root, ["branch", "--show-current"])).stdout.trim();
  const head = await git(root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  const base = head.ok ? head.stdout.trim() : "main";
  const commits = (await git(root, ["log", "--format=- %s", `${base}..HEAD`])).stdout.trim();
  if (!commits) return void toast.info(`No commits on ${branch} since ${base}`);
  const diff = (await git(root, ["diff", `${base}...HEAD`])).stdout;
  const reply = await ask("Writing the PR description…", PROMPTS.prDescription.system, PROMPTS.prDescription.user(branch, commits, truncateMiddle(diff, 18_000)), 1500);
  if (!reply) return;
  await writeTerminalClipboard(reply.trim());
  openTextViewer(`PR description for ${branch} (copied)`, reply.trim(), "pr.md");
}

export async function aiOneLiner(): Promise<void> {
  const tool = await quickPick(
    ["Regular expression (JavaScript)", "jq filter", "SQL query (PostgreSQL)", "awk program", "sed expression", "XPath", "CSS selector", "cron expression", "glob pattern"].map((t) => ({ label: t, value: t })),
    { title: "Write an expression with AI" },
  );
  if (!tool) return;
  const request = await inputBox({ title: `${tool}: what should it do?`, placeholder: "e.g. match ISO dates like 2024-05-01" });
  if (!request) return;
  const c = getActiveEditor();
  const sel = c ? c.view.state.sliceDoc(c.view.state.selection.main.from, c.view.state.selection.main.to) : "";
  const reply = await ask("Writing it…", PROMPTS.oneLiner.system, PROMPTS.oneLiner.user(tool, request, sel.slice(0, 2000) || undefined), 300);
  if (!reply) return;
  const expr = stripFence(reply).trim();
  if (c && !c.view.state.selection.main.empty) {
    if (await confirmPick(expr, "Replace the selection with it", "or Esc to copy instead")) {
      c.view.dispatch(c.view.state.replaceSelection(expr));
      return;
    }
  } else if (c && (await confirmPick(expr, "Insert at cursor", "or Esc to copy instead"))) {
    c.view.dispatch({ ...c.view.state.replaceSelection(expr), selection: EditorSelection.cursor(c.view.state.selection.main.from + expr.length) });
    return;
  }
  await writeTerminalClipboard(expr);
  toast.success("Copied", { description: expr });
}

export async function aiSummarizeOutput(): Promise<void> {
  const leaf = app().activeTerminalLeaf();
  const last = leaf !== null ? lastFinishedCommand(leaf) : null;
  if (!last?.output) return void toast.error("No captured output from the last command in this pane");
  const reply = await ask("Summarizing output…", PROMPTS.summarize.system, PROMPTS.summarize.user(last.command, last.output), 900);
  if (reply) openTextViewer(`Summary: ${last.command}`, reply, "summary.md");
}

export async function aiEdit(): Promise<void> {
  const c = editorContext();
  if (!c) return;
  const instruction = await inputBox({ title: `Edit ${c.whole ? c.file : "selection"} with AI`, placeholder: "e.g. add input validation and early returns" });
  if (!instruction) return;
  const reply = await ask("Editing…", PROMPTS.edit.system, PROMPTS.edit.user(c.lang, instruction, c.code), 4000);
  if (!reply) return;
  const code = stripFence(reply);
  const trailing = c.code.endsWith("\n") && !code.endsWith("\n") ? "\n" : "";
  const apply = () => {
    c.ed.view.dispatch({ changes: { from: c.from, to: c.to, insert: code + trailing }, userEvent: "input" });
    toast.success("Applied — Undo with Ctrl/Cmd+Z");
  };
  const choice = await quickPick(
    [
      { label: "Review the diff first", value: "diff" },
      { label: "Apply now", value: "apply" },
      { label: "Copy the proposed code", value: "copy" },
    ],
    { title: `AI edit ready: ${instruction}` },
  );
  if (choice === "apply") apply();
  else if (choice === "copy") await writeTerminalClipboard(code + trailing);
  else if (choice === "diff") {
    openCompare({ title: `AI edit: ${instruction}`, originalLabel: "current", modifiedLabel: "proposed", original: c.code, modified: code + trailing, languageHint: c.ed.path });
    toast("Proposed change", { duration: 120_000, action: { label: "Apply", onClick: apply } });
  }
}

export async function aiExplainStackTrace(): Promise<void> {
  const ed = getActiveEditor();
  const sel = ed && !ed.view.state.selection.main.empty ? ed.view.state.sliceDoc(ed.view.state.selection.main.from, ed.view.state.selection.main.to) : "";
  const trace = sel || (await readTerminalClipboard());
  if (!trace.trim()) return void toast.info("Copy or select an error / stack trace first");
  const reply = await ask("Reading the error…", PROMPTS.stackTrace.system, PROMPTS.stackTrace.user(trace), 900);
  if (reply) openTextViewer("Error explained", reply, "error.md");
}

export const AI_TOOL_ACTIONS = [
  { id: "ai.explain", label: "AI: Explain this code (selection or file)", keywords: ["explain", "understand", "what does", "ai"], run: aiExplain },
  { id: "ai.docComment", label: "AI: Write a doc comment for the selection", keywords: ["docstring", "jsdoc", "documentation", "comment", "ai"], run: aiDocComment },
  { id: "ai.tests", label: "AI: Generate unit tests", keywords: ["tests", "unit test", "coverage", "pytest", "vitest", "ai"], run: aiTests },
  { id: "ai.review", label: "AI: Review my changes (staged or unstaged)", keywords: ["review", "diff", "bugs", "code review", "ai"], run: aiReview },
  { id: "ai.rename", label: "AI: Suggest a better name for this identifier", keywords: ["rename", "naming", "identifier", "variable", "ai"], run: aiRename },
  { id: "ai.translate", label: "AI: Translate code to another language…", keywords: ["translate", "port", "convert", "rewrite", "language", "ai"], run: aiTranslate },
  { id: "ai.prDescription", label: "AI: Write a pull request description", keywords: ["pull request", "pr", "description", "summary", "ai"], run: aiPrDescription },
  { id: "ai.oneLiner", label: "AI: Write a regex / jq / SQL / awk expression…", keywords: ["regex", "jq", "sql", "awk", "sed", "xpath", "cron", "ai"], run: aiOneLiner },
  { id: "ai.summarizeOutput", label: "AI: Summarize the last command's output", keywords: ["summarize", "logs", "output", "terminal", "ai"], run: aiSummarizeOutput },
  { id: "ai.edit", label: "AI: Edit selection with an instruction…", keywords: ["edit", "refactor", "rewrite", "change", "ai", "inline"], run: aiEdit },
  { id: "ai.stackTrace", label: "AI: Explain an error / stack trace (clipboard or selection)", keywords: ["stack trace", "error", "exception", "traceback", "crash", "ai"], run: aiExplainStackTrace },
];
