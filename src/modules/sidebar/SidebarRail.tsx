import { cn } from "@/lib/utils";
import {
  ClockIcon,
  FolderGitTwoIcon,
  FolderTreeIcon,
  Settings01Icon,
  SidebarLeft01Icon,
  SidebarRight01Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { SidebarViewId } from "./types";

/** Height of the horizontal activity rail (px). */
export const SIDEBAR_RAIL_HEIGHT = 48;
/** @deprecated kept for back-compat with older imports. */
export const SIDEBAR_RAIL_WIDTH = SIDEBAR_RAIL_HEIGHT;

type Props = {
  activeView: SidebarViewId;
  /** Sidebar is expanded (a view panel is visible). */
  sidebarOpen: boolean;
  onSelectView: (view: SidebarViewId) => void;
  changedCount: number;
  aiActive: boolean;
  onToggleAi: () => void;
  onToggleRewind: () => void;
  onOpenSettings: () => void;
  sidebarPosition: "left" | "right";
  onToggleSidebarPosition: () => void;
};

type RailButtonProps = {
  label: string;
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
  active?: boolean;
  badge?: number;
  onClick: () => void;
};

function RailButton({ label, icon, active, badge, onClick }: RailButtonProps) {
  const showBadge = !!badge && badge > 0;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "group relative flex w-9 h-8 cursor-pointer items-center justify-center outline-none transition-all duration-200 rounded-lg",
        active
          ? "text-primary bg-primary/10 shadow-sm"
          : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05]",
      )}
    >
      {/* Active accent dot (Bottom Dock style). */}
      <span
        className={cn(
          "pointer-events-none absolute bottom-[1px] left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-primary transition-all",
          active ? "opacity-100 scale-100" : "opacity-0 scale-50",
        )}
        aria-hidden
      />
      <span
        className={cn(
          "flex size-8 items-center justify-center transition-colors",
        )}
      >
        <HugeiconsIcon
          icon={icon}
          size={15}
          strokeWidth={active ? 2.5 : 1.75}
          className="shrink-0"
        />
      </span>
      {showBadge ? (
        <span className="absolute right-1 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-none tabular-nums text-destructive-foreground shadow-sm">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </button>
  );
}

/**
 * Horizontal activity rail pinned to the bottom of the workspace.
 */
export function SidebarRail({
  activeView,
  sidebarOpen,
  onSelectView,
  changedCount,
  aiActive,
  onToggleAi,
  onToggleRewind,
  onOpenSettings,
  sidebarPosition,
  onToggleSidebarPosition,
}: Props) {
  return (
    <div className="z-50 flex h-10 shrink-0 flex-row items-center gap-1 rounded-2xl border border-border/40 bg-background/70 px-2 shadow-2xl backdrop-blur-xl transition-all hover:bg-background/90">
      <RailButton
        label="Files"
        icon={FolderTreeIcon}
        active={sidebarOpen && activeView === "explorer"}
        onClick={() => onSelectView("explorer")}
      />
      <RailButton
        label="Source Control"
        icon={FolderGitTwoIcon}
        active={sidebarOpen && activeView === "source-control"}
        badge={changedCount}
        onClick={() => onSelectView("source-control")}
      />

      <div className="flex-1" />

      <RailButton
        label="AI agent"
        icon={SparklesIcon}
        active={aiActive}
        onClick={onToggleAi}
      />
      <RailButton label="Rewind" icon={ClockIcon} onClick={onToggleRewind} />
      <RailButton
        label="Settings"
        icon={Settings01Icon}
        onClick={onOpenSettings}
      />
      <RailButton
        label={
          sidebarPosition === "left"
            ? "Move sidebar right"
            : "Move sidebar left"
        }
        icon={sidebarPosition === "left" ? SidebarRight01Icon : SidebarLeft01Icon}
        onClick={onToggleSidebarPosition}
      />
    </div>
  );
}
