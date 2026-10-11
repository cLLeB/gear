// Small finishing tools: colour contrast checker, repository web pages,
// file lock toggle, reveal file / copy terminal directory.

import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { openExternalUrl } from "@/lib/external-link";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { toggleLock } from "@/modules/editor/lib/fileLock";
import { remoteWebUrl } from "@/modules/git-actions/extras2";
import { git, requireRepo } from "@/modules/git-actions/gitCli";
import { inputBox, quickPick } from "@/modules/quick-pick";
import { writeTerminalClipboard } from "@/modules/terminal/lib/terminalClipboard";
import { contrastRatio, mix } from "@/modules/theme/contrast";
import { normalizeColor } from "@/modules/theme/importForeign";

export async function contrastChecker(): Promise<void> {
  const input = await inputBox({ title: "Text colour and background colour", placeholder: "#333333 on #ffffff", value: "#777777 #ffffff" });
  if (!input) return;
  const parts = input.split(/\s+(?:on\s+)?|,/).filter(Boolean);
  const fg = normalizeColor(parts[0]);
  const bg = normalizeColor(parts[1]);
  if (!fg || !bg) return void toast.error("Give two hex colours, e.g. #444 #fafafa");
  const r = contrastRatio(fg, bg);
  const pass = (min: number) => (r >= min ? "✓ pass" : "✗ fail");
  // Suggest the nearest passing text colour by mixing toward black/white.
  let fix: string | null = null;
  if (r < 4.5) {
    const target = contrastRatio("#000000", bg) > contrastRatio("#ffffff", bg) ? "#000000" : "#ffffff";
    for (let t = 0.05; t <= 1; t += 0.05) {
      const c = mix(fg, target, t);
      if (contrastRatio(c, bg) >= 4.5) {
        fix = c;
        break;
      }
    }
  }
  const pick = await quickPick(
    [
      { label: `${r.toFixed(2)} : 1`, description: "contrast ratio", value: r.toFixed(2) },
      { label: `AA normal text (4.5)  ${pass(4.5)}`, value: "" },
      { label: `AA large text / UI (3.0)  ${pass(3)}`, value: "" },
      { label: `AAA normal text (7.0)  ${pass(7)}`, value: "" },
      ...(fix ? [{ label: `Nearest passing text colour: ${fix}`, description: "click to copy", value: fix }] : []),
    ],
    { title: `${fg} on ${bg}` },
  );
  if (pick) {
    await writeTerminalClipboard(pick);
    toast.success("Copied", { description: pick });
  }
}

export async function openRepoPage(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const url = await git(root, ["remote", "get-url", "origin"]);
  const base = url.ok ? remoteWebUrl(url.stdout.trim()) : null;
  if (!base) return void toast.error("No web URL for the origin remote");
  const lab = /gitlab/.test(base);
  const branch = (await git(root, ["branch", "--show-current"])).stdout.trim();
  const page = await quickPick(
    [
      { label: "Repository home", value: base },
      { label: "Issues", value: lab ? `${base}/-/issues` : `${base}/issues` },
      { label: "Pull / merge requests", value: lab ? `${base}/-/merge_requests` : `${base}/pulls` },
      { label: lab ? "Pipelines" : "Actions (CI)", value: lab ? `${base}/-/pipelines` : `${base}/actions` },
      { label: "Releases", value: lab ? `${base}/-/releases` : `${base}/releases` },
      ...(branch ? [{ label: `This branch (${branch})`, value: lab ? `${base}/-/tree/${branch}` : `${base}/tree/${encodeURIComponent(branch)}` }] : []),
      { label: "Issue or PR by number…", value: "__num" },
    ],
    { title: base.replace(/^https:\/\//, "") },
  );
  if (!page) return;
  if (page === "__num") {
    const n = await inputBox({ title: "Issue / PR number", placeholder: "123" });
    if (!n || !/^\d+$/.test(n.replace("#", ""))) return;
    return void openExternalUrl(lab ? `${base}/-/issues/${n.replace("#", "")}` : `${base}/issues/${n.replace("#", "")}`);
  }
  await openExternalUrl(page);
}

export function toggleFileLock(): void {
  const path = getActiveEditor()?.path;
  if (!path) return void toast.error("Open a saved file first");
  const now = toggleLock(path);
  toast.success(now ? "File locked (read-only in Gear)" : "File unlocked", { description: path.split(/[\\/]/).pop() });
}

export async function revealActiveFile(): Promise<void> {
  const path = getActiveEditor()?.path;
  if (!path) return void toast.error("Open a saved file first");
  try {
    await revealItemInDir(path);
  } catch (e) {
    toast.error("Could not open the file manager", { description: String(e) });
  }
}

export async function copyTerminalDirectory(): Promise<void> {
  const cwd = app().activeCwd();
  if (!cwd) return void toast.error("No current directory");
  await writeTerminalClipboard(cwd);
  toast.success("Copied current directory", { description: cwd });
}

export const FINAL_ACTIONS = [
  { id: "tools.contrast", label: "Tools: Colour contrast checker (WCAG)…", keywords: ["contrast", "wcag", "accessibility", "a11y", "colour", "color"], run: contrastChecker },
  { id: "git.openRepoPage", label: "Git: Open repository page (issues, PRs, CI, releases)…", keywords: ["github", "gitlab", "issues", "pull requests", "actions", "releases", "web"], run: openRepoPage },
  { id: "file.toggleLock", label: "File: Toggle lock (read-only in Gear)", keywords: ["lock", "read-only", "protect", "readonly", "freeze"], run: toggleFileLock },
  { id: "file.reveal", label: "File: Reveal in file manager", keywords: ["reveal", "finder", "explorer", "show in folder", "file manager"], run: revealActiveFile },
  { id: "terminal.copyCwd", label: "Terminal: Copy current directory", keywords: ["pwd", "cwd", "path", "directory", "copy"], run: copyTerminalDirectory },
];
