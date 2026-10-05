// Project palette tools: outdated dependencies, duplicate files, new file
// from template, README / CHANGELOG, version bump, file tree, AI context,
// token estimates, secret scanning, checksums and recent files.

import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { native } from "@/modules/ai/lib/native";
import { forgetRecentFiles, getActiveEditor, recentFiles } from "@/modules/editor/lib/activeEditor";
import { base64ToBytes } from "@/modules/editor/lib/textTools/hexdump";
import { md5 } from "@/modules/editor/lib/textTools/hash";
import { confirmPick, inputBox, quickPick } from "@/modules/quick-pick";
import { writeTerminalClipboard } from "@/modules/terminal/lib/terminalClipboard";
import { scanForSecrets } from "@/modules/terminal/features/secretScan";
import { currentWorkspaceEnv } from "./env";
import {
  changelogFrom,
  estimateTokens,
  FILE_TEMPLATES,
  nextVersion,
  parseNpmOutdated,
  parsePipOutdated,
  readmeFor,
  renderTree,
  setManifestVersion,
  templateFileName,
  type ProjectInfo,
} from "./projectTools";

function requireRoot(): string | null {
  const r = app().workspaceRoot();
  if (!r) toast.error("Open a folder first");
  return r?.replace(/[\\/]+$/, "") ?? null;
}

async function readText(path: string): Promise<string | null> {
  const r = await native.readFile(path).catch(() => null);
  return r?.kind === "text" ? r.content : null;
}

async function exists(path: string): Promise<boolean> {
  return invoke("fs_stat", { path, workspace: currentWorkspaceEnv() }).then(() => true).catch(() => false);
}

async function copy(text: string, what: string) {
  await writeTerminalClipboard(text);
  toast.success(`Copied ${what}`);
}

// ── dependencies ──────────────────────────────────────────────────────────

export async function outdatedDependencies(): Promise<void> {
  const root = requireRoot();
  if (!root) return;
  const pm = (await exists(`${root}/pnpm-lock.yaml`)) ? "pnpm" : (await exists(`${root}/yarn.lock`)) ? "yarn" : (await exists(`${root}/package.json`)) ? "npm" : null;
  const py = !pm && ((await exists(`${root}/requirements.txt`)) || (await exists(`${root}/pyproject.toml`)));
  if (!pm && !py) return void toast.info("No package.json, requirements.txt or pyproject.toml here");
  const t = toast.loading("Checking for updates…");
  const cmd = pm === "pnpm" ? "pnpm outdated --format json" : pm === "yarn" ? "npm outdated --json" : pm === "npm" ? "npm outdated --json" : "pip list --outdated --format=json";
  const r = await native.runCommand(cmd, root, 120).catch(() => null);
  toast.dismiss(t);
  let list;
  try {
    // npm/pnpm exit 1 when something is outdated — the JSON is still on stdout.
    list = pm ? parseNpmOutdated(r?.stdout ?? "") : parsePipOutdated(r?.stdout ?? "");
  } catch {
    return void toast.error("Could not read the package manager's output", { description: (r?.stderr ?? "").trim().slice(0, 300) });
  }
  if (!list.length) return void toast.success("Everything is up to date");
  const icon = { major: "🔴", minor: "🟡", patch: "🟢", unknown: "⚪" } as const;
  const pick = await quickPick(
    list.map((o) => ({ label: `${icon[o.kind]} ${o.name}`, description: `${o.current} → ${o.latest}${o.wanted && o.wanted !== o.latest ? ` (in range: ${o.wanted})` : ""}`, value: o })),
    { title: `${list.length} outdated package${list.length === 1 ? "" : "s"}`, placeholder: "Pick one to get its upgrade command" },
  );
  if (!pick) return;
  const upgrade = pm === "pnpm" ? `pnpm add ${pick.name}@${pick.latest}` : pm === "yarn" ? `yarn add ${pick.name}@${pick.latest}` : pm === "npm" ? `npm install ${pick.name}@${pick.latest}` : `pip install -U ${pick.name}`;
  if (await confirmPick(`Upgrade ${pick.name} to ${pick.latest}?`, "Run in a new terminal", upgrade)) app().openTerminal({ cwd: root, command: upgrade });
  else await copy(upgrade, "upgrade command");
}

// ── duplicates ────────────────────────────────────────────────────────────

export async function duplicateFiles(): Promise<void> {
  const root = requireRoot();
  if (!root) return;
  const t = toast.loading("Hashing files…");
  const groups = await invoke<{ size: number; files: string[] }[]>("fs_duplicate_files", { root, workspace: currentWorkspaceEnv() }).catch((e) => {
    toast.error("Scan failed", { description: String(e) });
    return null;
  });
  toast.dismiss(t);
  if (!groups) return;
  if (!groups.length) return void toast.success("No duplicate files");
  const wasted = groups.reduce((n, g) => n + g.size * (g.files.length - 1), 0);
  const rel = (p: string) => p.replace(/\\/g, "/").slice(root.replace(/\\/g, "/").length + 1);
  const pick = await quickPick(
    groups.flatMap((g, i) => g.files.map((f) => ({ label: rel(f), description: `group ${i + 1} · ${g.files.length} copies · ${(g.size / 1024).toFixed(1)} KB each`, value: f }))),
    { title: `${groups.length} sets of identical files · ${(wasted / 1024 / 1024).toFixed(2)} MB duplicated`, placeholder: "Pick a file to open it" },
  );
  if (pick) app().openFile(pick);
}

// ── generators ────────────────────────────────────────────────────────────

export async function newFileFromTemplate(): Promise<void> {
  const root = requireRoot();
  if (!root) return;
  const t = await quickPick(FILE_TEMPLATES.map((x) => ({ label: x.label, description: x.file, value: x })), { title: "New file from template" });
  if (!t) return;
  const needsName = t.file.includes("{");
  const name = needsName ? await inputBox({ title: "Name", placeholder: "e.g. user card" }) : "";
  if (needsName && !name) return;
  const activeDir = getActiveEditor()?.path?.replace(/[\\/][^\\/]*$/, "");
  const dir = t.file.startsWith(".github") || !needsName ? root : (activeDir ?? root);
  const path = await inputBox({ title: "Create at", value: `${dir}/${templateFileName(t, name ?? "")}` });
  if (!path) return;
  if ((await exists(path)) && !(await confirmPick(`${path} exists`, "Overwrite"))) return;
  await native.writeFile(path, t.body(name ?? ""), "user");
  app().openFile(path);
}

async function projectInfo(root: string): Promise<ProjectInfo> {
  const pkg = await readText(`${root}/package.json`);
  if (pkg) {
    const j = JSON.parse(pkg) as { name?: string; description?: string; license?: string; scripts?: Record<string, string>; repository?: string | { url?: string } };
    return { kind: "node", name: j.name ?? root.split("/").pop()!, description: j.description, license: j.license, scripts: j.scripts, repository: typeof j.repository === "string" ? j.repository : j.repository?.url };
  }
  const cargo = await readText(`${root}/Cargo.toml`);
  const field = (src: string, k: string) => new RegExp(`^${k}\\s*=\\s*"([^"]*)"`, "m").exec(src)?.[1];
  if (cargo) return { kind: "rust", name: field(cargo, "name") ?? "crate", description: field(cargo, "description"), license: field(cargo, "license"), repository: field(cargo, "repository") };
  const py = await readText(`${root}/pyproject.toml`);
  if (py) return { kind: "python", name: field(py, "name") ?? "package", description: field(py, "description"), license: field(py, "license") };
  if (await exists(`${root}/go.mod`)) return { kind: "go", name: root.split(/[\\/]/).pop()! };
  return { kind: "other", name: root.split(/[\\/]/).pop()! };
}

export async function generateReadme(): Promise<void> {
  const root = requireRoot();
  if (!root) return;
  const path = `${root}/README.md`;
  if ((await exists(path)) && !(await confirmPick("README.md already exists", "Replace it with a generated one"))) return;
  await native.writeFile(path, readmeFor(await projectInfo(root)), "user");
  app().openFile(path);
}

export async function generateChangelog(): Promise<void> {
  const root = requireRoot();
  if (!root) return;
  const tag = await native.runCommand("git describe --tags --abbrev=0", root, 10).catch(() => null);
  const since = tag?.exit_code === 0 ? tag.stdout.trim() : "";
  const log = await native.runCommand(`git log --no-merges --format=%h%x1f%s ${since ? `${since}..HEAD` : "-n 200"}`, root, 30).catch(() => null);
  const subjects = (log?.stdout ?? "").split("\n").filter((l) => l.includes("\x1f")).map((l) => {
    const [short, subject] = l.split("\x1f");
    return { short, subject };
  });
  if (!subjects.length) return void toast.info(since ? `No commits since ${since}` : "No commits");
  const info = await projectInfo(root);
  const current = (await readText(`${root}/package.json`))?.match(/"version"\s*:\s*"([^"]+)"/)?.[1] ?? since.replace(/^v/, "");
  const version = await inputBox({ title: `Changelog for ${subjects.length} commits since ${since || "the start"} — version`, value: current ? nextVersion(current, "minor") : "Unreleased" });
  if (!version) return;
  const section = changelogFrom(version, subjects);
  const path = `${root}/CHANGELOG.md`;
  const existing = (await readText(path)) ?? `# Changelog\n\nAll notable changes to ${info.name}.\n`;
  const at = existing.search(/^## /m);
  const next = at < 0 ? `${existing.replace(/\s*$/, "")}\n\n${section}` : `${existing.slice(0, at)}${section}\n${existing.slice(at)}`;
  await native.writeFile(path, next, "user");
  app().openFile(path);
}

export async function bumpVersion(): Promise<void> {
  const root = requireRoot();
  if (!root) return;
  const manifests = ["package.json", "Cargo.toml", "pyproject.toml"];
  const found: { file: string; content: string; version: string }[] = [];
  for (const f of manifests) {
    const c = await readText(`${root}/${f}`);
    const v = c ? setManifestVersion(f, c, "0.0.0")?.old : null;
    if (c && v) found.push({ file: f, content: c, version: v });
  }
  if (!found.length) return void toast.info("No version in package.json, Cargo.toml or pyproject.toml");
  const cur = found[0].version;
  const level = await quickPick(
    (["patch", "minor", "major", "prerelease"] as const).map((l) => ({ label: `${l}: ${cur} → ${nextVersion(cur, l)}`, value: l })),
    { title: `Bump version (${found.map((f) => f.file).join(", ")})` },
  );
  if (!level) return;
  const next = nextVersion(cur, level);
  for (const f of found) await native.writeFile(`${root}/${f.file}`, setManifestVersion(f.file, f.content, next)!.content, "user");
  const tag = await confirmPick(`Version is now ${next}. Commit and tag v${next}?`, "Commit + tag", "Runs git commit and git tag in the workspace");
  if (tag) {
    const files = found.map((f) => f.file).join(" ");
    const r = await native.runCommand(`git add ${files} && git commit -m "chore: release ${next}" && git tag v${next}`, root, 30);
    if (r.exit_code === 0) toast.success(`Committed and tagged v${next}`);
    else toast.error("git failed", { description: (r.stderr || r.stdout).trim().slice(0, 300) });
  } else toast.success(`Bumped to ${next}`);
}

// ── sharing context ───────────────────────────────────────────────────────

async function workspaceFiles(root: string): Promise<{ path: string; rel: string }[]> {
  const r = await native.glob({ pattern: "**/*", root, maxResults: 20000 }).catch(() => null);
  return r?.hits ?? [];
}

export async function copyFileTree(): Promise<void> {
  const root = requireRoot();
  if (!root) return;
  const files = await workspaceFiles(root);
  const depth = await quickPick(
    [
      { label: "Folders and files, 3 levels", value: 3 },
      { label: "Everything", value: 99 },
      { label: "Top level only", value: 1 },
    ],
    { title: `Copy file tree (${files.length} files, .gitignore respected)` },
  );
  if (!depth) return;
  const paths = [...new Set(files.map((f) => f.rel.split("/").slice(0, depth).join("/")))];
  await copy(renderTree(paths, root.split(/[\\/]/).pop()), "file tree");
}

export async function copyFilesAsContext(): Promise<void> {
  const root = requireRoot();
  if (!root) return;
  const files = await workspaceFiles(root);
  const chosen = new Set<string>();
  const active = getActiveEditor()?.path;
  if (active) chosen.add(active);
  for (;;) {
    const pick = await quickPick(
      [
        { label: `✓ Copy ${chosen.size} file${chosen.size === 1 ? "" : "s"} as context`, value: "__done" },
        ...files.map((f) => ({ label: `${chosen.has(f.path) ? "☑" : "☐"} ${f.rel}`, value: f.path })),
      ],
      { title: "Copy files for an AI chat (path + fenced content)", placeholder: "Toggle files, then pick the first row" },
    );
    if (!pick) return;
    if (pick === "__done") break;
    if (chosen.has(pick)) chosen.delete(pick);
    else chosen.add(pick);
  }
  const parts: string[] = [];
  for (const p of chosen) {
    const text = await readText(p);
    if (text === null) continue;
    const rel = p.replace(/\\/g, "/").slice(root.replace(/\\/g, "/").length + 1);
    const ext = /\.([^.]+)$/.exec(p)?.[1] ?? "";
    const fence = text.includes("```") ? "````" : "```";
    parts.push(`### ${rel}\n\n${fence}${ext}\n${text.replace(/\s+$/, "")}\n${fence}`);
  }
  const out = parts.join("\n\n") + "\n";
  await writeTerminalClipboard(out);
  toast.success(`Copied ${parts.length} file(s)`, { description: `≈${estimateTokens(out).toLocaleString()} tokens` });
}

export async function tokenEstimate(): Promise<void> {
  const ed = getActiveEditor();
  const rows: { label: string; value: string }[] = [];
  if (ed) {
    const sel = ed.view.state.selection.main;
    if (!sel.empty) rows.push({ label: "Selection", value: String(estimateTokens(ed.view.state.sliceDoc(sel.from, sel.to))) });
    rows.push({ label: "This file", value: String(estimateTokens(ed.view.state.doc.toString())) });
  }
  const root = app().workspaceRoot();
  if (root) {
    const stats = await invoke<{ bytes: number; files: number }>("fs_workspace_stats", { root, top: 1, workspace: currentWorkspaceEnv() }).catch(() => null);
    if (stats) rows.push({ label: `Whole workspace (${stats.files} files, rough)`, value: String(Math.ceil(stats.bytes / 3.6)) });
  }
  if (!rows.length) return void toast.info("Open a file or folder first");
  await quickPick(rows.map((r) => ({ label: `≈${Number(r.value).toLocaleString()} tokens`, description: r.label, value: r.value })), {
    title: "Token estimate (≈4 characters per token)",
    placeholder: "Context windows: 200k tokens is roughly 800 KB of code",
  });
}

// ── security / integrity ──────────────────────────────────────────────────

export async function scanWorkspaceSecrets(): Promise<void> {
  const root = requireRoot();
  if (!root) return;
  const pattern = String.raw`(-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-ant-[A-Za-z0-9_-]{20,}|sk-(proj-|svcacct-)?[A-Za-z0-9_-]{32,}|(AKIA|ASIA)[0-9A-Z]{16}|gh[opsur]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,}|glpat-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|xox[bpsare]-[A-Za-z0-9-]{10,}|(sk|rk)_live_[A-Za-z0-9]{24,}|npm_[A-Za-z0-9]{36}|hf_[A-Za-z0-9]{34,}|(postgres(ql)?|mysql|mongodb(\+srv)?|redis|amqps?)://[^\s:/@]+:[^\s@/]{6,}@|(secret|password|passwd|api_?key|token)\s*[:=]\s*["'][^"'\s]{12,}["'])`;
  const t = toast.loading("Scanning for secrets…");
  const res = await native.grep({ pattern, root, caseInsensitive: true, maxResults: 500 }).catch(() => null);
  toast.dismiss(t);
  const hits = (res?.hits ?? []).flatMap((h) => {
    const found = scanForSecrets(h.text);
    return found.length ? found.map((f) => ({ h, label: f.label, preview: f.preview })) : [{ h, label: "possible secret", preview: h.text.trim().slice(0, 60) }];
  });
  if (!hits.length) return void toast.success("No secrets found in tracked-looking files", { description: ".gitignored files are skipped." });
  const pick = await quickPick(
    hits.map((x) => ({ label: `${x.label}: ${x.preview}`, description: `${x.h.rel}:${x.h.line}`, value: x.h })),
    { title: `${hits.length} possible secret${hits.length === 1 ? "" : "s"} in the workspace`, placeholder: "Move them to .env (gitignored) or a secret manager, then rotate them" },
  );
  if (pick) app().openFile(pick.path, pick.line);
}

export async function fileChecksum(): Promise<void> {
  const path = getActiveEditor()?.path ?? (await inputBox({ title: "File to hash", placeholder: "/path/to/download.zip" }));
  if (!path) return;
  const r = await invoke<{ data: string; size: number; truncated: boolean }>("fs_read_bytes", { path, maxBytes: null, workspace: currentWorkspaceEnv() }).catch((e) => {
    toast.error("Could not read the file", { description: String(e) });
    return null;
  });
  if (!r) return;
  if (r.truncated) return void toast.error("File is larger than 64 MB");
  const bytes = base64ToBytes(r.data);
  const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
  const sums = [
    { label: "SHA-256", value: hex(await crypto.subtle.digest("SHA-256", bytes)) },
    { label: "SHA-512", value: hex(await crypto.subtle.digest("SHA-512", bytes)) },
    { label: "SHA-1", value: hex(await crypto.subtle.digest("SHA-1", bytes)) },
    { label: "MD5", value: md5(bytes) },
  ];
  const expected = await inputBox({ title: `${path.split(/[\\/]/).pop()} (${r.size.toLocaleString()} bytes) — paste the expected checksum to verify, or leave empty`, placeholder: "e.g. from the download page" });
  if (expected === undefined) return;
  if (expected.trim()) {
    const want = expected.trim().toLowerCase().replace(/^sha\d+:/, "");
    const match = sums.find((s) => s.value === want);
    return void (match ? toast.success(`✓ ${match.label} matches`) : toast.error("✗ No checksum matches", { description: "The file may be corrupted or tampered with." }));
  }
  const pick = await quickPick(sums.map((s) => ({ label: s.value, description: s.label, value: s.value })), { title: "Checksums", placeholder: "Pick one to copy" });
  if (pick) await copy(pick, "checksum");
}

export async function openRecentFile(): Promise<void> {
  const list = recentFiles();
  const root = app().workspaceRoot()?.replace(/\\/g, "/");
  const pick = await quickPick(
    [
      ...list.map((p) => {
        const n = p.replace(/\\/g, "/");
        return { label: n.split("/").pop()!, description: root && n.startsWith(root) ? n.slice(root.length + 1) : n, value: p };
      }),
      ...(list.length ? [{ label: "Clear recent files", value: "" }] : []),
    ],
    { title: "Open recent file", emptyText: "No recent files yet" },
  );
  if (pick === undefined) return;
  if (pick === "") return forgetRecentFiles();
  app().openFile(pick);
}

export const PROJECT_ACTIONS = [
  { id: "workspace.outdated", label: "Workspace: Outdated dependencies (npm / pnpm / pip)", keywords: ["outdated", "update", "upgrade", "dependencies", "npm", "pip", "versions"], run: outdatedDependencies },
  { id: "workspace.duplicates", label: "Workspace: Find duplicate files", keywords: ["duplicate", "identical", "same content", "dedupe", "space"], run: duplicateFiles },
  { id: "workspace.newFromTemplate", label: "Workspace: New file from template…", keywords: ["template", "boilerplate", "dockerfile", "workflow", "component", "makefile", "editorconfig", "new file"], run: newFileFromTemplate },
  { id: "workspace.readme", label: "Workspace: Generate README", keywords: ["readme", "docs", "generate", "documentation"], run: generateReadme },
  { id: "workspace.changelog", label: "Workspace: Update CHANGELOG from commits", keywords: ["changelog", "release notes", "commits", "conventional"], run: generateChangelog },
  { id: "workspace.bumpVersion", label: "Workspace: Bump version (package.json / Cargo.toml / pyproject)…", keywords: ["version", "bump", "release", "semver", "tag"], run: bumpVersion },
  { id: "workspace.copyTree", label: "Workspace: Copy file tree", keywords: ["tree", "structure", "folders", "ai", "readme", "layout"], run: copyFileTree },
  { id: "workspace.copyContext", label: "Workspace: Copy files as AI context…", keywords: ["ai", "context", "chat", "llm", "prompt", "share", "claude", "copy files"], run: copyFilesAsContext },
  { id: "workspace.tokens", label: "Workspace: Estimate tokens (selection / file / workspace)", keywords: ["tokens", "llm", "context window", "size", "ai"], run: tokenEstimate },
  { id: "workspace.secrets", label: "Workspace: Scan for committed secrets", keywords: ["secrets", "api key", "password", "token", "leak", "security", "credentials"], run: scanWorkspaceSecrets },
  { id: "workspace.checksum", label: "Workspace: File checksum (SHA-256 / SHA-1 / MD5) & verify", keywords: ["checksum", "hash", "sha256", "md5", "verify", "integrity", "download"], run: fileChecksum },
  { id: "workspace.recentFiles", label: "Open recent file…", keywords: ["recent", "mru", "history", "files", "reopen"], run: openRecentFile },
];
