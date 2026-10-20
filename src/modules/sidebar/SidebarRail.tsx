import { cn } from "@/lib/utils";
import {
  Bug01Icon,
  ContainerIcon,
  PuzzleIcon,
  Search01Icon,
  CloudServerIcon,
  CubeIcon,
  Database01Icon,
  ClockIcon,
  FolderGitTwoIcon,
  FolderTreeIcon,
  Settings01Icon,
  SparklesIcon,
  TestTube01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import type { SidebarViewId } from "./types";

/** Width of the vertical activity rail beside the sidebar (px). */
export const SIDEBAR_RAIL_WIDTH = 44;
/** @deprecated the rail is vertical now; kept for older imports. */
export const SIDEBAR_RAIL_HEIGHT = SIDEBAR_RAIL_WIDTH;

type Props = {
  activeView: SidebarViewId;
  /** Sidebar is expanded (a view panel is visible). */
  sidebarOpen: boolean;
  onSelectView: (view: SidebarViewId) => void;
  changedCount: number;
  /** Paused debug sessions (shown as a badge). */
  debugBadge?: number;
  aiActive: boolean;
  onToggleAi: () => void;
  onToggleRewind: () => void;
  onOpenSettings: () => void;
  sidebarPosition: "left" | "right";
  onToggleSidebarPosition: () => void;
  onHideSidebar?: () => void;
};

type RailButtonProps = {
  label: string;
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
  active?: boolean;
  badge?: number;
  /** Which edge the active marker sits on: the window's outer edge. */
  edge: "left" | "right";
  onClick: () => void;
};

function RailButton({ label, icon, active, badge, edge, onClick }: RailButtonProps) {
  const showBadge = !!badge && badge > 0;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      data-rail-button={label}
      className={cn(
        "group relative flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg outline-none transition-colors duration-150",
        active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
      )}
    >
      {/* Active marker on the outer edge, like the activity bars people know. */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-primary transition-all",
          edge === "left" ? "-left-[4px]" : "-right-[4px]",
          active ? "opacity-100" : "opacity-0",
        )}
      />
      <HugeiconsIcon icon={icon} size={17} strokeWidth={active ? 2.25 : 1.75} className="shrink-0" />
      {showBadge ? (
        <span className="absolute -right-0.5 -top-0.5 inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-primary px-1 text-[8.5px] font-semibold leading-none tabular-nums text-primary-foreground shadow-sm">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </button>
  );
}

/**
 * Vertical activity rail on the window's outer edge beside the sidebar:
 * views at the top, AI, Rewind and Settings at the bottom. It stays visible
 * when the sidebar is collapsed, so a view is always one click away.
 */
export function SidebarRail({
  activeView,
  sidebarOpen,
  onSelectView,
  changedCount,
  debugBadge,
  aiActive,
  onToggleAi,
  onToggleRewind,
  onOpenSettings,
  sidebarPosition,
  onToggleSidebarPosition,
  onHideSidebar,
}: Props) {
  const edge = sidebarPosition;
  const view = (id: SidebarViewId, label: string, icon: RailButtonProps["icon"], badge?: number) => (
    <RailButton key={id} label={label} icon={icon} edge={edge} badge={badge} active={sidebarOpen && activeView === id} onClick={() => onSelectView(id)} />
  );
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <nav aria-label="Views" data-activity-rail={sidebarPosition} className="flex h-full w-11 shrink-0 flex-col items-center gap-1 py-2">
          {view("explorer", "Files", FolderTreeIcon)}
          {view("search", "Search", Search01Icon)}
          {view("source-control", "Source Control", FolderGitTwoIcon, changedCount)}
          {view("debug", "Run and Debug", Bug01Icon, debugBadge)}
          {view("tests", "Testing", TestTube01Icon)}
          {view("database", "Database", Database01Icon)}
          {view("containers", "Containers", ContainerIcon)}
          {view("remote", "Remote (SSH)", CloudServerIcon)}
          {view("k8s", "Kubernetes", CubeIcon)}
          {view("extensions", "Extensions", PuzzleIcon)}
          <div className="min-h-2 flex-1" />
          <RailButton label="AI agent" icon={SparklesIcon} edge={edge} active={aiActive} onClick={onToggleAi} />
          <RailButton label="Rewind" icon={ClockIcon} edge={edge} onClick={onToggleRewind} />
          <RailButton label="Settings" icon={Settings01Icon} edge={edge} onClick={onOpenSettings} />
        </nav>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onToggleSidebarPosition}>Move sidebar to the {sidebarPosition === "left" ? "right" : "left"}</ContextMenuItem>
        {onHideSidebar && sidebarOpen ? <ContextMenuItem onSelect={onHideSidebar}>Hide sidebar</ContextMenuItem> : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}
