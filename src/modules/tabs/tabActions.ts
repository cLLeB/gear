import { app } from "@/app/appBridge";
import { compactRelativeTime } from "@/lib/toolkit/compactRelativeTime";
import { quickPick } from "@/modules/quick-pick";
import { toast } from "sonner";
import { closedTabs, type ClosedTab } from "./lib/closedTabs";
import { leafIds } from "@/modules/terminal/lib/panes";

function describe(c: ClosedTab): string {
  switch (c.kind) {
    case "terminal": {
      const panes = leafIds(c.tree).length;
      return panes > 1 ? `terminal · ${panes} panes` : "terminal";
    }
    case "editor":
    case "markdown":
      return c.path;
    case "preview":
      return c.url;
  }
}

export async function pickClosedTab(): Promise<void> {
  const list = closedTabs();
  if (list.length === 0) {
    toast.info("No recently closed tabs");
    return;
  }
  const now = Date.now();
  const index = await quickPick(
    list.map((c, i) => ({
      label: c.kind === "terminal" ? (c.customTitle ?? c.title) : c.title,
      description: compactRelativeTime(c.closedAt, now),
      detail: describe(c),
      value: i,
    })),
    { title: "Reopen closed tab", placeholder: "Search recently closed tabs…" },
  );
  if (index !== undefined) app().reopenClosedTab(index);
}
