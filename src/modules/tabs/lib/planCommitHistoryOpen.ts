import type { GitHistoryTab, Tab } from "./useTabs";

/**
 * Plans opening (or reusing) the Git History tab for a repository.
 *
 * Tab identity is scoped by repo **and** space: the same repository opened from
 * two spaces gets a tab in each, and a history tab in another space is never
 * silently reused. Returns the same `tabs` array when nothing changed so
 * callers can skip a re-render.
 */
export function planCommitHistoryOpen(
  tabs: Tab[],
  input: { repoRoot: string; branch?: string | null },
  spaceId: string,
  allocId: () => number,
): { tabs: Tab[]; targetId: number } {
  const existing = tabs.find(
    (tab) =>
      tab.kind === "git-history" &&
      tab.spaceId === spaceId &&
      tab.repoRoot === input.repoRoot,
  );
  const title = input.branch ? `History · ${input.branch}` : "Git History";
  if (existing) {
    if (existing.title === title) return { tabs, targetId: existing.id };
    return {
      tabs: tabs.map((tab) =>
        tab.id === existing.id ? { ...existing, title } : tab,
      ),
      targetId: existing.id,
    };
  }

  const id = allocId();
  return {
    tabs: [
      ...tabs,
      {
        id,
        kind: "git-history",
        spaceId,
        title,
        repoRoot: input.repoRoot,
      } satisfies GitHistoryTab,
    ],
    targetId: id,
  };
}
