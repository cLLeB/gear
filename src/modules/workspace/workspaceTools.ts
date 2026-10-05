// Workspace palette tools: replace in files, workspace symbols, largest files,
// code statistics, .gitignore generator and LICENSE file.

import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { native } from "@/modules/ai/lib/native";
import { confirmPick, inputBox, quickPick } from "@/modules/quick-pick";
import { currentWorkspaceEnv } from "./env";
import { parseFindQuery, previewLine, replaceInText } from "./replace";
import { parseSymbol, SYMBOL_GREP_PATTERN } from "./symbols";
import { detectTemplates, GITIGNORE_TEMPLATES, LICENSES, mergeGitignore } from "./templates";

function requireRoot(): string | null {
  const root = app().workspaceRoot();
  if (!root) toast.error("Open a folder first");
  return root;
}

function formatBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${i ? n.toFixed(1) : n} ${units[i]}`;
}

// ── replace in files ──────────────────────────────────────────────────────

export async function replaceInFiles(): Promise<void> {
  const root = requireRoot();
  if (!root) return;
  const find = await inputBox({ title: "Find in files", placeholder: "text, or /regex/ with optional i (ignore case) and w (whole word) flags" });
  if (!find) return;
  let query;
  try {
    query = parseFindQuery(find);
  } catch (e) {
    toast.error("Invalid regular expression", { description: String(e) });
    return;
  }
  const replacement = await inputBox({
    title: `Replace “${find}” with…`,
    placeholder: query.isRegex ? "$1, $<name>, $& insert groups; \\U \\L \\u \\l change case" : "replacement text",
  });
  if (replacement === undefined) return;
  const globInput = await inputBox({ title: "Only in files matching (optional)", placeholder: "e.g. src/**/*.ts  — comma-separate several; empty for all" });
  if (globInput === undefined) return;
  const glob = globInput.split(",").map((g) => g.trim()).filter(Boolean);

  const res = await native
    .grep({ pattern: query.grepPattern, root, glob: glob.length ? glob : undefined, caseInsensitive: query.caseInsensitive, maxResults: 2000 })
    .catch((e) => {
      toast.error("Search failed", { description: String(e) });
      return null;
    });
  if (!res) return;
  if (!res.hits.length) {
    toast.info("No matches");
    return;
  }
  const files = [...new Set(res.hits.map((h) => h.path))];
  const pick = await quickPick(
    [
      { label: `Replace in ${files.length} file${files.length === 1 ? "" : "s"}`, description: `${res.hits.length}${res.truncated ? "+" : ""} matching lines`, value: null },
      ...res.hits.map((h) => ({
        label: previewLine(h.text, query, replacement).slice(0, 160),
        description: `${h.rel}:${h.line}`,
        detail: h.text.trim().slice(0, 160),
        value: h,
      })),
    ],
    { title: `Preview: ${find} → ${replacement || "(empty)"}`, placeholder: "Pick the first row to apply, or a match to open it" },
  );
  if (pick === undefined) return;
  if (pick) {
    app().openFile(pick.path, pick.line);
    return;
  }
  if (res.truncated && !(await confirmPick("Only the first 2000 matching lines were found", "Replace in the files found so far", "Narrow the search with a file filter to cover everything."))) return;
  let changedFiles = 0;
  let total = 0;
  const failed: string[] = [];
  for (const path of files) {
    const read = await native.readFile(path).catch(() => null);
    if (read?.kind !== "text") {
      failed.push(path);
      continue;
    }
    const { text, count } = replaceInText(read.content, query, replacement);
    if (!count) continue;
    try {
      await native.writeFile(path, text, "user");
      changedFiles++;
      total += count;
    } catch {
      failed.push(path);
    }
  }
  toast.success(`Replaced ${total} occurrence${total === 1 ? "" : "s"} in ${changedFiles} file${changedFiles === 1 ? "" : "s"}`, {
    description: failed.length ? `Skipped ${failed.length}: ${failed.slice(0, 3).join(", ")}` : undefined,
  });
}

// ── workspace symbols ─────────────────────────────────────────────────────

const KIND_ICON: Record<string, string> = {
  function: "ƒ",
  class: "◆",
  interface: "◇",
  type: "τ",
  enum: "≡",
  struct: "▣",
  trait: "◈",
  impl: "⊕",
  module: "▤",
};

export async function goToWorkspaceSymbol(): Promise<void> {
  const root = requireRoot();
  if (!root) return;
  const items = native.grep({ pattern: SYMBOL_GREP_PATTERN, root, maxResults: 2000 }).then((res) =>
    res.hits.flatMap((h) => {
      const sym = parseSymbol(h.text);
      if (!sym) return [];
      return [{ label: `${KIND_ICON[sym.kind] ?? "•"} ${sym.name}`, description: `${sym.kind} · ${h.rel}:${h.line}`, keywords: [sym.name, h.rel], value: h }];
    }),
  );
  const hit = await quickPick(items, { title: "Go to symbol in workspace", placeholder: "Functions, classes, types… (regex-based, no language server needed)" });
  if (hit) app().openFile(hit.path, hit.line);
}

// ── statistics ────────────────────────────────────────────────────────────

interface WorkspaceStats {
  largest: { path: string; rel: string; size: number }[];
  by_extension: Record<string, { files: number; lines: number; blank: number; bytes: number }>;
  files: number;
  bytes: number;
  truncated: boolean;
}

function loadStats(root: string, top = 100): Promise<WorkspaceStats> {
  return invoke<WorkspaceStats>("fs_workspace_stats", { root, top, workspace: currentWorkspaceEnv() });
}

export async function largestFiles(): Promise<void> {
  const root = requireRoot();
  if (!root) return;
  const file = await quickPick(
    loadStats(root).then((s) =>
      s.largest.map((f) => ({ label: f.rel, description: formatBytes(f.size), value: f.path })),
    ),
    { title: "Largest files (respecting .gitignore)", placeholder: "Pick one to open it" },
  );
  if (file) app().openFile(file);
}

export async function codeStatistics(): Promise<void> {
  const root = requireRoot();
  if (!root) return;
  const t = toast.loading("Counting lines…");
  const stats = await loadStats(root, 1).catch((e) => {
    toast.error("Could not scan the workspace", { description: String(e) });
    return null;
  });
  toast.dismiss(t);
  if (!stats) return;
  const rows = Object.entries(stats.by_extension).sort((a, b) => b[1].lines - a[1].lines || b[1].bytes - a[1].bytes);
  const totalLines = rows.reduce((n, [, s]) => n + s.lines, 0);
  await quickPick(
    [
      { label: `${stats.files.toLocaleString()} files · ${totalLines.toLocaleString()} lines · ${formatBytes(stats.bytes)}`, description: stats.truncated ? "partial" : "total", value: "" },
      ...rows.map(([ext, s]) => ({
        label: `.${ext}`.replace(".(none)", "(no extension)"),
        description: `${s.files.toLocaleString()} files · ${(s.lines - s.blank).toLocaleString()} code+comment · ${s.blank.toLocaleString()} blank · ${totalLines ? ((s.lines / totalLines) * 100).toFixed(1) : "0"}%`,
        value: ext,
      })),
    ],
    { title: "Code statistics (by file type)" },
  );
}

// ── generators ────────────────────────────────────────────────────────────

export async function generateGitignore(): Promise<void> {
  const root = requireRoot();
  if (!root) return;
  const entries = await native.readDir(root).catch(() => []);
  const detected = new Set(detectTemplates(entries.map((e) => e.name)));
  const chosen: string[] = [...detected];
  for (;;) {
    const pick = await quickPick(
      [
        { label: `✓ Write .gitignore with ${chosen.length} template${chosen.length === 1 ? "" : "s"}`, value: "__done" },
        ...GITIGNORE_TEMPLATES.map((t) => ({
          label: `${chosen.includes(t.id) ? "☑" : "☐"} ${t.label}`,
          description: detected.has(t.id) ? "detected" : undefined,
          value: t.id,
        })),
      ],
      { title: "Generate .gitignore", placeholder: "Toggle templates, then pick the first row" },
    );
    if (!pick) return;
    if (pick === "__done") break;
    const i = chosen.indexOf(pick);
    if (i >= 0) chosen.splice(i, 1);
    else chosen.push(pick);
  }
  if (!chosen.length) return;
  const path = `${root.replace(/[\\/]+$/, "")}/.gitignore`;
  const existing = await native.readFile(path).catch(() => null);
  const { content, added } = mergeGitignore(existing?.kind === "text" ? existing.content : "", chosen);
  if (!added) {
    toast.info(".gitignore already has all of those patterns");
    return;
  }
  await native.writeFile(path, content, "user");
  toast.success(`Added ${added} pattern${added === 1 ? "" : "s"} to .gitignore`, { action: { label: "Open", onClick: () => app().openFile(path) } });
}

export async function addLicense(): Promise<void> {
  const root = requireRoot();
  if (!root) return;
  const id = await quickPick(
    Object.entries(LICENSES).map(([k, l]) => ({ label: l.label, description: k, value: k })),
    { title: "Add a LICENSE file" },
  );
  if (!id) return;
  const nameFromGit = await native.runCommand("git config user.name", root, 5).then((r) => r.stdout.trim()).catch(() => "");
  const holder = await inputBox({ title: "Copyright holder", value: nameFromGit });
  if (!holder) return;
  const path = `${root.replace(/[\\/]+$/, "")}/LICENSE`;
  const existing = await native.readFile(path).catch(() => null);
  if (existing && !(await confirmPick("A LICENSE file already exists", "Replace it"))) return;
  await native.writeFile(path, LICENSES[id].text(String(new Date().getFullYear()), holder.trim()), "user");
  toast.success(`Added ${LICENSES[id].label} licence`, { action: { label: "Open", onClick: () => app().openFile(path) } });
}

export const WORKSPACE_TOOL_ACTIONS = [
  { id: "workspace.replaceInFiles", label: "Workspace: Replace in files…", keywords: ["find", "replace", "search", "rename", "refactor", "regex", "sed", "project-wide"], run: replaceInFiles },
  { id: "workspace.symbols", label: "Workspace: Go to symbol in workspace…", keywords: ["symbol", "function", "class", "definition", "ctrl+t", "navigate", "#"], run: goToWorkspaceSymbol },
  { id: "workspace.largestFiles", label: "Workspace: Show largest files", keywords: ["size", "disk", "big", "large", "space", "bloat"], run: largestFiles },
  { id: "workspace.codeStats", label: "Workspace: Code statistics (lines per language)", keywords: ["cloc", "loc", "lines of code", "sloc", "tokei", "count", "languages"], run: codeStatistics },
  { id: "workspace.gitignore", label: "Workspace: Generate .gitignore…", keywords: ["gitignore", "ignore", "template", "node_modules", "target"], run: generateGitignore },
  { id: "workspace.license", label: "Workspace: Add LICENSE file…", keywords: ["license", "licence", "mit", "bsd", "isc", "open source", "copyright"], run: addLicense },
];
