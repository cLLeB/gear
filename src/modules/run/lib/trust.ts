/**
 * Workspace trust for project-supplied run configs.
 *
 * A `.gear/settings.json` checked into a repository is executable content:
 * cloning an untrusted repo and pressing Run would otherwise execute whatever
 * that file specifies, with whatever environment it sets. Project configs are
 * therefore inert until the user approves that specific workspace root once.
 * Presets and the user's own settings are never gated — they did not come from
 * the repository.
 */

import type { RunConfig } from "./types";
import type { RunLayers } from "./resolve";

/** Separator style and trailing slashes must not decide a security question. */
function normalizeRoot(root: string): string {
  return root.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * Approval is per exact workspace root. A nested repository is a different
 * root and is asked about separately, so trusting a parent never silently
 * extends to vendored code inside it.
 */
export function isProjectTrusted(
  root: string | null,
  trustedRoots: string[],
): boolean {
  if (!root) return false;
  const target = normalizeRoot(root);
  return trustedRoots.some((r) => normalizeRoot(r) === target);
}

export function withTrustedProject(
  trustedRoots: string[],
  root: string,
): string[] {
  if (isProjectTrusted(root, trustedRoots)) return trustedRoots;
  return [...trustedRoots, normalizeRoot(root)];
}

export type RunLayersPlan = {
  layers: RunLayers;
  /** The project has configs that are being withheld pending approval. */
  needsTrust: boolean;
};

export function planRunLayers(input: {
  projectConfigs: RunConfig[];
  settingsConfigs: RunConfig[];
  workspaceRoot: string | null;
  trustedRoots: string[];
}): RunLayersPlan {
  const trusted = isProjectTrusted(input.workspaceRoot, input.trustedRoots);
  const hasProjectConfigs =
    input.workspaceRoot !== null && input.projectConfigs.length > 0;

  return {
    layers: {
      project: trusted ? input.projectConfigs : [],
      settings: input.settingsConfigs,
    },
    needsTrust: hasProjectConfigs && !trusted,
  };
}
