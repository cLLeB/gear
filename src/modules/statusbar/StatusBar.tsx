import { useChatStore } from "@/modules/ai";
import { AgentStatusPill } from "@/modules/ai/components/AgentStatusPill";
import {
  AiOpenButton,
  AiStatusBarControls,
} from "@/modules/ai/components/AiStatusBarControls";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  IncognitoIcon,
  Download01Icon,
  ClockIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useRewindStore } from "@/modules/rewind";
import { CwdBreadcrumb } from "./CwdBreadcrumb";
import { WorkspaceEnvSelector } from "./WorkspaceEnvSelector";
import type { WorkspaceEnv } from "@/modules/workspace";
import { useUpdaterStore } from "@/modules/updater";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";

type Props = {
  cwd: string | null;
  filePath?: string | null;
  home: string | null;
  onCd: (path: string) => void;
  onWorkspaceChange: (env: WorkspaceEnv) => void;
  onOpenMini: () => void;
  /** Only rendered when the AI panel is open and a key is loaded. */
  hasComposer: boolean;
  /** Called when no provider is connected and the user clicks the AI button. */
  onConnectProvider: () => void;
  privateActive: boolean;
};

export function StatusBar({
  cwd,
  filePath,
  home,
  onCd,
  onWorkspaceChange,
  onOpenMini,
  hasComposer,
  onConnectProvider,
  privateActive,
}: Props) {
  const panelOpen = useChatStore((s) => s.panelOpen);
  const openPanel = useChatStore((s) => s.openPanel);
  const updaterStatus = useUpdaterStore((s) => s.status);
  const hasUpdate =
    updaterStatus.kind === "available" ||
    updaterStatus.kind === "manual-available" ||
    updaterStatus.kind === "ready";

  return (
    <footer className="flex h-8 shrink-0 items-center justify-between gap-3 border-t border-border/60 bg-card/60 px-3 text-[11px]">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <WorkspaceEnvSelector onSelect={onWorkspaceChange} />
        <CwdBreadcrumb cwd={cwd} filePath={filePath} home={home} onCd={onCd} />
        {privateActive ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex shrink-0 cursor-default items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10.5px] font-medium text-amber-700 dark:text-amber-400">
                <HugeiconsIcon icon={IncognitoIcon} size={11} strokeWidth={2} />
                <span>Private: hidden from AI</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-64 text-[11px] leading-relaxed">
              AI can't see this terminal's output. Use it for secrets, SSH, or
              anything you don't want sent to the model.
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {hasUpdate && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => void openSettingsWindow("about")}
                className="flex shrink-0 cursor-pointer items-center gap-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-[10.5px] font-medium text-blue-600 transition-colors hover:bg-blue-500/25 dark:text-blue-400"
              >
                <HugeiconsIcon icon={Download01Icon} size={11} strokeWidth={2} />
                <span>
                  {updaterStatus.kind === "ready"
                    ? "Restart to update"
                    : "Update available"}
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[11px]">
              {updaterStatus.kind === "ready"
                ? "Restart Gear to finish installing the update."
                : updaterStatus.kind === "available"
                  ? `v${updaterStatus.update.version} is ready to install — click to open settings.`
                  : updaterStatus.kind === "manual-available"
                    ? `v${updaterStatus.info.version} is available — click to open settings.`
                    : "An update is available."}
            </TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Toggle session timeline"
              onClick={() => useRewindStore.getState().toggle()}
              className="flex shrink-0 cursor-pointer items-center rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <HugeiconsIcon icon={ClockIcon} size={13} strokeWidth={2} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-[11px]">
            Rewind — session timeline (Ctrl/Cmd+Shift+T)
          </TooltipContent>
        </Tooltip>
        <AgentStatusPill onClick={onOpenMini} />
        {panelOpen && hasComposer ? (
          <AiStatusBarControls />
        ) : (
          <AiOpenButton onOpen={hasComposer ? openPanel : onConnectProvider} />
        )}
      </div>
    </footer>
  );
}
