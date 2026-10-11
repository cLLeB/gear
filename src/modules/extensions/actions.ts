// Palette commands for the extension host, plus the commands extensions contribute.

import { PuzzleIcon } from "@hugeicons/core-free-icons";
import type { CommandPaletteAction } from "@/modules/command-palette/actions";
import { quickPick } from "@/modules/quick-pick";
import { createExtension, restart, runCommandFromUi, useExtStore, type ExtCommand } from "./store";

function showView(): void {
  window.dispatchEvent(new CustomEvent("gear:show-extensions-panel"));
}

async function reloadOne(): Promise<void> {
  const { installed, enabled } = useExtStore.getState();
  const id = await quickPick(
    installed.filter((x) => x.manifest && enabled[x.manifest.id]).map((x) => ({ label: x.manifest!.name, description: x.manifest!.id, value: x.manifest!.id })),
    { title: "Reload extension" },
  );
  if (id) await restart(id);
}

async function reloadAll(): Promise<void> {
  const { installed, enabled } = useExtStore.getState();
  for (const x of installed) if (x.manifest && enabled[x.manifest.id]) await restart(x.manifest.id);
}

export const EXTENSION_ACTIONS = [
  { id: "extensions.show", label: "Extensions: Show installed extensions", keywords: ["extensions", "plugins", "addons", "install"], run: showView },
  { id: "extensions.create", label: "Extensions: Create a new extension…", keywords: ["extension", "plugin", "scaffold", "new"], run: () => void createExtension() },
  { id: "extensions.reload", label: "Extensions: Reload an extension…", keywords: ["extension", "plugin", "reload", "restart"], run: () => void reloadOne() },
  { id: "extensions.reloadAll", label: "Extensions: Reload all extensions", keywords: ["extension", "plugin", "reload", "restart"], run: () => void reloadAll() },
];

/** Palette entries for the commands enabled extensions contribute. */
export function extensionCommandActions(commands: ExtCommand[]): CommandPaletteAction[] {
  return commands.map((c) => ({
    id: `ext:${c.id}`,
    label: c.title,
    group: "Tools",
    keywords: ["extension", c.extName, c.id],
    icon: PuzzleIcon,
    run: () => runCommandFromUi(c.id),
    deferRun: true,
  }));
}
