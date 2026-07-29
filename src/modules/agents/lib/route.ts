import { usePreferencesStore } from "@/modules/settings/preferences";
import { info } from "@tauri-apps/plugin-log";
import { showAgentToast } from "../components/AgentToast";
import { useAgentStore } from "../store/agentStore";
import { osNotify } from "./notify";
import type { AgentSource, NotificationKind } from "./types";

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
  if (!usePreferencesStore.getState().agentNotifications) {
    void info(`[route] ${agent}/${kind} dropped: agentNotifications disabled`);
    return;
  }
  if (focused && visible) {
    void info(`[route] ${agent}/${kind} dropped: window focused and agent visible`);
    return;
  }

  useAgentStore.getState().pushNotification({ source, agent, kind, tabId, leafId });

  if (!focused) {
    void info(`[route] ${agent}/${kind} -> OS notification`);
    void osNotify(title, body ?? agent);
    return;
  }
  if (allowToast) {
    void info(`[route] ${agent}/${kind} -> in-app toast`);
    showAgentToast({ agent, title, body, onActivate });
    return;
  }
  void info(`[route] ${agent}/${kind} -> bell only (toast suppressed)`);
}
