// Run git for palette workflows through the sandboxed shell runner, against
// the repository the user is most plausibly working in: the active editor's
// file, else the active terminal's cwd, else the workspace root.

import { app } from "@/app/appBridge";
import { quoteShellArg } from "@/lib/shellQuote";
import { native } from "@/modules/ai/lib/native";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { toast } from "sonner";

export async function currentRepoRoot(): Promise<string | null> {
  const candidates: string[] = [];
  const editorPath = getActiveEditor()?.path;
  const active = app().tabs().find((t) => t.id === app().activeTabId());
  if (active?.kind === "editor" && editorPath) candidates.push(editorPath.replace(/[\\/][^\\/]*$/, ""));
  const cwd = app().activeCwd();
  if (cwd) candidates.push(cwd);
  const root = app().workspaceRoot();
  if (root) candidates.push(root);
  for (const dir of candidates) {
    const repo = await native.gitResolveRepo(dir).catch(() => null);
    if (repo) return repo.repoRoot;
  }
  return null;
}

export async function requireRepo(): Promise<string | null> {
  const root = await currentRepoRoot();
  if (!root) toast.error("Not inside a git repository");
  return root;
}

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export async function git(root: string, args: string[], timeoutSecs = 30): Promise<GitResult> {
  const cmd = ["git", ...args.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : quoteShellArg(a)))].join(" ");
  const out = await native.runCommand(cmd, root, timeoutSecs);
  return { ok: out.exit_code === 0, stdout: out.stdout, stderr: out.stderr };
}

/** Run git and toast its stderr on failure; returns stdout or null. */
export async function gitOrToast(root: string, args: string[], what: string): Promise<string | null> {
  const r = await git(root, args);
  if (!r.ok) {
    toast.error(`${what} failed`, { description: (r.stderr || r.stdout).trim().slice(0, 400) });
    return null;
  }
  return r.stdout;
}
