// Terminal commands exposed through the command palette. Each one acts on the
// active pane of the active terminal tab (resolved through the app bridge), so
// they work the same from the palette, a shortcut, or another feature.

import { app } from "@/app/appBridge";
import { toast } from "sonner";
import { writeTerminalClipboard } from "../lib/terminalClipboard";
import {
  isLeafCommandRunning,
  lastFinishedCommand,
  navigateFocusedBlocks,
  scrollLeafToPrompt,
} from "../lib/useTerminalSession";
import { guardedSubmit } from "../features/guardedSubmit";

export interface TerminalActionDescriptor {
  id: string;
  label: string;
  keywords: string[];
  run: () => void | Promise<void>;
}

/** Active terminal leaf, or a toast explaining why there is none. */
export function requireTerminalLeaf(): number | null {
  const leaf = app().activeTerminalLeaf();
  if (leaf === null) toast.error("Focus a terminal first");
  return leaf;
}

function requireLastCommand(leafId: number) {
  const last = lastFinishedCommand(leafId);
  if (!last) {
    toast.error("No finished command yet", {
      description: "Gear tracks commands through shell integration (OSC 133).",
    });
  }
  return last;
}

async function copy(text: string, what: string): Promise<void> {
  try {
    await writeTerminalClipboard(text);
    toast.success(`Copied ${what}`, {
      description: text.length > 80 ? `${text.slice(0, 80)}…` : text,
    });
  } catch (e) {
    toast.error("Could not copy", { description: String(e) });
  }
}

/** Jump between prompts; block terminals use their own block navigation. */
export function jumpToPrompt(dir: -1 | 1): boolean {
  const leaf = app().activeTerminalLeaf();
  if (leaf === null) return false;
  if (navigateFocusedBlocks(dir)) return true;
  return scrollLeafToPrompt(leaf, dir);
}

export const TERMINAL_ACTIONS: TerminalActionDescriptor[] = [
  {
    id: "terminal.prevPrompt",
    label: "Terminal: Scroll to previous prompt",
    keywords: ["mark", "jump", "command", "up", "history"],
    run: () => {
      if (requireTerminalLeaf() !== null && !jumpToPrompt(-1)) {
        toast.info("No earlier prompt");
      }
    },
  },
  {
    id: "terminal.nextPrompt",
    label: "Terminal: Scroll to next prompt",
    keywords: ["mark", "jump", "command", "down"],
    run: () => {
      if (requireTerminalLeaf() !== null) jumpToPrompt(1);
    },
  },
  {
    id: "terminal.copyLastCommand",
    label: "Terminal: Copy last command",
    keywords: ["clipboard", "command line", "history"],
    run: async () => {
      const leaf = requireTerminalLeaf();
      if (leaf === null) return;
      const last = requireLastCommand(leaf);
      if (last?.command) await copy(last.command, "command");
    },
  },
  {
    id: "terminal.copyLastOutput",
    label: "Terminal: Copy last command output",
    keywords: ["clipboard", "output", "result", "block"],
    run: async () => {
      const leaf = requireTerminalLeaf();
      if (leaf === null) return;
      const last = requireLastCommand(leaf);
      if (!last) return;
      if (!last.output) {
        toast.info("The last command printed nothing");
        return;
      }
      await copy(last.output, "output");
    },
  },
  {
    id: "terminal.rerunLastCommand",
    label: "Terminal: Rerun last command",
    keywords: ["repeat", "again", "history", "run"],
    run: () => {
      const leaf = requireTerminalLeaf();
      if (leaf === null) return;
      const last = requireLastCommand(leaf);
      if (!last?.command) return;
      if (isLeafCommandRunning(leaf)) {
        toast.error("A command is still running in this terminal");
        return;
      }
      void guardedSubmit(leaf, last.command);
    },
  },
];
