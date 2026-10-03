import { app } from "@/app/appBridge";
import { openExternalUrl } from "@/lib/external-link";
import { quickPick } from "@/modules/quick-pick";
import { toast } from "sonner";
import { readBufferRange } from "../lib/commandMarks";
import { writeTerminalClipboard } from "../lib/terminalClipboard";
import { leafCwd, leafTerminal, writeToSession } from "../lib/useTerminalSession";
import { resolveLinkPath } from "../lib/pathLinks";
import { extractTokens, TOKEN_LABELS, type QuickToken } from "./quickSelect";

const SCAN_LINES = 400;

type Choice = "copy" | "insert" | "open" | "preview";

export async function quickSelectInTerminal(): Promise<void> {
  const leaf = app().activeTerminalLeaf();
  const term = leaf !== null ? leafTerminal(leaf) : null;
  if (leaf === null || !term) {
    toast.error("Focus a terminal first");
    return;
  }
  const buf = term.buffer.active;
  const end = buf.length;
  const text = readBufferRange(buf, Math.max(0, end - SCAN_LINES), end);
  const tokens = extractTokens(text);
  if (tokens.length === 0) {
    toast.info("Nothing selectable on screen");
    return;
  }
  const token = await quickPick<QuickToken>(
    tokens.map((t) => ({
      label: t.text,
      description: t.count > 1 ? `×${t.count}` : undefined,
      group: TOKEN_LABELS[t.kind],
      value: t,
    })),
    { title: "Quick select", placeholder: "Pick a URL, path, hash, IP…" },
  );
  if (!token) return;

  const actions: Array<{ label: string; value: Choice }> = [
    { label: "Copy to clipboard", value: "copy" },
    { label: "Insert at prompt", value: "insert" },
  ];
  if (token.kind === "url") {
    actions.push({ label: "Open in browser", value: "open" });
    if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(token.text)) {
      actions.push({ label: "Open in preview tab", value: "preview" });
    }
  }
  if (token.kind === "path") actions.push({ label: "Open in editor", value: "open" });

  const choice = await quickPick(actions, { title: token.text, placeholder: "What to do with it?" });
  if (!choice) return;
  if (choice === "copy") {
    await writeTerminalClipboard(token.text);
    toast.success("Copied", { description: token.text });
  } else if (choice === "insert") {
    writeToSession(leaf, token.text.includes(" ") ? `'${token.text}'` : token.text);
  } else if (choice === "preview") {
    app().openPreview(token.text);
  } else if (token.kind === "url") {
    await openExternalUrl(token.text);
  } else {
    const abs = resolveLinkPath(token.text, leafCwd(leaf), null) ?? token.text;
    app().openFile(abs);
  }
}
