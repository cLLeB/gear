export const AGENT_NOTIFICATION_COOLDOWN_MS = 2_000;

const MAX_RECENT_NOTIFICATIONS = 64;

export type AgentNotificationKey = {
  source: string;
  agent: string;
  kind: string;
  tabId: number;
  leafId: number;
};

/** Drops repeat alerts for the same agent/pane/kind inside a cooldown.
 *
 * A single turn can raise the same signal more than once — the OSC 777 hook and
 * the OSC 133 self-arm path both fire for one prompt — and the user should get
 * one toast, not two. Keys are bounded and LRU-evicted so a long session with
 * many panes cannot grow the map without limit. */
export function createAgentNotificationGate(
  cooldownMs = AGENT_NOTIFICATION_COOLDOWN_MS,
  maxEntries = MAX_RECENT_NOTIFICATIONS,
): (key: AgentNotificationKey, now?: number) => boolean {
  const recent = new Map<string, number>();

  return (key, now = Date.now()) => {
    const id = JSON.stringify([
      key.source,
      key.agent,
      key.kind,
      key.tabId,
      key.leafId,
    ]);
    const previous = recent.get(id);
    // `now >= previous` keeps a backwards clock jump from muting alerts until
    // wall time catches up.
    if (
      previous !== undefined &&
      now >= previous &&
      now - previous < cooldownMs
    ) {
      return false;
    }

    recent.delete(id);
    recent.set(id, now);
    while (recent.size > maxEntries) {
      const oldest = recent.keys().next().value;
      if (oldest === undefined) break;
      recent.delete(oldest);
    }
    return true;
  };
}
