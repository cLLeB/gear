import { describe, expect, it } from "vitest";

import { planGitDiffOpen, type GitDiffOpenInput } from "./planGitDiffOpen";
import type { Tab } from "./useTabs";

const SPACE = "s1";

function input(over: Partial<GitDiffOpenInput> = {}): GitDiffOpenInput {
	return { path: "/repo/a.ts", repoRoot: "/repo", mode: "+", ...over };
}

function diffTab(over: Partial<Tab> & { id: number }): Tab {
	return {
		kind: "git-diff",
		spaceId: SPACE,
		title: "a.ts (+)",
		path: "/repo/a.ts",
		repoRoot: "/repo",
		mode: "+",
		originalPath: null,
		preview: true,
		...over,
	} as Tab;
}

function allocFrom(start: number): () => number {
	let n = start;
	return () => n++;
}

describe("planGitDiffOpen", () => {
	it("opens an unpinned diff into the preview slot", () => {
		const plan = planGitDiffOpen([], input(), SPACE, false, allocFrom(1));
		expect(plan.targetId).toBe(1);
		expect(plan.tabs).toHaveLength(1);
		expect(plan.tabs[0]).toMatchObject({
			kind: "git-diff",
			preview: true,
			title: "a.ts (+)",
		});
	});

	it("opens a pinned diff as a persistent tab", () => {
		const plan = planGitDiffOpen([], input(), SPACE, true, allocFrom(1));
		expect(plan.tabs[0]).toMatchObject({ preview: false });
	});

	it("replaces the existing preview slot instead of stacking tabs", () => {
		const existing = [diffTab({ id: 1 })];
		const plan = planGitDiffOpen(
			existing,
			input({ path: "/repo/b.ts" }),
			SPACE,
			false,
			allocFrom(2),
		);
		expect(plan.tabs).toHaveLength(1);
		expect(plan.tabs[0]).toMatchObject({ id: 2, path: "/repo/b.ts" });
	});

	it("keeps pinned diffs when a new preview opens", () => {
		const existing = [diffTab({ id: 1, preview: false })];
		const plan = planGitDiffOpen(
			existing,
			input({ path: "/repo/b.ts" }),
			SPACE,
			false,
			allocFrom(2),
		);
		expect(plan.tabs).toHaveLength(2);
	});

	it("reuses the matching tab rather than opening a duplicate", () => {
		const existing = [diffTab({ id: 1 })];
		const plan = planGitDiffOpen(existing, input(), SPACE, false, allocFrom(9));
		expect(plan.targetId).toBe(1);
		expect(plan.tabs).toBe(existing);
	});

	it("prefers an already-pinned tab over a preview one for the same diff", () => {
		const existing = [diffTab({ id: 1 }), diffTab({ id: 2, preview: false })];
		const plan = planGitDiffOpen(existing, input(), SPACE, false, allocFrom(9));
		expect(plan.targetId).toBe(2);
	});

	it("promotes an existing preview tab when opened pinned", () => {
		const existing = [diffTab({ id: 1 })];
		const plan = planGitDiffOpen(existing, input(), SPACE, true, allocFrom(9));
		expect(plan.targetId).toBe(1);
		expect(plan.tabs[0]).toMatchObject({ preview: false });
	});

	it("distinguishes the two sides of a diff", () => {
		const existing = [diffTab({ id: 1 })];
		const plan = planGitDiffOpen(
			existing,
			input({ mode: "-" }),
			SPACE,
			true,
			allocFrom(2),
		);
		expect(plan.targetId).toBe(2);
		expect(plan.tabs).toHaveLength(2);
	});

	it("does not reuse a preview slot from another space", () => {
		const existing = [diffTab({ id: 1, spaceId: "other" })];
		const plan = planGitDiffOpen(existing, input(), SPACE, false, allocFrom(2));
		expect(plan.tabs).toHaveLength(2);
		expect(plan.targetId).toBe(2);
	});

	it("refreshes title and originalPath on an existing tab", () => {
		const existing = [diffTab({ id: 1, originalPath: null })];
		const plan = planGitDiffOpen(
			existing,
			input({ title: "renamed", originalPath: "/repo/old.ts" }),
			SPACE,
			false,
			allocFrom(9),
		);
		expect(plan.tabs[0]).toMatchObject({
			title: "renamed",
			originalPath: "/repo/old.ts",
		});
	});
});
