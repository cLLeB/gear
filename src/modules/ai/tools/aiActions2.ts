// More AI palette tools: project Q&A, release notes, explaining changes,
// branch names, adding types, mock data and translating prose.

import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { generateOneShot, oneShotUnavailableReason } from "@/modules/ai/lib/oneShot";
import { native } from "@/modules/ai/lib/native";
import { openCompare, openTextViewer } from "@/modules/compare/CompareDialog";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { git, gitOrToast, requireRepo } from "@/modules/git-actions/gitCli";
import { branchNameProblem } from "@/modules/git-actions/extras3";
import { confirmPick, inputBox, quickPick } from "@/modules/quick-pick";
import { writeTerminalClipboard } from "@/modules/terminal/lib/terminalClipboard";
import { renderTree } from "@/modules/workspace/projectTools";
import { langName, stripFence, truncateMiddle } from "./prompts";

async function ask(title: string, system: string, prompt: string, maxOutputTokens = 1500, temperature = 0.2): Promise<string | null> {
  const why = oneShotUnavailableReason();
  if (why) {
    toast.error("AI is not configured", { description: why });
    return null;
  }
  const t = toast.loading(title);
  try {
    return await generateOneShot({ system, prompt: truncateMiddle(prompt, 30_000), maxOutputTokens, temperature });
  } catch (e) {
    toast.error("AI request failed", { description: e instanceof Error ? e.message : String(e) });
    return null;
  } finally {
    toast.dismiss(t);
  }
}

async function readText(path: string): Promise<string> {
  const r = await native.readFile(path).catch(() => null);
  return r?.kind === "text" ? r.content : "";
}

export async function askAboutProject(): Promise<void> {
  const root = app().workspaceRoot();
  if (!root) return void toast.error("Open a folder first");
  const question = await inputBox({ title: "Ask about this project", placeholder: "e.g. where is authentication handled? how do I add a new route?" });
  if (!question) return;
  const files = (await native.glob({ pattern: "**/*", root, maxResults: 3000 }).catch(() => null))?.hits ?? [];
  const tree = renderTree(files.map((f) => f.rel.split("/").slice(0, 4).join("/")), root.split(/[\\/]/).pop());
  const docs = (await Promise.all(["README.md", "CONTRIBUTING.md", "CLAUDE.md", "AGENTS.md", "package.json", "Cargo.toml", "pyproject.toml"].map(async (f) => {
    const t = await readText(`${root}/${f}`);
    return t ? `--- ${f} ---\n${t.slice(0, 6000)}` : "";
  }))).filter(Boolean).join("\n\n");
  const reply = await ask(
    "Thinking about the project…",
    "You answer questions about a software project using only the file tree and docs provided. Name specific files and directories to look at. If the answer isn't determinable from what you were given, say what to search for. Short Markdown, no preamble.",
    `Question: ${question}\n\nFile tree (depth 4):\n${tree}\n\nDocs:\n${docs}`,
  );
  if (reply) openTextViewer(`Q: ${question}`, reply, "answer.md");
}

export async function aiReleaseNotes(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const tag = await git(root, ["describe", "--tags", "--abbrev=0"]);
  const since = tag.ok ? tag.stdout.trim() : "";
  const log = await git(root, ["log", "--no-merges", "--format=- %s%n%b", since ? `${since}..HEAD` : "-n200"]);
  if (!log.stdout.trim()) return void toast.info(since ? `No commits since ${since}` : "No commits");
  const reply = await ask(
    "Writing release notes…",
    "Write user-facing release notes in Markdown from these commits: a one-paragraph highlight summary, then sections New, Improved, Fixed (omit empty ones). Plain language for end users, not developers; merge related commits; skip internal chores, CI and refactors. No preamble.",
    `Changes since ${since || "the beginning"}:\n${log.stdout}`,
    1800,
  );
  if (!reply) return;
  await writeTerminalClipboard(reply.trim());
  openTextViewer(`Release notes since ${since || "start"} (copied)`, reply.trim(), "release-notes.md");
}

export async function explainMyChanges(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const diff = (await git(root, ["diff", "HEAD"])).stdout;
  const untracked = (await git(root, ["ls-files", "--others", "--exclude-standard"])).stdout.trim();
  if (!diff.trim() && !untracked) return void toast.info("No uncommitted changes");
  const reply = await ask(
    "Reading your changes…",
    "Summarize the uncommitted changes for the developer who made them, as if catching up after a break: what changed per area, what looks unfinished (TODOs, debug prints, commented code), and anything risky. Short Markdown bullets, no preamble.",
    `Untracked files:\n${untracked || "(none)"}\n\nDiff:\n\`\`\`diff\n${diff}\n\`\`\``,
  );
  if (reply) openTextViewer("Your uncommitted changes", reply, "changes.md");
}

export async function aiBranchName(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const what = await inputBox({ title: "What will you work on?", placeholder: "e.g. fix crash when pasting images on Windows" });
  if (!what) return;
  const reply = await ask(
    "Naming the branch…",
    "Suggest 5 git branch names for the task using the convention type/short-kebab-description (types: feat, fix, chore, docs, refactor, test, perf). Max 50 characters each. One per line, no numbering or commentary.",
    what,
    200,
    0.4,
  );
  if (!reply) return;
  const names = reply.split("\n").map((l) => l.replace(/^[\s\-*\d.)`]+|`$/g, "").trim()).filter((n) => n && !branchNameProblem(n));
  const pick = await quickPick(names.map((n) => ({ label: n, value: n })), { title: "Create and switch to branch", emptyText: "No usable names returned" });
  if (pick && (await gitOrToast(root, ["switch", "-c", pick], "Create branch")) !== null) toast.success(`Switched to new branch ${pick}`);
}

export async function aiAddTypes(): Promise<void> {
  const ed = getActiveEditor();
  if (!ed) return void toast.error("Open a file first");
  const sel = ed.view.state.selection.main;
  const from = sel.empty ? 0 : sel.from;
  const to = sel.empty ? ed.view.state.doc.length : sel.to;
  const code = ed.view.state.sliceDoc(from, to);
  const lang = langName(ed.path ?? "", ed.languageId);
  const reply = await ask(
    "Adding types…",
    "Add precise type annotations to the code without changing behaviour: TypeScript types/interfaces for JS/TS (no `any` unless unavoidable), PEP 484 type hints for Python, explicit types where idiomatic elsewhere. Keep formatting and comments. Reply with only the full code in one code block.",
    `Language: ${lang}\n\n\`\`\`\n${code}\n\`\`\``,
    4000,
  );
  if (!reply) return;
  const typed = stripFence(reply) + (code.endsWith("\n") && !reply.endsWith("\n") ? "\n" : "");
  openCompare({ title: "AI: add types", originalLabel: "current", modifiedLabel: "with types", original: code, modified: typed, languageHint: ed.path });
  toast("Typed version ready", {
    duration: 120_000,
    action: {
      label: "Apply",
      onClick: () => ed.view.dispatch({ changes: { from, to, insert: typed }, userEvent: "input" }),
    },
  });
}

export async function aiMockData(): Promise<void> {
  const ed = getActiveEditor();
  const sel = ed && !ed.view.state.selection.main.empty ? ed.view.state.sliceDoc(ed.view.state.selection.main.from, ed.view.state.selection.main.to) : "";
  const what = await inputBox({ title: sel ? "Mock data matching the selected type/schema — how many records?" : "Describe the mock data", value: sel ? "10" : "20 users with id, name, email, signup date and plan (free/pro)" });
  if (!what) return;
  const reply = await ask(
    "Generating mock data…",
    "Generate realistic, varied mock data as a JSON array that matches the description or type definition. Use example.com e-mail domains and obviously fake phone numbers. Reply with only the JSON in one code block.",
    sel ? `Type / schema:\n${sel}\n\nRecords: ${what}` : what,
    3500,
    0.7,
  );
  if (!reply) return;
  const json = stripFence(reply);
  try {
    JSON.parse(json);
  } catch {
    toast.warning("The model's JSON didn't parse; showing it anyway");
  }
  const where = await quickPick(
    [
      { label: "Copy to clipboard", value: "copy" },
      { label: "Insert at cursor", value: "insert" },
      { label: "Preview", value: "view" },
    ],
    { title: "Mock data ready" },
  );
  if (where === "copy") await writeTerminalClipboard(json);
  else if (where === "insert" && ed) ed.view.dispatch(ed.view.state.replaceSelection(json));
  else if (where === "view") openTextViewer("Mock data", json, "mock.json");
}

const LANGUAGES = ["English", "Spanish", "French", "German", "Portuguese", "Italian", "Dutch", "Chinese (Simplified)", "Japanese", "Korean", "Arabic", "Hindi", "Swahili", "Twi", "Yoruba", "Hausa", "Russian", "Turkish"];

export async function aiTranslateText(): Promise<void> {
  const ed = getActiveEditor();
  const sel = ed?.view.state.selection.main;
  if (!ed || !sel || sel.empty) return void toast.info("Select the text to translate");
  const target = await quickPick(LANGUAGES.map((l) => ({ label: l, value: l })), { title: "Translate selection to…" });
  if (!target) return;
  const text = ed.view.state.sliceDoc(sel.from, sel.to);
  const reply = await ask(
    `Translating to ${target}…`,
    `Translate the text to ${target}. Preserve Markdown, HTML tags, placeholders like {name} / %s / {{var}}, code spans and line breaks exactly; only translate human-readable text. If it is a JSON/YAML i18n file, translate only the values. Reply with only the translation.`,
    text,
    3000,
  );
  if (!reply) return;
  const out = stripFence(reply);
  if (await confirmPick(`Replace the selection with the ${target} translation?`, "Replace", out.slice(0, 200))) ed.view.dispatch({ changes: { from: sel.from, to: sel.to, insert: out }, userEvent: "input" });
  else await writeTerminalClipboard(out);
}

export const AI_TOOL_ACTIONS_2 = [
  { id: "ai.askProject", label: "AI: Ask a question about this project…", keywords: ["project", "codebase", "where is", "how do i", "onboarding", "ai"], run: askAboutProject },
  { id: "ai.releaseNotes", label: "AI: Write release notes since the last tag", keywords: ["release notes", "changelog", "what's new", "announcement", "ai"], run: aiReleaseNotes },
  { id: "ai.explainChanges", label: "AI: Summarize my uncommitted changes", keywords: ["changes", "diff", "summary", "where was i", "catch up", "ai"], run: explainMyChanges },
  { id: "ai.branchName", label: "AI: Suggest a branch name and create it…", keywords: ["branch", "name", "create branch", "naming", "ai"], run: aiBranchName },
  { id: "ai.addTypes", label: "AI: Add types / type hints (selection or file)", keywords: ["types", "typescript", "type hints", "annotations", "mypy", "ai"], run: aiAddTypes },
  { id: "ai.mockData", label: "AI: Generate mock data (JSON)…", keywords: ["mock", "fake", "fixtures", "seed", "test data", "json", "ai"], run: aiMockData },
  { id: "ai.translateText", label: "AI: Translate selected text to another language…", keywords: ["translate", "i18n", "localization", "language", "docs", "ai"], run: aiTranslateText },
];
