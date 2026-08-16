/**
 * Reactive view of the run configuration layers for the current workspace.
 * Shared by the picker, the tab-bar control and the palette so they all agree
 * on what is available and what is pinned.
 */

import { useMemo } from "react";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useWorkspaceConfigStore } from "@/modules/settings/workspaceConfig";
import { allRunConfigs, type RunLayers } from "./resolve";
import { planRunLayers } from "./trust";
import type { LayeredRunConfig } from "./types";

export type RunConfigsView = {
  layers: RunLayers;
  /** Everything selectable, in precedence order. */
  available: LayeredRunConfig[];
  /** Qualified id pinned for this workspace, or null for auto-matching. */
  selectedId: string | null;
  /** The project ships run configs that are withheld pending approval. */
  needsTrust: boolean;
  /** Validation problems in the project's run block. */
  errors: string[];
};

export function useRunConfigs(workspaceRoot: string | null): RunConfigsView {
  const customConfigs = usePreferencesStore((s) => s.runCustomConfigs);
  const trustedRoots = usePreferencesStore((s) => s.trustedRunProjects);
  const selectedConfigs = usePreferencesStore((s) => s.runSelectedConfigs);
  const workspaceConfig = useWorkspaceConfigStore((s) => s.config);

  const projectConfigs = workspaceConfig?.run?.configs ?? [];
  const errors = workspaceConfig?.runErrors ?? [];

  const plan = useMemo(
    () =>
      planRunLayers({
        projectConfigs,
        settingsConfigs: customConfigs,
        workspaceRoot,
        trustedRoots,
      }),
    // projectConfigs/errors are derived from workspaceConfig, which is the
    // identity that actually changes.
    [workspaceConfig, customConfigs, workspaceRoot, trustedRoots],
  );

  const available = useMemo(() => allRunConfigs(plan.layers), [plan]);

  return {
    layers: plan.layers,
    available,
    selectedId: workspaceRoot ? (selectedConfigs[workspaceRoot] ?? null) : null,
    needsTrust: plan.needsTrust,
    errors,
  };
}
