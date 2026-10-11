import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { native } from "@/modules/ai/lib/native";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { quickPick } from "@/modules/quick-pick";
import { readTerminalClipboard } from "@/modules/terminal/lib/terminalClipboard";
import { openCompare } from "./CompareDialog";

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

function requireEditor() {
  const ed = getActiveEditor();
  if (!ed) toast.error("Open a file in the editor first");
  return ed;
}

export async function compareWithClipboard(): Promise<void> {
  const ed = requireEditor();
  if (!ed) return;
  const clip = await readTerminalClipboard();
  if (!clip) {
    toast.info("The clipboard has no text");
    return;
  }
  const sel = ed.view.state.selection.main;
  const useSel = !sel.empty;
  const mine = useSel ? ed.view.state.sliceDoc(sel.from, sel.to) : ed.view.state.doc.toString();
  const name = ed.path ? baseName(ed.path) : "untitled";
  openCompare({
    title: `${useSel ? "Selection" : name} ↔ clipboard`,
    originalLabel: useSel ? `selection in ${name}` : name,
    modifiedLabel: "clipboard",
    original: mine,
    modified: clip,
    languageHint: ed.path ?? undefined,
  });
}

export async function compareWithFile(): Promise<void> {
  const ed = requireEditor();
  if (!ed) return;
  const root = app().workspaceRoot();
  if (!root) {
    toast.error("No workspace folder");
    return;
  }
  const files = native.glob({ pattern: "**/*", root, maxResults: 20000 }).then((r) =>
    r.hits.filter((h) => h.path !== ed.path).map((h) => ({ label: baseName(h.rel), description: h.rel, value: h.path })),
  );
  const other = await quickPick(files, { title: "Compare with…", placeholder: "Search files in the workspace" });
  if (!other) return;
  const read = await native.readFile(other).catch(() => null);
  if (read?.kind !== "text") {
    toast.error("That file can't be compared", { description: read?.kind === "binary" ? "It is binary." : "It is too large or unreadable." });
    return;
  }
  const name = ed.path ? baseName(ed.path) : "untitled";
  openCompare({
    title: `${baseName(other)} ↔ ${name}`,
    originalLabel: other,
    modifiedLabel: ed.path ?? name,
    original: read.content,
    modified: ed.view.state.doc.toString(),
    languageHint: ed.path ?? other,
  });
}

export async function compareWithSaved(): Promise<void> {
  const ed = requireEditor();
  if (!ed?.path) return;
  const read = await native.readFile(ed.path).catch(() => null);
  if (read?.kind !== "text") {
    toast.error("The saved file could not be read");
    return;
  }
  openCompare({
    title: `${baseName(ed.path)}: unsaved changes`,
    originalLabel: "on disk",
    modifiedLabel: "in editor",
    original: read.content,
    modified: ed.view.state.doc.toString(),
    languageHint: ed.path,
  });
}

export const COMPARE_ACTIONS = [
  { id: "compare.clipboard", label: "Compare file / selection with clipboard", keywords: ["diff", "compare", "clipboard", "paste", "changes"], run: compareWithClipboard },
  { id: "compare.file", label: "Compare file with another file…", keywords: ["diff", "compare", "file", "two files", "changes"], run: compareWithFile },
  { id: "compare.saved", label: "Compare with saved version (unsaved changes)", keywords: ["diff", "dirty", "unsaved", "disk", "changes", "what changed"], run: compareWithSaved },
];
