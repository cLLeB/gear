// Palette entry points for the merge editor: the conflicted-files list with
// continue / skip / abort for the operation in progress, and "open the merge
// editor for this file" (also raised by the inline conflict lens).

import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { native } from "@/modules/ai/lib/native";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { git, requireRepo } from "@/modules/git-actions/gitCli";
import { confirmPick, quickPick } from "@/modules/quick-pick";
import { openMergeEditor } from "./MergeEditorDialog";
import { operationFrom } from "./mergeModel";

export function mergeEditorForActiveFile(): void {
  const path = getActiveEditor()?.path;
  if (!path) return void toast.info("Open the conflicted file first");
  void openMergeEditor(path);
}

window.addEventListener("gear:open-merge-editor", mergeEditorForActiveFile);

export async function resolveConflicts(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const gd = (await git(root, ["rev-parse", "--absolute-git-dir"])).stdout.trim();
  const op = operationFrom(new Set((await native.readDir(gd).catch(() => [])).map((e) => e.name)));
  const files = (await git(root, ["diff", "--name-only", "--diff-filter=U"])).stdout.split("\n").filter(Boolean);
  // Two-letter status shows who changed what: UU both modified, AA both added, DU deleted by us…
  const status = new Map(
    (await git(root, ["status", "--porcelain=v1"])).stdout
      .split("\n")
      .filter((l) => /^(UU|AA|DU|UD|AU|UA|DD) /.test(l))
      .map((l) => [l.slice(3), l.slice(0, 2)] as const),
  );
  const why: Record<string, string> = { UU: "both modified", AA: "both added", DU: "deleted by us", UD: "deleted by them", AU: "added by us", UA: "added by them", DD: "both deleted" };
  if (!files.length && !op) return void toast.success("No merge conflicts");
  const items: { label: string; description?: string; value: string }[] = files.map((f) => ({ label: `⚠ ${f}`, description: why[status.get(f) ?? ""] ?? "conflicted", value: `file:${f}` }));
  if (op) {
    if (!files.length) items.push({ label: `▶ Continue ${op}`, description: "all conflicts resolved", value: "continue" });
    if (op === "rebase" || op === "cherry-pick") items.push({ label: `⏭ Skip this commit`, value: "skip" });
    items.push({ label: `✖ Abort ${op}`, description: "back to how things were before", value: "abort" });
  }
  const pick = await quickPick(items, { title: op ? `${op} in progress — ${files.length} conflicted file(s)` : `${files.length} conflicted file(s)` });
  if (!pick) return;
  if (pick.startsWith("file:")) {
    const rel = pick.slice(5);
    const code = status.get(rel) ?? "";
    if (/^(DU|UD)$/.test(code)) {
      const keep = await quickPick(
        [
          { label: "Keep the file (modified version)", value: "keep" },
          { label: "Delete the file", value: "delete" },
        ],
        { title: `${rel} was ${why[code]}` },
      );
      if (!keep) return;
      const r = keep === "keep" ? await git(root, ["add", "--", rel]) : await git(root, ["rm", "--", rel]);
      if (!r.ok) return void toast.error(r.stderr.trim());
      return void toast.success(keep === "keep" ? `Kept ${rel}` : `Deleted ${rel}`);
    }
    return void openMergeEditor(`${root}/${rel}`);
  }
  if (pick === "abort" && !(await confirmPick(`Abort the ${op}? Your resolutions so far are discarded.`, "Abort"))) return;
  app().openTerminal({ cwd: root, command: `git -c core.editor=true ${op} --${pick}` });
}

export const MERGE_ACTIONS = [
  { id: "git.resolveConflicts", label: "Git: Resolve merge conflicts…", keywords: ["merge", "conflict", "resolve", "rebase", "continue", "abort", "3-way", "mergetool"], run: resolveConflicts },
  { id: "git.mergeEditor", label: "Git: Open merge editor for this file", keywords: ["merge editor", "conflict", "3-way", "ours", "theirs", "resolve"], run: mergeEditorForActiveFile },
];
