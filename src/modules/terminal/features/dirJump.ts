// Records directories shells visit and offers a frecency-ranked "jump to
// directory" picker — zoxide's `zi`, built into the terminal.

import { app } from "@/app/appBridge";
import { quoteShellArg } from "@/lib/shellQuote";
import { compactRelativeTime } from "@/lib/toolkit/compactRelativeTime";
import { quickPick } from "@/modules/quick-pick";
import { toast } from "sonner";
import {
  isLeafCommandRunning,
  onTerminalCwd,
  submitToLeaf,
} from "../lib/useTerminalSession";
import { loadDirDb, rankDirs, recordVisit, saveDirDb, type DirEntry } from "./frecency";

let db: DirEntry[] | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function getDb(): DirEntry[] {
  if (!db) db = loadDirDb();
  return db;
}

export function installDirTracking(): () => void {
  return onTerminalCwd((_leaf, cwd, isPrivate) => {
    if (isPrivate) return; // private terminals leave no trace
    db = recordVisit(getDb(), cwd, Date.now());
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveDirDb(getDb()), 1000);
  });
}

export async function jumpToDirectory(): Promise<void> {
  const now = Date.now();
  const ranked = rankDirs(getDb(), now);
  if (ranked.length === 0) {
    toast.info("No directories visited yet", {
      description: "Directories are learned as you cd around in terminals with shell integration.",
    });
    return;
  }
  const dir = await quickPick(
    ranked.slice(0, 200).map((e) => ({
      label: e.path.replace(/^.*[\\/](?=[^\\/]+$)/, ""),
      description: e.path,
      detail: `${Math.round(e.rank)} visit${Math.round(e.rank) === 1 ? "" : "s"} · ${compactRelativeTime(e.last, now)}`,
      keywords: [e.path],
      value: e.path,
    })),
    { title: "Jump to directory", placeholder: "Type part of a path…" },
  );
  if (!dir) return;
  const leaf = app().activeTerminalLeaf();
  if (leaf !== null && !isLeafCommandRunning(leaf)) {
    submitToLeaf(leaf, `cd ${quoteShellArg(dir)}`);
  } else {
    app().openTerminal({ cwd: dir });
  }
}

export function forgetDirectoryHistory(): void {
  db = [];
  saveDirDb(db);
  toast.success("Directory history cleared");
}
