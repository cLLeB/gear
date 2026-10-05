// Apply part of a file's diff — the lines in a range — to the index or the
// working tree. Shared by the "stage selected lines" palette commands and the
// hunk / line controls in the diff tab.

import { native } from "@/modules/ai/lib/native";
import { invalidateRepoDiffs } from "@/modules/editor/lib/diffCache";
import { filterPatch } from "./extras4";
import { git } from "./gitCli";

export type PartialAction = "stage" | "unstage" | "discard";

/** Fired after the index or working tree changed so panels can refresh. */
export const GIT_CHANGED_EVENT = "gear:git-changed";

export function notifyGitChanged(repoRoot: string): void {
  invalidateRepoDiffs(repoRoot);
  window.dispatchEvent(new CustomEvent(GIT_CHANGED_EVENT, { detail: { repoRoot } }));
}

/**
 * Stage / unstage / discard the changes touching new-side lines [from, to].
 * "stage" and "discard" work on the unstaged diff (index → worktree, where the
 * new side is the working file); "unstage" on the staged diff (HEAD → index,
 * new side is the index). Returns an error message, or null on success.
 */
export async function applyLineRange(repoRoot: string, relPath: string, action: PartialAction, from: number, to: number): Promise<string | null> {
  const diffArgs = action === "unstage" ? ["diff", "--cached", "--no-color", "--no-ext-diff", "-U3", "--", relPath] : ["diff", "--no-color", "--no-ext-diff", "-U3", "--", relPath];
  const d = await git(repoRoot, diffArgs);
  if (!d.ok) return d.stderr.trim() || "git diff failed";
  const patch = filterPatch(d.stdout, from, to);
  if (!patch) return action === "unstage" ? "No staged changes in those lines" : "No unstaged changes in those lines";
  const gp = await git(repoRoot, ["rev-parse", "--git-path", "gear-partial.patch"]);
  const raw = gp.stdout.trim();
  const patchPath = (/^([a-zA-Z]:)?[\\/]/.test(raw) ? raw : `${repoRoot}/${raw}`).replace(/\\/g, "/");
  await native.writeFile(patchPath, patch, "user");
  const args =
    action === "stage"
      ? ["apply", "--cached", "--recount", "--whitespace=nowarn", patchPath]
      : action === "unstage"
        ? ["apply", "--cached", "-R", "--recount", "--whitespace=nowarn", patchPath]
        : ["apply", "-R", "--recount", "--whitespace=nowarn", patchPath];
  const r = await git(repoRoot, args);
  if (!r.ok) return r.stderr.trim().slice(0, 400) || "git apply failed";
  notifyGitChanged(repoRoot);
  return null;
}
