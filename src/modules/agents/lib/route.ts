import { usePreferencesStore } from "@/modules/settings/preferences";
import { info } from "@tauri-apps/plugin-log";
import { showAgentToast } from "../components/AgentToast";
import { useAgentStore } from "../store/agentStore";
import { resolveAgentNotificationDelivery } from "./delivery";
import { createAgentNotificationGate } from "./notificationGate";
import { osNotify } from "./notify";
import { playAgentNotificationSound } from "./sound";
import type { AgentSource, NotificationKind } from "./types";

const shouldDeliver = createAgentNotificationGate();

type RouteArgs = {
  source: AgentSource;
  agent: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  focused: boolean;
  /** True when the user is currently looking at this agent. */
  visible: boolean;
  /** Allow an in-app toast when focused but not looking at the agent. */
  allowToast: boolean;
  tabId?: number;
  leafId?: number;
  onActivate: () => void;
};

export function routeAgentNotification({
  source,
  agent,
  kind,
  title,
  body,
  focused,
  visible,
  allowToast,
  tabId = 0,
  leafId = 0,
  onActivate,
}: RouteArgs): void {
  const preferences = usePreferencesStore.getState();
  if (!preferences.agentNotifications) {
    void info(`[route] ${agent}/${kind} dropped: agentNotifications disabled`);
    return;
  }
  const delivery = resolveAgentNotificationDelivery({
    focused,
    visible,
    allowToast,
  });
  if (delivery === "none") {
    void info(`[route] ${agent}/${kind} dropped: window focused and agent visible`);
    return;
  }
  if (!shouldDeliver({ source, agent, kind, tabId, leafId })) {
    void info(`[route] ${agent}/${kind} dropped: duplicate within cooldown`);
    return;
  }

  useAgentStore.getState().pushNotification({ source, agent, kind, tabId, leafId });

  if (delivery === "native") {
    void info(`[route] ${agent}/${kind} -> OS notification`);
    void osNotify(title, body ?? agent, preferences.agentNotificationSound);
    return;
  }
  if (delivery === "toast") {
    void info(`[route] ${agent}/${kind} -> in-app toast`);
    // Native toasts carry the platform's own sound; in-app ones need ours.
    if (preferences.agentNotificationSound) playAgentNotificationSound();
    showAgentToast({ agent, title, body, onActivate });
    return;
  }
  void info(`[route] ${agent}/${kind} -> bell only (toast suppressed)`);
}
