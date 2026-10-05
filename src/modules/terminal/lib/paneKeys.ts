// Stable keys for terminal panes across restarts. Leaf ids are reallocated on
// every launch, so persisted per-pane data (scrollback) is keyed by a random
// key that is saved with the layout and re-adopted when it is hydrated.

const keys = new Map<number, string>();

function fresh(): string {
  const r = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return r.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 36);
}

/** The persistent key for a leaf (created on first use). */
export function keyForLeaf(leafId: number): string {
  let k = keys.get(leafId);
  if (!k) keys.set(leafId, (k = fresh()));
  return k;
}

/** Re-attach a saved key to a freshly hydrated leaf. */
export function adoptLeafKey(leafId: number, key: string): void {
  if (/^[a-zA-Z0-9-]{1,64}$/.test(key)) keys.set(leafId, key);
}

export function knownLeafKey(leafId: number): string | null {
  return keys.get(leafId) ?? null;
}
