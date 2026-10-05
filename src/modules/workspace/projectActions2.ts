// Workspace tools, part three: dependency hygiene and licences, env-var
// usage, project scaffolds, workspace-wide Markdown link check, bulk rename,
// go to imported file and find usages.

import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { native } from "@/modules/ai/lib/native";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { extractLinks, headingAnchors } from "@/modules/editor/lib/textTools/prose";
import { inputBox, quickPick } from "@/modules/quick-pick";
import { currentWorkspaceEnv } from "./env";
import { envToJson } from "@/modules/tools/formats";
import { dependencyReport, envVarsUsed, importCandidates, importSpecifiers, licenseRisk, packageOf, planRenames, pythonModuleCandidates } from "./projectTools2";

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

async function sourceFiles(root: string, pattern = "**/*.{ts,tsx,js,jsx,mjs,cjs,vue,svelte}", max = 4000) {
  const r = await native.glob({ pattern, root, maxResults: max }).catch(() => null);
  return r?.hits ?? [];
}

export async function unusedDependencies(): Promise<void> {
  const root = requireRoot();
  if (!root) return;
  const pkgText = await readText(`${root}/package.json`);
  if (!pkgText) return void toast.info("No package.json in the workspace root");
  const pkg = JSON.parse(pkgText) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> };
  const t = toast.loading("Reading imports…");
  const imported = new Set<string>();
  const files = await sourceFiles(root);
  for (const f of files) {
    if (/node_modules|dist\/|build\//.test(f.rel)) continue;
    const src = await readText(f.path);
    if (src) for (const s of importSpecifiers(src)) {
      const p = packageOf(s);
      if (p) imported.add(p);
    }
  }
  for (const cfg of ["vite.config.ts", "vite.config.js", "tailwind.config.js", "tailwind.config.ts", "postcss.config.js", "eslint.config.js", "vitest.config.ts"]) {
    const src = await readText(`${root}/${cfg}`);
    if (src) for (const s of importSpecifiers(src)) {
      const p = packageOf(s);
      if (p) imported.add(p);
    }
  }
  toast.dismiss(t);
  const r = dependencyReport(pkg, imported, Object.values(pkg.scripts ?? {}).join(" ; "));
  await quickPick(
    [
      ...r.unused.map((d) => ({ label: `🗑 ${d}`, description: "declared but never imported", value: d })),
      ...r.missing.map((d) => ({ label: `⚠ ${d}`, description: "imported but not in package.json", value: d })),
      ...r.tooling.map((d) => ({ label: `🔧 ${d}`, description: "build/dev tooling (probably fine)", value: d })),
    ],
    { title: `${r.unused.length} unused · ${r.missing.length} missing · scanned ${files.length} files`, emptyText: "Every dependency is used" },
  );
}

export async function dependencyLicenses(): Promise<void> {
  const root = requireRoot();
  if (!root) return;
  const pkgText = await readText(`${root}/package.json`);
  if (!pkgText) return void toast.info("No package.json in the workspace root");
  const pkg = JSON.parse(pkgText) as { dependencies?: Record<string, string> };
  const rows: { name: string; license: string; risk: ReturnType<typeof licenseRisk> }[] = [];
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    const meta = await readText(`${root}/node_modules/${name}/package.json`);
    let license = "";
    if (meta) {
      const j = JSON.parse(meta) as { license?: string | { type?: string }; licenses?: { type?: string }[] };
      license = typeof j.license === "string" ? j.license : (j.license?.type ?? j.licenses?.map((l) => l.type).join(" OR ") ?? "");
    }
    rows.push({ name, license: license || (meta ? "unknown" : "not installed"), risk: licenseRisk(license) });
  }
  const order = { copyleft: 0, unknown: 1, permissive: 2 };
  rows.sort((a, b) => order[a.risk] - order[b.risk] || a.name.localeCompare(b.name));
  const icon = { copyleft: "🟠", unknown: "⚪", permissive: "🟢" };
  await quickPick(rows.map((r) => ({ label: `${icon[r.risk]} ${r.name}`, description: r.license, value: r.name })), {
    title: `Licences of ${rows.length} runtime dependencies (${rows.filter((r) => r.risk === "copyleft").length} copyleft)`,
    placeholder: "Not legal advice — check the licence texts for anything you ship",
  });
}

export async function envVarUsage(): Promise<void> {
  const root = requireRoot();
  if (!root) return;
  const t = toast.loading("Scanning code for environment variables…");
  const files = await sourceFiles(root, "**/*.{ts,tsx,js,jsx,mjs,cjs,py,rs,go,rb,java,kt,cs,svelte,vue}");
  const where = new Map<string, string[]>();
  for (const f of files) {
    const src = await readText(f.path);
    if (!src) continue;
    for (const v of envVarsUsed(src)) where.set(v, [...(where.get(v) ?? []), f.rel]);
  }
  toast.dismiss(t);
  const example = (await readText(`${root}/.env.example`)) ?? (await readText(`${root}/.env.sample`)) ?? "";
  const documented = new Set(Object.keys(envToJson(example)));
  const rows = [...where.entries()].sort(([a], [b]) => a.localeCompare(b));
  const undocumented = rows.filter(([k]) => !documented.has(k));
  const unused = [...documented].filter((k) => !where.has(k));
  const pick = await quickPick(
    [
      ...(undocumented.length && example ? [{ label: `Add ${undocumented.length} missing name(s) to .env.example`, value: "__add" }] : []),
      ...rows.map(([k, files]) => ({ label: `${documented.has(k) ? "✓" : "✗"} ${k}`, description: `${files.length} file(s): ${[...new Set(files)].slice(0, 3).join(", ")}`, value: k })),
      ...unused.map((k) => ({ label: `◌ ${k}`, description: "in .env.example but not read by code", value: k })),
    ],
    { title: `${rows.length} variables used · ${undocumented.length} undocumented · ${unused.length} unused`, emptyText: "No environment variables found in code" },
  );
  if (pick === "__add") {
    const next = `${example.replace(/\s*$/, "")}\n\n# Added by Gear (used in code)\n${undocumented.map(([k]) => `${k}=`).join("\n")}\n`;
    await native.writeFile(`${root}/.env.example`, next, "user");
    toast.success(`Added ${undocumented.length} variable(s) to .env.example`);
  }
}

const SCAFFOLDS = [
  { label: "Vite (React + TypeScript)", cmd: (n: string) => `npm create vite@latest ${n} -- --template react-ts` },
  { label: "Vite (vanilla TypeScript)", cmd: (n: string) => `npm create vite@latest ${n} -- --template vanilla-ts` },
  { label: "Next.js", cmd: (n: string) => `npx create-next-app@latest ${n}` },
  { label: "Astro", cmd: (n: string) => `npm create astro@latest ${n}` },
  { label: "SvelteKit", cmd: (n: string) => `npx sv create ${n}` },
  { label: "Tauri app", cmd: (n: string) => `npm create tauri-app@latest ${n}` },
  { label: "Rust binary (cargo)", cmd: (n: string) => `cargo new ${n}` },
  { label: "Rust library (cargo)", cmd: (n: string) => `cargo new --lib ${n}` },
  { label: "Python project (uv)", cmd: (n: string) => `uv init ${n}` },
  { label: "Go module", cmd: (n: string) => `mkdir ${n} && cd ${n} && go mod init ${n}` },
  { label: ".NET console app", cmd: (n: string) => `dotnet new console -o ${n}` },
  { label: "Node package (npm init)", cmd: (n: string) => `mkdir ${n} && cd ${n} && npm init -y` },
];

export async function newProject(): Promise<void> {
  const root = app().workspaceRoot();
  const s = await quickPick(SCAFFOLDS.map((x) => ({ label: x.label, value: x })), { title: "New project", placeholder: "Runs the official generator in a new terminal" });
  if (!s) return;
  const name = await inputBox({ title: "Project name", value: "my-app", validate: (v) => (/^[\w.-]+$/.test(v) ? null : "Letters, digits, . _ - only") });
  if (!name) return;
  const parent = await inputBox({ title: "Create inside", value: root ?? "" });
  if (parent === undefined) return;
  app().openTerminal({ cwd: parent || root, command: s.cmd(name) });
}

export async function checkAllMarkdownLinks(): Promise<void> {
  const root = requireRoot();
  if (!root) return;
  const t = toast.loading("Checking Markdown links…");
  const files = await sourceFiles(root, "**/*.{md,markdown,mdx}", 2000);
  const broken: { file: string; path: string; line: number; target: string; why: string }[] = [];
  const anchors = new Map<string, Set<string>>();
  const anchorsOf = async (p: string) => {
    if (!anchors.has(p)) anchors.set(p, headingAnchors((await readText(p)) ?? ""));
    return anchors.get(p)!;
  };
  let checked = 0;
  for (const f of files) {
    const text = await readText(f.path);
    if (!text) continue;
    const dir = f.path.replace(/[\\/][^\\/]*$/, "");
    for (const l of extractLinks(text)) {
      if (/^(https?|mailto|ftp|tel|data):/i.test(l.target)) continue;
      checked++;
      const [file, anchor] = l.target.split("#");
      const abs = !file ? f.path : file.startsWith("/") ? `${root}${file}` : `${dir}/${decodeURIComponent(file)}`;
      if (file && !(await exists(abs))) {
        broken.push({ file: f.rel, path: f.path, line: l.line, target: l.target, why: "missing file" });
        continue;
      }
      if (anchor && /\.(md|markdown|mdx)$/i.test(abs) && !(await anchorsOf(abs)).has(decodeURIComponent(anchor).toLowerCase())) {
        broken.push({ file: f.rel, path: f.path, line: l.line, target: l.target, why: "missing heading" });
      }
    }
  }
  toast.dismiss(t);
  if (!broken.length) return void toast.success(`All ${checked} local links in ${files.length} Markdown files resolve`);
  const pick = await quickPick(broken.map((b) => ({ label: b.target, description: `${b.file}:${b.line} · ${b.why}`, value: b })), { title: `${broken.length} broken link(s) in ${files.length} files` });
  if (pick) app().openFile(pick.path, pick.line);
}

export async function bulkRename(): Promise<void> {
  const root = requireRoot();
  if (!root) return;
  const pattern = await inputBox({ title: "Which files?", placeholder: "glob, e.g. assets/**/*.PNG", value: "**/*" });
  if (!pattern) return;
  const find = await inputBox({ title: "Find in file names (regex)", placeholder: "e.g. ^IMG_(\\d+)  or  \\.PNG$" });
  if (!find) return;
  const replace = await inputBox({ title: "Replace with ($1 for groups)", placeholder: "photo-$1" });
  if (replace === undefined) return;
  let re: RegExp;
  try {
    re = new RegExp(find);
  } catch (e) {
    return void toast.error("Invalid regex", { description: String(e) });
  }
  const files = await sourceFiles(root, pattern, 5000);
  const { plans, conflicts } = planRenames(files.map((f) => f.path.replace(/\\/g, "/")), re, replace);
  if (!plans.length) return void toast.info("No file names match");
  if (conflicts.length) return void toast.error(`${conflicts.length} rename(s) would collide`, { description: conflicts.slice(0, 3).join("; ") });
  const pick = await quickPick(
    [
      { label: `Rename ${plans.length} file(s)`, value: "__go" },
      ...plans.map((p) => ({ label: `${p.from.split("/").pop()} → ${p.to.split("/").pop()}`, description: p.from.slice(root.length + 1), value: "" })),
    ],
    { title: "Preview" },
  );
  if (pick !== "__go") return;
  let ok = 0;
  for (const p of plans) {
    try {
      await invoke("fs_rename", { from: p.from, to: p.to, workspace: currentWorkspaceEnv() });
      ok++;
    } catch {
      /* counted below */
    }
  }
  toast.success(`Renamed ${ok} of ${plans.length} file(s)`);
}

export async function goToImportedFile(): Promise<void> {
  const ed = getActiveEditor();
  if (!ed?.path) return void toast.error("Open a file first");
  const root = app().workspaceRoot() ?? "";
  const line = ed.view.state.doc.lineAt(ed.view.state.selection.main.head).text;
  const js = /(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s+)['"]([^'"]+)['"]/.exec(line);
  const py = /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/.exec(line);
  const css = /@import\s+(?:url\()?['"]([^'"]+)['"]/.exec(line);
  const candidates = js
    ? importCandidates(ed.path, js[1], root)
    : css
      ? importCandidates(ed.path, css[1].startsWith(".") ? css[1] : `./${css[1]}`, root)
      : py
        ? (py[1] ?? py[2]).startsWith(".")
          ? importCandidates(ed.path, `./${(py[1] ?? py[2]).replace(/^\.+/, "").replace(/\./g, "/")}`, root).map((c) => c.replace(/\.ts$/, ".py"))
          : pythonModuleCandidates(root, py[1] ?? py[2])
        : [];
  if (!candidates.length) return void toast.info(js ? `“${js[1]}” is a package, not a project file` : "Put the cursor on an import line");
  for (const c of candidates) {
    const st = await invoke<{ kind: string }>("fs_stat", { path: c, workspace: currentWorkspaceEnv() }).catch(() => null);
    if (st?.kind === "file") return app().openFile(c);
  }
  toast.error("Couldn't find the imported file", { description: candidates[0] });
}

export async function findUsages(): Promise<void> {
  const root = requireRoot();
  if (!root) return;
  const ed = getActiveEditor();
  let word = "";
  if (ed) {
    const sel = ed.view.state.selection.main;
    const w = sel.empty ? ed.view.state.wordAt(sel.head) : sel;
    if (w) word = ed.view.state.sliceDoc(w.from, w.to).trim();
  }
  word = (await inputBox({ title: "Find usages of", value: word })) ?? "";
  if (!word.trim()) return;
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const res = await native.grep({ pattern: /^\w+$/.test(word) ? `\\b${esc}\\b` : esc, root, maxResults: 1000 }).catch(() => null);
  const hits = res?.hits ?? [];
  const pick = await quickPick(
    hits.map((h) => ({ label: h.text.trim().slice(0, 160), description: `${h.rel}:${h.line}`, value: h })),
    { title: `${hits.length}${res?.truncated ? "+" : ""} usage(s) of ${word}`, emptyText: "No usages found" },
  );
  if (pick) app().openFile(pick.path, pick.line);
}

export const PROJECT_ACTIONS_2 = [
  { id: "workspace.unusedDeps", label: "Workspace: Unused / missing npm dependencies", keywords: ["unused", "dependencies", "depcheck", "knip", "package.json", "missing"], run: unusedDependencies },
  { id: "workspace.licenses", label: "Workspace: Dependency licences (copyleft check)", keywords: ["license", "licence", "gpl", "compliance", "legal", "dependencies"], run: dependencyLicenses },
  { id: "workspace.envUsage", label: "Workspace: Environment variables used in code vs .env.example", keywords: ["env", "environment", "dotenv", "process.env", "config", "undocumented"], run: envVarUsage },
  { id: "workspace.newProject", label: "Workspace: New project (Vite, Next.js, cargo, uv, Go, .NET…)…", keywords: ["new project", "scaffold", "create", "template", "starter", "init"], run: newProject },
  { id: "workspace.mdLinks", label: "Workspace: Check links in all Markdown files", keywords: ["markdown", "links", "broken", "docs", "anchors", "readme"], run: checkAllMarkdownLinks },
  { id: "workspace.bulkRename", label: "Workspace: Bulk rename files (regex)…", keywords: ["rename", "bulk", "batch", "regex", "files", "mass rename"], run: bulkRename },
  { id: "workspace.gotoImport", label: "Go to imported file (import on this line)", keywords: ["import", "go to file", "gf", "open module", "require", "definition"], run: goToImportedFile },
  { id: "workspace.findUsages", label: "Find usages in workspace (word under cursor)", keywords: ["usages", "references", "find all", "grep", "where used", "callers"], run: findUsages },
];
