import type { SidebarViewId } from "@/modules/sidebar";
import type { Tab } from "@/modules/tabs";

/** Which repository the Source Control panel should show.
 *
 * "follow-context" is the default: the panel tracks whatever the active tab
 * implies (terminal cwd, editor file's directory, a git tab's repo). "fixed"
 * pins a specific repo root, which is how a nested repo, submodule, or sibling
 * repo inside the workspace gets opened without changing the workspace root. */
export type SourceControlRepositoryTarget =
  | { mode: "follow-context" }
  | { mode: "fixed"; repoRoot: string };

/** Pinned repo roots keyed by space + workspace environment. */
export type SourceControlRepositoryTargets = Readonly<Record<string, string>>;

const FOLLOW_CONTEXT: SourceControlRepositoryTarget = {
  mode: "follow-context",
};

/** NUL separator: neither a space id nor a workspace key can contain it, so
 * the composite key is unambiguous. */
function targetScopeKey(spaceId: string, workspaceKey: string): string {
  return `${spaceId}\0${workspaceKey}`;
}

function dirname(path: string | null): string | null {
  if (!path) return null;
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  if (index < 0) return normalized;
  if (index === 0) return "/";
  // Keep the trailing slash on a Windows drive root ("C:/"), which is a
  // directory, unlike "C:" which git treats as the current dir on that drive.
  if (index === 2 && /^[A-Za-z]:\//.test(normalized)) {
    return normalized.slice(0, 3);
  }
  return normalized.slice(0, index);
}

export function repositoryTargetForSpace(
  targets: SourceControlRepositoryTargets,
  spaceId: string,
  workspaceKey: string,
): SourceControlRepositoryTarget {
  const repoRoot = targets[targetScopeKey(spaceId, workspaceKey)];
  return repoRoot ? { mode: "fixed", repoRoot } : FOLLOW_CONTEXT;
}

export function setRepositoryTargetForSpace(
  targets: SourceControlRepositoryTargets,
  spaceId: string,
  workspaceKey: string,
  repoRoot: string,
): SourceControlRepositoryTargets {
  const key = targetScopeKey(spaceId, workspaceKey);
  if (targets[key] === repoRoot) return targets;
  return { ...targets, [key]: repoRoot };
}

export function clearRepositoryTargetForSpace(
  targets: SourceControlRepositoryTargets,
  spaceId: string,
  workspaceKey: string,
): SourceControlRepositoryTargets {
  const key = targetScopeKey(spaceId, workspaceKey);
  if (!(key in targets)) return targets;
  const next = { ...targets };
  delete next[key];
  return next;
}

/** The directory the active tab implies, used when following context. */
export function activeRepositoryContextPath({
  activeTab,
  activeTerminalLeafCwd,
  explorerRoot,
  workspaceFallbackPath,
}: {
  activeTab: Tab | undefined;
  activeTerminalLeafCwd: string | null;
  explorerRoot: string | null;
  workspaceFallbackPath: string | null;
}): string | null {
  if (activeTab?.kind === "terminal") {
    return activeTerminalLeafCwd ?? explorerRoot ?? workspaceFallbackPath;
  }
  if (activeTab?.kind === "editor") return dirname(activeTab.path);
  if (activeTab?.kind === "git-diff") return activeTab.repoRoot;
  if (activeTab?.kind === "git-commit-file") return activeTab.repoRoot;
  if (activeTab?.kind === "git-history") return activeTab.repoRoot;
  return explorerRoot ?? workspaceFallbackPath;
}

/** Path handed to `useSourceControl`.
 *
 * A pinned target only wins while the Source Control view is showing; the
 * collapsed badge deliberately stays on the cheap, stable workspace path so
 * switching tabs doesn't re-fire git IPC. */
export function sourceControlRepositoryPath({
  contextPath,
  badgeContextPath,
  sidebarView,
  hasOpenGitTab,
  target,
}: {
  contextPath: string | null;
  badgeContextPath: string | null;
  sidebarView: SidebarViewId;
  hasOpenGitTab: boolean;
  target: SourceControlRepositoryTarget;
}): string | null {
  if (sidebarView === "source-control" && target.mode === "fixed") {
    return target.repoRoot;
  }
  return hasOpenGitTab || sidebarView === "source-control"
    ? contextPath
    : badgeContextPath;
}

/** Repo path for the Git History / graph tab. Unlike the panel path this has
 * no badge fallback — the caller always wants a concrete context. */
export function gitGraphRepositoryPath({
  contextPath,
  sidebarView,
  target,
}: {
  contextPath: string | null;
  sidebarView: SidebarViewId;
  target: SourceControlRepositoryTarget;
}): string | null {
  return sidebarView === "source-control" && target.mode === "fixed"
    ? target.repoRoot
    : contextPath;
}

/** True while a pinned target has been chosen but its status has not loaded,
 * so the panel can show the pending repo instead of the previous one. */
export function repositoryTargetIsPending({
  target,
  loadedContextPath,
  loadedRepoRoot,
  isLoading,
}: {
  target: SourceControlRepositoryTarget;
  loadedContextPath: string | null;
  loadedRepoRoot: string | null;
  isLoading: boolean;
}): boolean {
  if (target.mode !== "fixed") return false;
  if (loadedContextPath !== target.repoRoot) return true;
  return isLoading && loadedRepoRoot !== target.repoRoot;
}
