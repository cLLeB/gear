import type { GitDiffTab, Tab } from "./useTabs";

export type GitDiffOpenInput = {
	path: string;
	repoRoot: string;
	mode: "-" | "+";
	originalPath?: string | null;
	title?: string;
};

function basename(p: string): string {
	return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

/**
 * Decide what the tab list looks like after opening a git diff.
 *
 * Mirrors the editor's VSCode-style preview behaviour: an unpinned open reuses
 * the space's single preview slot instead of stacking up tabs, while a pinned
 * open (double-click, or an explicit pin) gets a tab of its own. Kept pure so
 * the reuse/replace rules are testable without React.
 */
export function planGitDiffOpen(
	tabs: Tab[],
	input: GitDiffOpenInput,
	spaceId: string,
	pin: boolean,
	allocId: () => number,
): { tabs: Tab[]; targetId: number } {
	const title = input.title ?? `${basename(input.path)} (${input.mode})`;
	const originalPath = input.originalPath ?? null;
	const matches = (tab: Tab): tab is GitDiffTab & { spaceId?: string } =>
		tab.kind === "git-diff" &&
		tab.spaceId === spaceId &&
		tab.repoRoot === input.repoRoot &&
		tab.path === input.path &&
		tab.mode === input.mode;

	// A pinned tab for this diff wins over a preview one, so re-opening an
	// already-pinned diff never demotes it back into the preview slot.
	const matchingTabs = tabs.filter(matches);
	const existing = matchingTabs.find((tab) => !tab.preview) ?? matchingTabs[0];

	if (existing) {
		const preview = pin ? false : existing.preview;
		if (
			existing.title === title &&
			existing.originalPath === originalPath &&
			existing.preview === preview
		) {
			return { tabs, targetId: existing.id };
		}
		return {
			tabs: tabs.map((tab) =>
				tab.id === existing.id
					? { ...existing, title, originalPath, preview }
					: tab,
			),
			targetId: existing.id,
		};
	}

	const id = allocId();
	const tab = {
		id,
		kind: "git-diff",
		spaceId,
		title,
		path: input.path,
		repoRoot: input.repoRoot,
		mode: input.mode,
		originalPath,
		preview: !pin,
	} satisfies GitDiffTab & { spaceId: string };

	if (pin) return { tabs: [...tabs, tab], targetId: id };

	const previewIndex = tabs.findIndex(
		(candidate) =>
			candidate.kind === "git-diff" &&
			candidate.spaceId === spaceId &&
			candidate.preview,
	);
	if (previewIndex === -1) return { tabs: [...tabs, tab], targetId: id };

	const next = [...tabs];
	next[previewIndex] = tab;
	return { tabs: next, targetId: id };
}
