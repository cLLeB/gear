// The last suggested correction per pane, so it can be applied from the
// palette after the toast is gone.

import { app } from "@/app/appBridge";
import { toast } from "sonner";
import { isLeafCommandRunning } from "../lib/useTerminalSession";
import { guardedSubmit } from "./guardedSubmit";

const pending = new Map<number, string>();

export function setPendingCorrection(leafId: number, command: string): void {
  pending.set(leafId, command);
}

export function applyPendingCorrection(): void {
  const leaf = app().activeTerminalLeaf();
  const fix = leaf !== null ? pending.get(leaf) : undefined;
  if (leaf === null || !fix) {
    toast.info("No suggested correction for this terminal");
    return;
  }
  if (isLeafCommandRunning(leaf)) {
    toast.error("A command is still running in this terminal");
    return;
  }
  pending.delete(leaf);
  void guardedSubmit(leaf, fix);
}
