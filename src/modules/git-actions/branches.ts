// Branch listing and naming helpers (pure).

import { slugify } from "@/lib/toolkit/slugify";

export interface BranchInfo {
  name: string;
  current: boolean;
  /** Unix seconds of the tip commit. */
  updated: number;
  upstream: string | null;
  ahead: number;
  behind: number;
  gone: boolean;
  subject: string;
}

/** The for-each-ref format parseBranches expects. */
export const BRANCH_FORMAT = "%(HEAD)%09%(refname:short)%09%(committerdate:unix)%09%(upstream:short)%09%(upstream:track)%09%(contents:subject)";

export function parseBranches(output: string): BranchInfo[] {
  return output
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((line) => {
      const [head, name, date, upstream, track, ...subject] = line.split("\t");
      const ahead = /ahead (\d+)/.exec(track ?? "");
      const behind = /behind (\d+)/.exec(track ?? "");
      return {
        name,
        current: head === "*",
        updated: Number(date) || 0,
        upstream: upstream || null,
        ahead: ahead ? +ahead[1] : 0,
        behind: behind ? +behind[1] : 0,
        gone: /gone/.test(track ?? ""),
        subject: subject.join("\t"),
      };
    })
    .sort((a, b) => Number(b.current) - Number(a.current) || b.updated - a.updated);
}

/** git check-ref-format, the rules that matter for typed names. */
export function isValidBranchName(name: string): boolean {
  if (!name || name === "@" || name.startsWith("-") || name.endsWith("/") || name.endsWith(".lock") || name.endsWith(".")) return false;
  if (/(^|\/)\./.test(name) || /\.\./.test(name) || /\/\//.test(name) || /@\{/.test(name)) return false;
  return !/[\s~^:?*[\\\x00-\x1f\x7f]/.test(name);
}

/**
 * Turn free text ("Fix login redirect #123") into a branch name, keeping an
 * explicit prefix ("fix/…") or inferring one from a leading verb.
 */
export function branchNameFromText(text: string): string {
  const t = text.trim();
  if (isValidBranchName(t) && !/\s/.test(t)) return t;
  const explicit = /^(feat|fix|chore|docs|refactor|test|perf|ci|build|hotfix|release)[/:]\s*(.+)$/i.exec(t);
  if (explicit) return `${explicit[1].toLowerCase()}/${slugify(explicit[2], { maxLength: 50 })}`;
  const verb = /^(fix|add|implement|support|remove|refactor|update|document)\b/i.exec(t);
  const prefix = !verb ? "" : /fix/i.test(verb[1]) ? "fix/" : /refactor/i.test(verb[1]) ? "refactor/" : /document/i.test(verb[1]) ? "docs/" : "feat/";
  return prefix + slugify(t, { maxLength: 50 });
}

export interface CleanupCandidate {
  branch: BranchInfo;
  reason: "merged" | "gone" | "merged+gone";
}

/** Branches safe to propose for deletion: merged into the base or upstream gone, never current/base. */
export function cleanupCandidates(
  branches: readonly BranchInfo[],
  mergedNames: ReadonlySet<string>,
  baseBranch: string,
): CleanupCandidate[] {
  const protectedNames = new Set([baseBranch, "main", "master", "develop", "trunk"]);
  return branches
    .filter((b) => !b.current && !protectedNames.has(b.name) && !/^release\//.test(b.name))
    .map((b) => {
      const merged = mergedNames.has(b.name);
      if (merged && b.gone) return { branch: b, reason: "merged+gone" as const };
      if (merged) return { branch: b, reason: "merged" as const };
      if (b.gone) return { branch: b, reason: "gone" as const };
      return null;
    })
    .filter((c): c is CleanupCandidate => c !== null);
}

/** "origin/main" or "refs/remotes/origin/main" → "main". */
export function baseFromRemoteHead(symbolicRef: string): string | null {
  const m = /(?:refs\/remotes\/)?[^/]+\/(.+)$/.exec(symbolicRef.trim());
  return m ? m[1] : null;
}
