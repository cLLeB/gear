import { rankPicks } from "@/modules/quick-pick/rank";
import type { CommandPaletteAction } from "./actions";
import { recencyBonus } from "./recent";

/**
 * Fuzzy-rank palette actions: label hits first (with highlight positions),
 * then group/keyword hits, nudged by how recently each command was run.
 * Disabled actions sink below enabled ones with the same score band.
 */
export function rankActions(
  actions: readonly CommandPaletteAction[],
  query: string,
  recent: readonly string[],
): Array<{ action: CommandPaletteAction; positions: number[] }> {
  const ranked = rankPicks(
    query,
    actions.map((action) => ({
      label: action.label,
      keywords: [action.group, ...action.keywords],
      value: action,
    })),
  );
  return ranked
    .map((r, index) => ({
      action: r.item.value,
      positions: r.labelPositions,
      score: r.score + recencyBonus(recent, r.item.value.id) - (r.item.value.disabledReason ? 0.5 : 0),
      index,
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ action, positions }) => ({ action, positions }));
}

/** Recent actions that still exist, in recency order. */
export function recentActions(
  actions: readonly CommandPaletteAction[],
  recent: readonly string[],
  limit = 5,
): CommandPaletteAction[] {
  const byId = new Map(actions.map((a) => [a.id, a]));
  const out: CommandPaletteAction[] = [];
  for (const id of recent) {
    const a = byId.get(id);
    if (a && !a.disabledReason) out.push(a);
    if (out.length >= limit) break;
  }
  return out;
}
