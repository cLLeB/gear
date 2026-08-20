/**
 * Broadcast input: type once, and every pane in the active tab receives the
 * keystrokes. Useful for driving a set of servers or running the same command
 * across several worktrees side by side.
 *
 * The state is module-level rather than React state because the consumer is the
 * renderer pool's `onData` handler, which runs outside React on every keystroke
 * and must not pay for a context read.
 */

import { useSyncExternalStore } from "react";

/** Resolves every leaf that shares a tab with `leafId`, including it. */
export type PeerResolver = (leafId: number) => number[];

let resolvePeers: PeerResolver = () => [];
let enabled = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Registered once by the app shell, which owns the pane tree. */
export function setBroadcastPeerResolver(resolver: PeerResolver): void {
  resolvePeers = resolver;
}

export function isBroadcastEnabled(): boolean {
  return enabled;
}

export function setBroadcastEnabled(next: boolean): void {
  if (enabled === next) return;
  enabled = next;
  emit();
}

export function toggleBroadcast(): boolean {
  setBroadcastEnabled(!enabled);
  return enabled;
}

export function subscribeBroadcast(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useBroadcastEnabled(): boolean {
  return useSyncExternalStore(
    subscribeBroadcast,
    isBroadcastEnabled,
    // The settings window renders this too and has no terminals.
    () => false,
  );
}

/**
 * The panes a keystroke from `sourceLeafId` should be mirrored into. The source
 * itself is excluded — xterm has already delivered its own input — and so are
 * duplicates, so a malformed pane tree cannot double-type into a shell.
 */
export function broadcastTargets(
  peers: readonly number[],
  sourceLeafId: number,
): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of peers) {
    if (id === sourceLeafId || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Live lookup used by the renderer pool; empty whenever broadcast is off. */
export function broadcastPeers(sourceLeafId: number): number[] {
  if (!enabled) return [];
  return broadcastTargets(resolvePeers(sourceLeafId), sourceLeafId);
}

/** Test seam — resets both the flag and the resolver. */
export function resetBroadcastForTests(): void {
  enabled = false;
  resolvePeers = () => [];
  listeners.clear();
}
