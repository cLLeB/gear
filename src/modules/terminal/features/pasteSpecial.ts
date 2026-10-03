// Clipboard transforms for pasting into a shell.

import { quoteShellArg } from "@/lib/shellQuote";

const nonEmptyLines = (text: string) =>
  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

export const PASTE_TRANSFORMS = {
  oneLine: {
    label: "As one line (spaces)",
    apply: (t: string) => nonEmptyLines(t).join(" "),
  },
  andChain: {
    label: "Lines joined with &&",
    apply: (t: string) => nonEmptyLines(t).filter((l) => !l.startsWith("#")).join(" && "),
  },
  quoted: {
    label: "Shell-quoted (one argument)",
    apply: (t: string, windows = false) => quoteShellArg(t.replace(/\r\n?/g, "\n").replace(/\n+$/, ""), windows),
  },
  quotedArgs: {
    label: "Each line as a quoted argument",
    apply: (t: string, windows = false) => nonEmptyLines(t).map((l) => quoteShellArg(l, windows)).join(" "),
  },
  heredoc: {
    label: "As a heredoc (cat <<'EOF')",
    apply: (t: string) => {
      const body = t.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
      let tag = "EOF";
      while (new RegExp(`^${tag}$`, "m").test(body)) tag += "_";
      return `cat <<'${tag}'\n${body}\n${tag}`;
    },
  },
  trimmed: {
    label: "Trimmed (no surrounding whitespace or trailing newline)",
    apply: (t: string) => t.trim(),
  },
} as const;

export type PasteTransformId = keyof typeof PASTE_TRANSFORMS;

// ------------------------------------------------------------- action

import { app } from "@/app/appBridge";
import { IS_WINDOWS } from "@/lib/platform";
import { quickPick } from "@/modules/quick-pick";
import { toast } from "sonner";
import { guardedPasteIntoLeaf } from "../lib/rendererPool";
import { readTerminalClipboard } from "../lib/terminalClipboard";

export async function pasteSpecial(): Promise<void> {
  const leaf = app().activeTerminalLeaf();
  if (leaf === null) {
    toast.error("Focus a terminal first");
    return;
  }
  const clip = await readTerminalClipboard().catch(() => "");
  if (!clip) {
    toast.info("The clipboard is empty");
    return;
  }
  const id = await quickPick(
    (Object.keys(PASTE_TRANSFORMS) as PasteTransformId[]).map((k) => {
      const preview = PASTE_TRANSFORMS[k].apply(clip, IS_WINDOWS);
      return { label: PASTE_TRANSFORMS[k].label, detail: preview.length > 90 ? `${preview.slice(0, 90)}…` : preview, value: k };
    }),
    { title: "Paste special" },
  );
  if (!id) return;
  if (!guardedPasteIntoLeaf(leaf, PASTE_TRANSFORMS[id].apply(clip, IS_WINDOWS))) toast.error("This terminal is not on screen");
}
