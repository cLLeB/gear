// Every Gear-initiated command submission (the block input bar, workflows,
// rerun, typo fixes) goes through here so risky commands get a second look.

import { confirmPick } from "@/modules/quick-pick";
import { getFeature } from "@/modules/settings/useFeature";
import { toast } from "sonner";
import { setLeafDraft, submitToLeaf } from "../lib/useTerminalSession";
import { classifyCommand } from "./commandGuard";

/** Submit `text` to `leafId`, confirming first when it looks destructive. */
export async function guardedSubmit(leafId: number, text: string): Promise<boolean> {
  if (getFeature("terminal.commandGuard")) {
    const risk = classifyCommand(text);
    if (risk && (risk.level === "danger" || getFeature("terminal.commandGuardCaution"))) {
      const ok = await confirmPick(
        risk.level === "danger" ? `⚠ ${risk.reason}` : risk.reason,
        "Run it anyway",
        text,
      );
      if (!ok) {
        setLeafDraft(leafId, text);
        toast.info("Command not run", { description: text });
        return false;
      }
    }
  }
  submitToLeaf(leafId, text);
  return true;
}
