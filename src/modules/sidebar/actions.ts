// Commands for where the sidebar sits, so layout choices are reachable from
// the palette and not only from the activity rail's context menu.

import { setSidebarPosition } from "@/modules/settings/store";
import { usePreferencesStore } from "@/modules/settings/preferences";

export function moveSidebarToOtherSide(): Promise<void> {
  return setSidebarPosition(usePreferencesStore.getState().sidebarPosition === "left" ? "right" : "left");
}

export const SIDEBAR_ACTIONS = [
  { id: "view.sidebarOtherSide", label: "View: Move the sidebar to the other side", keywords: ["sidebar", "left", "right", "layout", "position", "activity bar", "rail"], run: moveSidebarToOtherSide },
];
