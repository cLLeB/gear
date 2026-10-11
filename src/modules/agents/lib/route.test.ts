import { beforeEach, describe, expect, it, vi } from "vitest";

const preferences = vi.hoisted(() => ({
  agentNotifications: true,
  agentNotificationSound: true,
}));
const notifications = vi.hoisted(() => ({
  pushNotification: vi.fn(),
  osNotify: vi.fn(async () => "requested" as const),
  playSound: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-log", () => ({ info: vi.fn(async () => undefined) }));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: { getState: () => preferences },
}));
vi.mock("../components/AgentToast", () => ({
  showAgentToast: notifications.showToast,
}));
vi.mock("../store/agentStore", () => ({
  useAgentStore: {
    getState: () => ({ pushNotification: notifications.pushNotification }),
  },
}));
vi.mock("./notify", () => ({ osNotify: notifications.osNotify }));
vi.mock("./sound", () => ({
  playAgentNotificationSound: notifications.playSound,
}));

beforeEach(() => {
  vi.clearAllMocks();
  preferences.agentNotifications = true;
  preferences.agentNotificationSound = true;
});

const base = {
  source: "terminal" as const,
  agent: "codex",
  kind: "attention" as const,
  title: "Codex needs your input",
  allowToast: true,
  onActivate: vi.fn(),
};

describe("routeAgentNotification sound preference", () => {
  it("plays the in-app sound with an in-app toast", async () => {
    const { routeAgentNotification } = await import("./route");

    routeAgentNotification({ ...base, focused: true, visible: false, tabId: 101, leafId: 201 });

    expect(notifications.showToast).toHaveBeenCalledOnce();
    expect(notifications.playSound).toHaveBeenCalledOnce();
  });

  it("keeps in-app toasts silent when sound is disabled", async () => {
    preferences.agentNotificationSound = false;
    const { routeAgentNotification } = await import("./route");

    routeAgentNotification({ ...base, focused: true, visible: false, tabId: 102, leafId: 202 });

    expect(notifications.showToast).toHaveBeenCalledOnce();
    expect(notifications.playSound).not.toHaveBeenCalled();
  });

  it("leaves the sound of a native notification to the platform", async () => {
    const { routeAgentNotification } = await import("./route");

    routeAgentNotification({ ...base, focused: false, visible: false, tabId: 103, leafId: 203 });

    expect(notifications.osNotify).toHaveBeenCalledWith(base.title, base.agent, true);
    expect(notifications.playSound).not.toHaveBeenCalled();
  });

  it("asks for a silent native notification when sound is disabled", async () => {
    preferences.agentNotificationSound = false;
    const { routeAgentNotification } = await import("./route");

    routeAgentNotification({ ...base, focused: false, visible: false, tabId: 104, leafId: 204 });

    expect(notifications.pushNotification).toHaveBeenCalledOnce();
    expect(notifications.osNotify).toHaveBeenCalledWith(base.title, base.agent, false);
    expect(notifications.playSound).not.toHaveBeenCalled();
  });
});
