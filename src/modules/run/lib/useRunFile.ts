/**
 * Imperative shell over the pure run planners: work out which config applies,
 * clear the trust gate if the project supplied it, put the space's Run
 * terminal in front, and type it in. Everything decidable without a PTY lives
 * in `resolve.ts` / `plan.ts` / `trust.ts`; this file only sequences.
 */

import { useCallback } from "react";
import { basename } from "@/lib/toolkit/pathUtils";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setTrustedRunProjects } from "@/modules/settings/store";
import { useWorkspaceConfigStore } from "@/modules/settings/workspaceConfig";
import {
  interruptLeaf,
  leafCwd,
  leafHasForegroundProcess,
  submitToLeaf,
  whenSessionReady,
} from "@/modules/terminal";
import { planRunSubmission, shellDialect } from "./plan";
import { resolveRunSpec } from "./resolve";
import { planRunLayers, withTrustedProject } from "./trust";
import type { RunConfig, RunSpec } from "./types";

export type OpenRunTerminal = (spec: RunSpec) => {
  tabId: number;
  leafId: number;
  created: boolean;
  /** Shell backing the run terminal, for env syntax. Null when unknown. */
  shellPath: string | null;
};

/** Asks the user whether this workspace's own run configs may execute. */
export type TrustPrompt = (request: {
  workspaceRoot: string;
  configs: RunConfig[];
}) => Promise<boolean>;

/** Time for a SIGINT'd previous run to release the prompt before we type. */
const INTERRUPT_SETTLE_MS = 150;

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function useRunFile(opts: {
  openRunTerminal: OpenRunTerminal;
  workspaceRoot: string | null;
  onUnsupported?: (message: string) => void;
  requestTrust?: TrustPrompt;
}): (filePath: string) => Promise<void> {
  const { openRunTerminal, workspaceRoot, onUnsupported, requestTrust } = opts;

  return useCallback(
    async (filePath: string) => {
      const prefs = usePreferencesStore.getState();
      const projectConfigs =
        useWorkspaceConfigStore.getState().config?.run?.configs ?? [];

      let plan = planRunLayers({
        projectConfigs,
        settingsConfigs: prefs.runCustomConfigs,
        workspaceRoot,
        trustedRoots: prefs.trustedRunProjects,
      });

      // Project configs stay inert until this exact root is approved once.
      if (plan.needsTrust && workspaceRoot && requestTrust) {
        const approved = await requestTrust({
          workspaceRoot,
          configs: projectConfigs,
        });
        if (approved) {
          const trusted = withTrustedProject(
            usePreferencesStore.getState().trustedRunProjects,
            workspaceRoot,
          );
          await setTrustedRunProjects(trusted);
          plan = planRunLayers({
            projectConfigs,
            settingsConfigs: prefs.runCustomConfigs,
            workspaceRoot,
            trustedRoots: trusted,
          });
        }
      }

      const spec = resolveRunSpec(filePath, {
        ...plan.layers,
        workspaceRoot: workspaceRoot ?? undefined,
        selectedId: workspaceRoot
          ? prefs.runSelectedConfigs[workspaceRoot]
          : undefined,
      });
      if (!spec) {
        onUnsupported?.(`No run command for ${basename(filePath)}`);
        return;
      }

      const { leafId, created, shellPath } = openRunTerminal(spec);
      await whenSessionReady(leafId);

      // Re-running while the last run is still going: stop it first, otherwise
      // the command would be typed into the running program's stdin instead.
      if (!created && (await leafHasForegroundProcess(leafId))) {
        interruptLeaf(leafId);
        await delay(INTERRUPT_SETTLE_MS);
      }

      // A freshly spawned shell already starts in spec.cwd, so it needs no cd.
      const currentCwd = created ? spec.cwd : leafCwd(leafId);
      const lines = planRunSubmission(
        spec,
        currentCwd,
        shellDialect(shellPath ?? (prefs.terminalShell || null)),
      );
      for (const line of lines) submitToLeaf(leafId, line);
    },
    [openRunTerminal, workspaceRoot, onUnsupported, requestTrust],
  );
}
