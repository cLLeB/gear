import { app } from "@/app/appBridge";
import { confirmPick, inputBox, quickPick } from "@/modules/quick-pick";
import { lastFinishedCommand, submitToLeaf, whenSessionReady } from "@/modules/terminal";
import { leafIds } from "@/modules/terminal/lib/panes";
import { toast } from "sonner";
import { describeLayout, loadLayouts, saveLayouts, templateFromTree, type SavedLayout } from "./lib/layouts";

export async function saveCurrentLayout(): Promise<void> {
  const tab = app().tabs().find((t) => t.id === app().activeTabId());
  if (tab?.kind !== "terminal") {
    toast.error("Focus a terminal tab first");
    return;
  }
  const name = await inputBox({
    title: "Save layout as",
    value: tab.customTitle ?? tab.title,
    validate: (v) => (v.trim() ? null : "Enter a name"),
  });
  if (!name) return;
  const leaves = leafIds(tab.paneTree);
  const lastCommands = leaves.map((l) => lastFinishedCommand(l)?.command ?? "");
  let commands = leaves.map(() => "");
  if (lastCommands.some(Boolean)) {
    const include = await confirmPick(
      "Start each pane with the command it last ran?",
      "Yes, use the last commands as startup commands",
      lastCommands.filter(Boolean).join("  ·  "),
    );
    if (include) commands = lastCommands;
  }
  const list = loadLayouts().filter((l) => l.name !== name.trim());
  list.unshift({ id: `layout-${Date.now()}`, name: name.trim(), tree: templateFromTree(tab.paneTree), commands, createdAt: Date.now() });
  saveLayouts(list);
  toast.success(`Saved layout “${name.trim()}”`, { description: describeLayout(list[0]) });
}

async function pickLayout(title: string): Promise<SavedLayout | undefined> {
  const list = loadLayouts();
  if (list.length === 0) {
    toast.info("No saved layouts yet", { description: "Save one from a terminal tab: Tabs: Save layout…" });
    return undefined;
  }
  return quickPick(
    list.map((l) => ({ label: l.name, description: describeLayout(l), detail: l.commands.filter(Boolean).join("  ·  ") || undefined, value: l })),
    { title },
  );
}

export async function openSavedLayout(): Promise<void> {
  const layout = await pickLayout("Open layout");
  if (!layout) return;
  const leaves = app().openTerminalLayout(layout.tree, layout.name);
  leaves.forEach((leaf, i) => {
    const cmd = layout.commands[i]?.trim();
    if (cmd) void whenSessionReady(leaf).then(() => submitToLeaf(leaf, cmd));
  });
}

export async function deleteSavedLayout(): Promise<void> {
  const layout = await pickLayout("Delete layout");
  if (!layout) return;
  saveLayouts(loadLayouts().filter((l) => l.id !== layout.id));
  toast.success(`Deleted “${layout.name}”`);
}
