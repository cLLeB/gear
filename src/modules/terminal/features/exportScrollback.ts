// Save or copy a pane's scrollback — iTerm2's "Save Contents" and Windows
// Terminal's "Export text", plus a colour-preserving HTML flavour that pastes
// into docs, issues and slides with the terminal's styling intact.

import { app } from "@/app/appBridge";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { quickPick } from "@/modules/quick-pick";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { writeTerminalClipboard } from "../lib/terminalClipboard";
import { leafCwd, serializeLeaf } from "../lib/useTerminalSession";

export function exportFileName(format: "text" | "ansi" | "html", now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const ext = format === "html" ? "html" : format === "ansi" ? "ansi.txt" : "txt";
  return `terminal-${stamp}.${ext}`;
}

/** Wrap xterm's HTML fragment into a standalone, printable document. */
export function wrapHtmlDocument(fragment: string, title: string): string {
  const safeTitle = title.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${safeTitle}</title>
<style>body{margin:0;padding:16px;background:#111}pre{margin:0;white-space:pre-wrap}</style>
</head><body>${fragment}</body></html>
`;
}

function activeLeafOrToast(): number | null {
  const leaf = app().activeTerminalLeaf();
  if (leaf === null) toast.error("Focus a terminal first");
  return leaf;
}

export async function saveScrollback(): Promise<void> {
  const leaf = activeLeafOrToast();
  if (leaf === null) return;
  const format = await quickPick<"text" | "ansi" | "html">(
    [
      { label: "Plain text", description: ".txt", value: "text" },
      { label: "HTML with colours", description: ".html", value: "html" },
      { label: "Raw ANSI", description: "replay with cat", value: "ansi" },
    ],
    { title: "Save scrollback as…" },
  );
  if (!format) return;
  let content = serializeLeaf(leaf, format);
  if (content === null) {
    toast.error("This terminal is not on screen");
    return;
  }
  const name = exportFileName(format);
  if (format === "html") content = wrapHtmlDocument(content, name);
  const dir = leafCwd(leaf) ?? app().workspaceRoot();
  if (!dir) {
    toast.error("No directory to save into");
    return;
  }
  try {
    const path = await invoke<string>("fs_write_new", {
      destDir: dir,
      name,
      content: Array.from(new TextEncoder().encode(content)),
      workspace: currentWorkspaceEnv(),
    });
    toast.success("Scrollback saved", {
      description: path,
      action: format === "html" ? undefined : { label: "Open", onClick: () => app().openFile(path) },
    });
  } catch (e) {
    toast.error("Could not save scrollback", { description: String(e) });
  }
}

export async function copyScrollbackAsHtml(): Promise<void> {
  const leaf = activeLeafOrToast();
  if (leaf === null) return;
  const html = serializeLeaf(leaf, "html");
  const text = serializeLeaf(leaf, "text");
  if (html === null || text === null) {
    toast.error("This terminal is not on screen");
    return;
  }
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      }),
    ]);
    toast.success("Copied scrollback with colours");
  } catch {
    // Some webviews only allow plain text on the clipboard.
    await writeTerminalClipboard(text);
    toast.success("Copied scrollback as plain text", {
      description: "Rich HTML copy is not supported by this platform's webview.",
    });
  }
}
