// Secret scanning helpers: the ignore file and the pre-commit hook.

import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { IS_WINDOWS } from "@/lib/platform";
import { native } from "@/modules/ai/lib/native";
import { commandLine } from "@/modules/containers/model";
import { confirmPick } from "@/modules/quick-pick";

export interface Finding {
  rule: string;
  title: string;
  file: string;
  line: number;
  column: number;
  masked: string;
  fingerprint: string;
  commit: string | null;
  author: string | null;
  date: string | null;
  lineText: string;
  inTest: boolean;
}

export const IGNORE_FILE = ".gearsecretsignore";
export const HOOK_MARKER = "Installed by Gear: blocks commits that add likely secrets.";

/** Add a fingerprint or path glob to .gearsecretsignore (with a comment). */
export async function appendIgnore(root: string, entry: string, note: string): Promise<void> {
  const path = `${root}/${IGNORE_FILE}`;
  const r = await native.readFile(path).catch(() => null);
  const text = r?.kind === "text" ? r.content : "# Findings and paths the secret scan should skip (fingerprints or globs).\n";
  if (text.split(/\r?\n/).includes(entry)) return;
  await native.writeFile(path, `${text.replace(/\n?$/, "\n")}# ${note}\n${entry}\n`, "user");
  toast.success("Added to .gearsecretsignore");
}

/** Install (or update) the pre-commit hook; an existing foreign hook is kept and chained. */
export async function installHook(root: string): Promise<void> {
  const r = await native.runCommand(commandLine(["git", "rev-parse", "--git-path", "hooks"], IS_WINDOWS), root, 15);
  if (r.exit_code !== 0) return void toast.error("Not a git repository", { description: r.stderr });
  const rel = r.stdout.trim();
  const hooks = /^([A-Za-z]:|\/)/.test(rel) ? rel.replace(/\\/g, "/") : `${root}/${rel}`;
  const path = `${hooks}/pre-commit`;
  const existing = await native.readFile(path).catch(() => null);
  let script = await invoke<string>("secrets_hook_script");
  if (existing?.kind === "text" && !existing.content.includes(HOOK_MARKER)) {
    if (!(await confirmPick("A pre-commit hook already exists", "Keep it and run Gear's check first", "The current hook moves to pre-commit.local and still runs after the check."))) return;
    await native.writeFile(`${hooks}/pre-commit.local`, existing.content, "user");
    script = script.replace(/\ndone\n$/, `\ndone || exit 1\n[ -x "$(dirname "$0")/pre-commit.local" ] && exec "$(dirname "$0")/pre-commit.local" "$@"\nexit 0\n`);
  }
  await native.createDir(hooks).catch(() => {});
  await native.writeFile(path, script, "user");
  if (!IS_WINDOWS) await native.runCommand(commandLine(["chmod", "+x", path, `${hooks}/pre-commit.local`], false), root, 10).catch(() => {});
  toast.success("Pre-commit hook installed", { description: "Commits that add likely secrets are blocked (git commit --no-verify to override once)." });
}

export function openSecretScan(): void {
  app().openFile("gear-secrets://Secrets");
}
