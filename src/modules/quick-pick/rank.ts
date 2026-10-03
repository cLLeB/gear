// Ranking for the quick pick. The label carries the match highlight, but a
// query that only hits the description or keywords ("branch" finding
// "Checkout…") still has to surface the item, just below the label hits.

import { fuzzyMatch } from "@/lib/lang/fuzzy";

export interface QuickPickItem<T = unknown> {
  label: string;
  description?: string;
  /** Second line under the label; not searched. */
  detail?: string;
  keywords?: readonly string[];
  value: T;
  /** Items with the same group render under one heading, in first-seen order. */
  group?: string;
}

export interface RankedPick<T> {
  item: QuickPickItem<T>;
  /** Matched indices into `item.label`, for highlighting. */
  labelPositions: number[];
  score: number;
}

/** Below any label match: keyword-only hits sort after every label hit. */
const SECONDARY_PENALTY = 1000;

export function rankPicks<T>(
  query: string,
  items: readonly QuickPickItem<T>[],
): RankedPick<T>[] {
  const q = query.trim();
  if (q === "") {
    return items.map((item) => ({ item, labelPositions: [], score: 0 }));
  }
  // Space-separated terms must all match somewhere; the first term that hits
  // the label drives the highlight. This lets "git push" find "Git: Push".
  const terms = q.split(/\s+/);
  const out: Array<RankedPick<T> & { index: number }> = [];
  items.forEach((item, index) => {
    const secondary = [item.description ?? "", ...(item.keywords ?? [])].join(" ");
    let score = 0;
    const positions: number[] = [];
    for (const term of terms) {
      const onLabel = fuzzyMatch(term, item.label);
      if (onLabel) {
        score += onLabel.score;
        positions.push(...onLabel.positions);
        continue;
      }
      const onSecondary = fuzzyMatch(term, secondary);
      if (!onSecondary) return;
      score += onSecondary.score - SECONDARY_PENALTY;
    }
    out.push({
      item,
      labelPositions: [...new Set(positions)].sort((a, b) => a - b),
      score,
      index,
    });
  });
  out.sort((a, b) => b.score - a.score || a.index - b.index);
  return out.map(({ item, labelPositions, score }) => ({ item, labelPositions, score }));
}

/** Split `text` into runs flagged as matched or not, for rendering highlights. */
export function highlightRuns(
  text: string,
  positions: readonly number[],
): Array<{ text: string; match: boolean }> {
  if (positions.length === 0) return [{ text, match: false }];
  const set = new Set(positions);
  const runs: Array<{ text: string; match: boolean }> = [];
  for (let i = 0; i < text.length; i++) {
    const match = set.has(i);
    const last = runs[runs.length - 1];
    if (last && last.match === match) last.text += text[i];
    else runs.push({ text: text[i], match });
  }
  return runs;
}
