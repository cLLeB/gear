// gear-licenses://: the license of every dependency (npm / pnpm and Cargo),
// grouped from permissive to copyleft, with what each one means for this
// project, and a THIRD-PARTY-NOTICES file with the license texts.

import { invoke } from "@tauri-apps/api/core";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { toolPaneHandle } from "@/modules/tools/paneHandle";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { assess, CATEGORY_LABEL, licenseFromPackageJson, noticesText, parseCargoMetadata, parsePackageLock, parsePnpmLock, pnpmDir, RANK, summarize, toCsv, type Assessed, type Category, type Distribution, type Package } from "./model";

export const LICENSES_PATH = "gear-licenses://Licenses";
const KEY = "gear.licenses";

export function openLicenses(): void {
  app().openFile(LICENSES_PATH);
}

const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";
const CAT_STYLE: Record<Category, string> = {
  "public-domain": "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  permissive: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  "weak-copyleft": "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  "strong-copyleft": "bg-red-500/15 text-red-600",
  "network-copyleft": "bg-red-600 text-white",
  proprietary: "bg-purple-500/15 text-purple-600",
  unknown: "bg-muted text-foreground",
};
const PROJECT_LICENSES = ["MIT", "Apache-2.0", "BSD-3-Clause", "ISC", "MPL-2.0", "LGPL-3.0-only", "GPL-2.0-only", "GPL-3.0-only", "AGPL-3.0-only", "UNLICENSED"];

const join = (a: string, b: string) => `${a.replace(/[\\/]+$/, "")}/${b.replace(/^[\\/]+/, "")}`;
const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, "");

async function readText(path: string): Promise<string | null> {
  const r = await native.readFile(path).catch(() => null);
  return r && r.kind === "text" ? r.content : null;
}

interface Saved {
  project: string;
  distribution: Distribution;
}

function loadSaved(): Saved | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return v && typeof v.project === "string" ? v : null;
  } catch {
    return null;
  }
}

/** The project's own license, from its manifests or LICENSE file. */
async function detectProjectLicense(root: string): Promise<string> {
  const pkg = await readText(join(root, "package.json"));
  if (pkg) {
    try {
      const l = licenseFromPackageJson(JSON.parse(pkg));
      if (l) return l;
    } catch {
      // Not readable; try the others.
    }
  }
  for (const toml of ["Cargo.toml", "src-tauri/Cargo.toml"]) {
    const t = await readText(join(root, toml));
    const m = t && /^\s*license\s*=\s*"([^"]+)"/m.exec(t);
    if (m) return m[1];
  }
  const lic = (await readText(join(root, "LICENSE"))) ?? (await readText(join(root, "LICENSE.md"))) ?? "";
  if (/Apache License\s+Version 2\.0/i.test(lic)) return "Apache-2.0";
  if (/Permission is hereby granted, free of charge/i.test(lic)) return "MIT";
  if (/GNU AFFERO GENERAL PUBLIC LICENSE/i.test(lic)) return "AGPL-3.0-only";
  if (/GNU GENERAL PUBLIC LICENSE\s+Version 3/i.test(lic)) return "GPL-3.0-only";
  if (/GNU GENERAL PUBLIC LICENSE\s+Version 2/i.test(lic)) return "GPL-2.0-only";
  if (/Mozilla Public License Version 2\.0/i.test(lic)) return "MPL-2.0";
  return "MIT";
}

type Filter = "concerns" | "all" | Category;

export const LicensePane = forwardRef<EditorPaneHandle, { path: string }>(function LicensePane({ path }, ref) {
  const [packages, setPackages] = useState<Package[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [scanned, setScanned] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(loadSaved);
  const [filter, setFilter] = useState<Filter>("concerns");
  const [query, setQuery] = useState("");
  const [includeDev, setIncludeDev] = useState(false);

  const save = (s: Saved) => {
    setSaved(s);
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      // Not remembered, then.
    }
  };

  const scan = useCallback(async () => {
    const root = app().workspaceRoot();
    if (!root) return void setNotes(["Open a folder first."]);
    setBusy(true);
    const found: Package[] = [];
    const msgs: string[] = [];
    try {
      if (!loadSaved()) save({ project: await detectProjectLicense(root), distribution: "app" });
      setProgress("Finding projects…");
      const listed = await invoke<{ files: string[] }>("fs_list_files", { root, limit: 20000, maxDepth: 6, workspace: currentWorkspaceEnv() });
      const lockfiles = listed.files.filter((f) => /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.toml)$/.test(f) && !/(^|\/)(node_modules|target|vendor)\//.test(f));
      for (const rel of lockfiles) {
        const projectDir = join(root, dirOf(rel) === rel ? "" : dirOf(rel));
        const name = rel.split("/").pop();
        if (name === "package-lock.json") {
          const t = await readText(join(root, rel));
          if (t) found.push(...parsePackageLock(t).map((p) => ({ ...p, dir: p.dir ? join(projectDir, p.dir) : undefined })));
        } else if (name === "pnpm-lock.yaml") {
          const t = await readText(join(root, rel));
          if (!t) continue;
          const list = parsePnpmLock(t);
          let missing = 0;
          for (let i = 0; i < list.length; i += 32) {
            setProgress(`Reading npm packages… ${i} / ${list.length}`);
            const batch = await Promise.all(
              list.slice(i, i + 32).map(async (p) => {
                const dir = join(projectDir, pnpmDir(p.name, p.version));
                const j = await readText(join(dir, "package.json"));
                let license = "";
                if (j) {
                  try {
                    license = licenseFromPackageJson(JSON.parse(j));
                  } catch {
                    // Left unknown.
                  }
                } else missing++;
                return { name: p.name, version: p.version, ecosystem: "npm" as const, license, dir, dev: p.dev };
              }),
            );
            found.push(...batch);
          }
          if (missing) msgs.push(`${missing} npm packages in ${rel} are not installed, so their license could not be read (run pnpm install).`);
        } else if (name === "yarn.lock") {
          msgs.push(`${rel}: Yarn projects are not read yet; only package-lock.json and pnpm-lock.yaml are.`);
        } else if (name === "Cargo.toml") {
          // Only the workspace root manifest: members are included in its metadata.
          const t = await readText(join(root, rel));
          if (!t || (/^\s*\[package\]/m.test(t) === false && !/^\s*\[workspace\]/m.test(t))) continue;
          if (lockfiles.some((o) => o !== rel && o.endsWith("Cargo.toml") && rel.startsWith(dirOf(o) + "/"))) continue;
          setProgress(`Reading Cargo metadata for ${rel}…`);
          const out = join(projectDir, ".gear-cargo-metadata.json");
          const r = await native.runCommand(`cargo metadata --format-version 1 --offline --locked > ".gear-cargo-metadata.json"`, projectDir, 120);
          const json = r.exit_code === 0 ? await readText(out) : null;
          await invoke("fs_delete", { path: out, workspace: currentWorkspaceEnv() }).catch(() => {});
          if (!json) msgs.push(`${rel}: cargo metadata failed${r.stderr ? ` — ${r.stderr.trim().split("\n").pop()}` : ""}. Build the project once so its crates are downloaded.`);
          else {
            try {
              found.push(...parseCargoMetadata(json));
            } catch (err) {
              msgs.push(`${rel}: could not read cargo metadata (${String(err)}).`);
            }
          }
        }
      }
      // One row per package and version.
      const seen = new Set<string>();
      setPackages(found.filter((p) => (seen.has(`${p.ecosystem}:${p.name}@${p.version}`) ? false : (seen.add(`${p.ecosystem}:${p.name}@${p.version}`), true))));
      if (!lockfiles.length) msgs.push("No package-lock.json, pnpm-lock.yaml or Cargo.toml found in this workspace.");
      setNotes(msgs);
    } catch (err) {
      setNotes([String(err)]);
    } finally {
      setBusy(false);
      setProgress("");
      setScanned(true);
    }
  }, []);

  useEffect(() => void scan(), [scan]);
  useImperativeHandle(ref, () => toolPaneHandle(path, { reload: () => (void scan(), true) }), [path, scan]);

  const project = saved?.project ?? "MIT";
  const distribution = saved?.distribution ?? "app";
  const assessed: Assessed[] = useMemo(() => packages.filter((p) => includeDev || !p.dev).map((p) => assess(p, project, distribution)), [packages, project, distribution, includeDev]);
  const summary = summarize(assessed);
  const concerns = assessed.filter((p) => p.concern);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assessed
      .filter((p) => (filter === "concerns" ? p.concern : filter === "all" ? true : p.category === filter))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.license.toLowerCase().includes(q))
      .sort((a, b) => RANK[b.category] - RANK[a.category] || a.name.localeCompare(b.name));
  }, [assessed, filter, query]);

  const writeNotices = async () => {
    const root = app().workspaceRoot();
    if (!root) return;
    setBusy(true);
    const texts = new Map<string, string>();
    try {
      const shipped = assessed.filter((p) => !p.dev && p.dir);
      for (let i = 0; i < shipped.length; i += 24) {
        setProgress(`Collecting license texts… ${i} / ${shipped.length}`);
        await Promise.all(
          shipped.slice(i, i + 24).map(async (p) => {
            const entries = await native.readDir(p.dir as string).catch(() => null);
            const file = (entries as { name: string; kind: string }[] | null)?.find((e) => e.kind === "file" && /^(licen[cs]e|copying|notice)(\b|[-_.])/i.test(e.name));
            if (!file) return;
            const t = await readText(join(p.dir as string, file.name));
            if (t && t.length < 100_000) texts.set(`${p.ecosystem}:${p.name}@${p.version}`, t);
          }),
        );
      }
      const name = root.split(/[\\/]/).filter(Boolean).pop() ?? "this project";
      const target = join(root, "THIRD-PARTY-NOTICES.txt");
      await native.writeFile(target, noticesText(assessed, texts, name), "user");
      toast.success(`Wrote THIRD-PARTY-NOTICES.txt (${texts.size} license texts found)`);
      app().openFile(target);
    } catch (err) {
      toast.error(`Could not write the notices: ${String(err)}`);
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  return (
    <div className="flex h-full flex-col text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-2">
        <span className="text-muted-foreground">This project is</span>
        <select className="rounded border border-border/60 bg-background px-1 py-0.5" data-licenses-project value={PROJECT_LICENSES.includes(project) ? project : "__custom"} onChange={(e) => e.target.value !== "__custom" && save({ project: e.target.value, distribution })}>
          {!PROJECT_LICENSES.includes(project) && <option value="__custom">{project}</option>}
          {PROJECT_LICENSES.map((l) => (
            <option key={l} value={l}>
              {l === "UNLICENSED" ? "Closed source" : l}
            </option>
          ))}
        </select>
        <span className="text-muted-foreground">and ships as</span>
        <select className="rounded border border-border/60 bg-background px-1 py-0.5" data-licenses-distribution value={distribution} onChange={(e) => save({ project, distribution: e.target.value as Distribution })}>
          <option value="app">an app people install</option>
          <option value="library">a library others include</option>
          <option value="service">a web service (not distributed)</option>
        </select>
        <label className="flex items-center gap-1 text-muted-foreground">
          <input type="checkbox" checked={includeDev} onChange={(e) => setIncludeDev(e.target.checked)} />
          dev dependencies
        </label>
        <span className="flex-1" />
        <button type="button" className={btn} disabled={busy} onClick={() => void scan()}>
          {busy ? progress || "Scanning…" : "Rescan"}
        </button>
        <button type="button" className={btn} disabled={busy || !assessed.length} onClick={() => void navigator.clipboard.writeText(toCsv(assessed)).then(() => toast.success("CSV copied"))}>
          Copy CSV
        </button>
        <button type="button" className={btn} data-licenses-notices disabled={busy || !assessed.length} onClick={() => void writeNotices()}>
          Write THIRD-PARTY-NOTICES
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 px-2 py-1.5" data-licenses-summary>
        <button type="button" className={cn(btn, filter === "concerns" && "bg-muted font-medium", concerns.length && "text-amber-600")} onClick={() => setFilter("concerns")}>
          Needs a look: {concerns.length}
        </button>
        <button type="button" className={cn(btn, filter === "all" && "bg-muted font-medium")} onClick={() => setFilter("all")}>
          All: {assessed.length}
        </button>
        {summary.map((s) => (
          <button key={s.category} type="button" data-licenses-category={s.category} className={cn("rounded px-1.5 py-0.5 text-[11.5px]", CAT_STYLE[s.category], filter === s.category && "ring-1 ring-ring")} onClick={() => setFilter(s.category)}>
            {CATEGORY_LABEL[s.category]}: {s.count}
          </button>
        ))}
        <span className="flex-1" />
        <input className="w-48 rounded border border-border/60 bg-background px-2 py-0.5 outline-none focus:border-ring" value={query} placeholder="Filter by name or license" onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {notes.map((n) => (
          <div key={n} className="mx-3 mt-2 rounded bg-amber-500/10 px-2 py-1 text-amber-700 dark:text-amber-400">
            {n}
          </div>
        ))}
        {scanned && !busy && shown.length === 0 && <div className="p-3 text-muted-foreground">{filter === "concerns" ? "Nothing needs a look: every shipped dependency's license fits this project." : "No packages."}</div>}
        <table className="w-full border-collapse">
          <tbody>
            {shown.slice(0, 2000).map((p) => (
              <tr key={`${p.ecosystem}:${p.name}@${p.version}`} className="border-b border-border/30 align-top" data-license-row={p.name}>
                <td className="w-16 px-2 py-1 text-[11px] text-muted-foreground">{p.ecosystem}</td>
                <td className="px-2 py-1">
                  <span className="font-medium">{p.name}</span> <span className="text-muted-foreground">{p.version}</span>
                  {p.dev && <span className="ml-1 text-[11px] text-muted-foreground">dev</span>}
                  {p.concern && <div className="text-[11.5px] text-amber-700 dark:text-amber-400">{p.concern}</div>}
                </td>
                <td className="px-2 py-1 font-mono text-[11.5px]">{p.license || "—"}</td>
                <td className="w-40 px-2 py-1 text-right">
                  <span className={cn("rounded px-1.5 py-0.5 text-[11px]", CAT_STYLE[p.category])}>{CATEGORY_LABEL[p.category]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="p-3 text-[11px] text-muted-foreground">This is guidance, not legal advice. Licenses are read from each package’s own metadata, which can be incomplete.</div>
      </div>
    </div>
  );
});

export const LICENSE_ACTIONS = [
  { id: "licenses.open", label: "Licenses: Audit the licenses of every dependency", keywords: ["license", "licence", "spdx", "gpl", "mit", "apache", "copyleft", "compliance", "third party", "notices", "attribution", "legal"], run: openLicenses },
];
