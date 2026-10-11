import { app } from "@/app/appBridge";
import { currentWorkspaceEnv } from "./env";
import { quickPick } from "@/modules/quick-pick";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { envFilesToLint, lintEnv, type EnvIssue } from "./envLint";

type Entry = { name: string; kind: string };
type ReadResult = { kind: "text"; content: string } | { kind: string };

// .env files are dotfiles, which the AI-facing fs helpers hide on purpose;
// read the directory directly with hidden entries for this explicit action.
async function listRoot(root: string): Promise<string[]> {
  const entries = await invoke<Entry[]>("fs_read_dir", {
    path: root,
    showHidden: true,
    workspace: currentWorkspaceEnv(),
  });
  return entries.filter((e) => e.kind !== "dir").map((e) => e.name);
}

async function read(path: string): Promise<string | null> {
  const res = await invoke<ReadResult>("fs_read_file", { path, workspace: currentWorkspaceEnv() });
  return res.kind === "text" ? (res as { content: string }).content : null;
}

const KIND_GROUP: Record<EnvIssue["kind"], string> = {
  missing: "Missing keys",
  empty: "Empty values",
  undocumented: "Not in the template",
  duplicate: "Duplicates",
  malformed: "Malformed lines",
  "unquoted-space": "Style",
  "lowercase-key": "Style",
};

export async function checkEnvFiles(): Promise<void> {
  const root = app().workspaceRoot();
  if (!root) {
    toast.error("Open a folder first");
    return;
  }
  const base = root.replace(/[\\/]+$/, "");
  const names = await listRoot(root);
  const { files, template } = envFilesToLint(names);
  if (files.length === 0 && !template) {
    toast.info("No .env files in this folder");
    return;
  }
  const tplText = template ? await read(`${base}/${template}`) : null;
  const issues: EnvIssue[] = [];
  if (files.length === 0 && template) {
    issues.push({ kind: "missing", file: ".env", line: null, key: null, message: `No .env file — copy ${template} to get started` });
  }
  for (const f of files) {
    const text = await read(`${base}/${f}`);
    if (text === null) continue;
    // Only the main .env is compared to the template; .env.local etc. override subsets.
    const tpl = f === ".env" && template && tplText !== null ? { file: template, text: tplText } : undefined;
    issues.push(...lintEnv(f, text, tpl));
  }
  if (issues.length === 0) {
    toast.success("Env files look good", {
      description: `${files.join(", ")}${template ? ` match ${template}` : ""}`,
    });
    return;
  }
  const picked = await quickPick(
    issues.map((i) => ({
      label: i.message,
      description: i.line ? `${i.file}:${i.line}` : i.file,
      group: KIND_GROUP[i.kind],
      value: i,
    })),
    { title: `${issues.length} env issue${issues.length === 1 ? "" : "s"}`, placeholder: "Filter issues…" },
  );
  if (!picked) return;
  const target = picked.kind === "missing" && template ? template : picked.file;
  app().openFile(`${base}/${target}`, picked.line ?? undefined);
}
