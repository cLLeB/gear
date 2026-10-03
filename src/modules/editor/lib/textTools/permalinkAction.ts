import { openExternalUrl } from "@/lib/external-link";
import { native } from "@/modules/ai/lib/native";
import { toast } from "sonner";
import { getActiveEditor } from "../activeEditor";
import { buildPermalink } from "./permalink";
import { pathReferences } from "./pathRefs";
import { quickPick } from "@/modules/quick-pick";
import { app } from "@/app/appBridge";

async function permalinkForActiveEditor(): Promise<string | null> {
  const active = getActiveEditor();
  if (!active?.path) {
    toast.error("Open a file in the editor first");
    return null;
  }
  const { view, path } = active;
  const dir = path.replace(/[\\/][^\\/]*$/, "");
  const repo = await native.gitResolveRepo(dir).catch(() => null);
  if (!repo) {
    toast.error("This file is not in a git repository");
    return null;
  }
  const remoteUrl = await native.gitRemoteUrl(repo.repoRoot).catch(() => null);
  if (!remoteUrl) {
    toast.error("The repository has no remote");
    return null;
  }
  const head = await native.runCommand("git rev-parse HEAD", repo.repoRoot, 10);
  const sha = head.stdout.trim();
  if (head.exit_code !== 0 || !/^[0-9a-f]{40}$/.test(sha)) {
    toast.error("Could not read the current commit", { description: head.stderr.trim() });
    return null;
  }
  const root = repo.repoRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const rel = path.replace(/\\/g, "/").slice(root.length + 1);
  const sel = view.state.selection.main;
  const startLine = view.state.doc.lineAt(sel.from).number;
  // A selection ending at column 0 of the next line means "through the previous line".
  const endPos = sel.to > sel.from && view.state.doc.lineAt(sel.to).from === sel.to ? sel.to - 1 : sel.to;
  const endLine = view.state.doc.lineAt(endPos).number;
  const url = buildPermalink({ remoteUrl, ref: sha, path: rel, startLine, endLine });
  if (!url) {
    toast.error("Unrecognised remote URL", { description: remoteUrl });
    return null;
  }
  // Links to commits that only exist locally 404 for everyone else.
  const pushed = await native.runCommand("git branch -r --contains HEAD", repo.repoRoot, 10);
  if (pushed.exit_code === 0 && pushed.stdout.trim() === "") {
    toast.warning("HEAD is not pushed yet", { description: "The link will work once this commit is on the remote." });
  }
  return url;
}

export async function copyPermalink(): Promise<void> {
  const url = await permalinkForActiveEditor();
  if (!url) return;
  await navigator.clipboard.writeText(url).catch(() => {});
  toast.success("Permalink copied", { description: url });
}

export async function openPermalink(): Promise<void> {
  const url = await permalinkForActiveEditor();
  if (url) await openExternalUrl(url);
}

export async function copyReference(): Promise<void> {
  const active = getActiveEditor();
  if (!active?.path) {
    toast.error("Open a file in the editor first");
    return;
  }
  const { view, path } = active;
  const sel = view.state.selection.main;
  const line = view.state.doc.lineAt(sel.from);
  const endPos = sel.to > sel.from && view.state.doc.lineAt(sel.to).from === sel.to ? sel.to - 1 : sel.to;
  const refs = pathReferences({
    path,
    root: app().workspaceRoot(),
    line: line.number,
    column: sel.from - line.from + 1,
    endLine: view.state.doc.lineAt(endPos).number,
  });
  const value = await quickPick(
    refs.map((r) => ({ label: r.value, description: r.label, value: r.value })),
    { title: "Copy reference", placeholder: "Pick a format" },
  );
  if (!value) return;
  await navigator.clipboard.writeText(value).catch(() => {});
  toast.success("Copied", { description: value });
}
