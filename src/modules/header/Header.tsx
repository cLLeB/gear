import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WindowControls } from "@/components/WindowControls";
import { IS_MAC, KEY_SEP, USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  getBindingTokens,
  shortcutDisplay,
  SHORTCUTS,
  type ShortcutId,
} from "@/modules/shortcuts/shortcuts";
import type { Tab } from "@/modules/tabs";
import { TabBar } from "@/modules/tabs";
import { NotificationBell } from "@/modules/agents";
import type { AgentLaunchRequest } from "@/modules/agents/lib/launcher";
import {
  Cancel01Icon,
  GridViewIcon,
  LayoutTwoColumnIcon,
  LayoutTwoRowIcon,
  Search01Icon,
  SidebarLeftIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "@/lib/utils";

import { useEffect, useRef, useState } from "react";

type Props = {
  tabs: Tab[];
  activeId: number;
  onSelect: (id: number) => void;
  onNew: () => void;
  onNewPrivate: () => void;
  onNewBlocks: () => void;
  onNewPreview: () => void;
  onNewEditor: () => void;
  onNewGitGraph: () => void;
  onLaunchAgents: (request: AgentLaunchRequest) => void;
  onClose: (id: number) => void;
  /** Promote a preview (transient) tab to persistent. */
  onPin: (id: number) => void;
  /** Set a terminal tab's custom label; empty string resets to default. */
  onRename: (id: number, title: string) => void;
  onReorder: (fromId: number, toId: number) => void;
  onToggleSidebar: () => void;
  onSplit: (dir: "row" | "col") => void;
  /** Active tab is a terminal and below the per-tab pane cap. */
  canSplit: boolean;
  onClosePane: () => void;
  /** Active terminal tab has more than one pane open. */
  canClosePane: boolean;
  onCloseOthers: (id: number) => void;
  onCloseTabs: (ids: number[]) => void;
  /** Run the active editor tab's file from the tab bar's run control. */
  onRun: () => void;
  /** Name of the config that would run the active file; null when none does. */
  runLabel: string | null;
  onActivateAgent: (tabId: number, leafId: number) => void;
  onActivateLocalAgent: () => void;
  /** Opens the command palette: commands, files, symbols. */
  onOpenPalette: () => void;
};



/** Header width in pixels under which the search box folds into an icon. */
const COMPACT_BELOW = 900;

export function Header({
  tabs,
  activeId,
  onSelect,
  onNew,
  onNewPrivate,
  onNewBlocks,
  onNewPreview,
  onNewEditor,
  onNewGitGraph,
  onLaunchAgents,
  onClose,
  onPin,
  onRename,
  onReorder,
  onToggleSidebar,
  onSplit,
  canSplit,
  onClosePane,
  canClosePane,
  onCloseOthers,
  onCloseTabs,
  onRun,
  runLabel,
  onActivateAgent,
  onActivateLocalAgent,
  onOpenPalette,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  // In a narrow window the search box folds into an icon, so there is always an
  // empty stretch of the bar left to drag the window by.
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => setCompact(el.clientWidth < COMPACT_BELOW);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const userShortcuts = usePreferencesStore((s) => s.shortcuts);

  const tokensFor = (id: ShortcutId): string => {
    const s = SHORTCUTS.find((s) => s.id === id);
    if (!s) return "";
    const bindings = userShortcuts[id] || s.defaultBindings;
    if (!bindings || bindings.length === 0) return "";
    return getBindingTokens(bindings[0]).join(KEY_SEP);
  };

  const splitRightTokens = tokensFor("pane.splitRight");
  const splitDownTokens = tokensFor("pane.splitDown");

  // Double-click on the drag region toggles maximize / restore.
  // Dragging itself is handled natively via data-tauri-drag-region.
  const handleDragRegionDoubleClick = () => {
    void getCurrentWindow().toggleMaximize();
  };

  return (
    <div
      ref={rootRef}
      className={`gear-frame-clear flex h-10 shrink-0 items-center gap-2 border-b border-border/60 bg-card select-none ${
        IS_MAC ? "pr-2 pl-20" : "pr-0 pl-2"
      }`}
    >
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          onClick={onToggleSidebar}
          title={`Toggle sidebar${shortcutDisplay("sidebar.toggle") ? ` (${shortcutDisplay("sidebar.toggle")})` : ""}`}
          variant="ghost"
          size="icon-sm"
          className="shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <HugeiconsIcon icon={SidebarLeftIcon} size={18} strokeWidth={1.75} />
        </Button>

      </div>

      {!IS_MAC && <span className="mx-1 h-5 w-px shrink-0 bg-border" />}

      {IS_MAC && <span className="mr-1 h-full w-px shrink-0 bg-border" />}

      {!IS_MAC && (
        <div className="flex h-10 shrink-0 items-center gap-1.5 pr-1" data-tauri-drag-region onDoubleClick={handleDragRegionDoubleClick}>
          <img src="/logo.png" alt="Gear" className="size-4 select-none opacity-90" draggable={false} data-tauri-drag-region />
          <span className="text-[11px] font-semibold tracking-tight text-foreground/60 select-none" data-tauri-drag-region>Gear</span>
          <span className="ml-0.5 h-3.5 w-px shrink-0 bg-border/70" />
        </div>
      )}

      <div
        className="flex min-w-0 flex-1 items-center gap-2"
        onContextMenu={(e) => {
          // Empty chrome falls through to the webview's own menu, whose Reload
          // restarts the webview and closes every shell. Per-tab menus still
          // open: Radix handles the trigger before this bubbles.
          e.preventDefault();
        }}
      >
        <TabBar
          tabs={tabs}
          activeId={activeId}
          onSelect={onSelect}
          onNew={onNew}
          onNewPrivate={onNewPrivate}
          onNewBlocks={onNewBlocks}
          onNewPreview={onNewPreview}
          onNewEditor={onNewEditor}
          onNewGitGraph={onNewGitGraph}
          onLaunchAgents={onLaunchAgents}
          onClose={onClose}
          onPin={onPin}
          onRename={onRename}
          onReorder={onReorder}
          onCloseOthers={onCloseOthers}
          onCloseTabs={onCloseTabs}
          onRun={onRun}
          runLabel={runLabel}
        />
        {/* Pane actions sit with the tabs they act on, and only for terminal tabs. */}
        {canSplit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" title="Split terminal" data-header-split>
                <HugeiconsIcon icon={GridViewIcon} size={15} strokeWidth={1.75} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-44">
              <DropdownMenuItem onSelect={() => onSplit("row")}>
                <HugeiconsIcon icon={LayoutTwoColumnIcon} size={14} strokeWidth={1.75} />
                <span className="flex-1">Split right</span>
                {splitRightTokens && <span className="text-xs text-muted-foreground">{splitRightTokens}</span>}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onSplit("col")}>
                <HugeiconsIcon icon={LayoutTwoRowIcon} size={14} strokeWidth={1.75} />
                <span className="flex-1">Split down</span>
                {splitDownTokens && <span className="text-xs text-muted-foreground">{splitDownTokens}</span>}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {canClosePane && (
          <Button variant="ghost" size="icon-sm" className="shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" title={`Close pane (${tokensFor("pane.close")})`} onClick={onClosePane} data-header-close-pane>
            <HugeiconsIcon icon={Cancel01Icon} size={15} strokeWidth={1.75} />
          </Button>
        )}
        <div
          data-tauri-drag-region
          // An explicit height: "h-full" of this centred row is zero, which left nothing to grab.
          className="h-10 min-w-12 flex-1"
          onDoubleClick={handleDragRegionDoubleClick}
        />
      </div>

      {/* Command centre: one entry to commands, files and symbols; find-in-pane is Ctrl/Cmd+F inside the pane. */}
      <button
        type="button"
        onClick={onOpenPalette}
        title={`Search or run a command${tokensFor("commandPalette.open") ? ` (${tokensFor("commandPalette.open")})` : ""}`}
        data-command-center
        className={cn(
          "flex h-7 shrink-0 items-center gap-2 rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
          compact ? "w-7 justify-center" : "w-72 border border-border/60 bg-muted/50 px-2.5 text-[12px]",
        )}
      >
        <HugeiconsIcon icon={Search01Icon} size={compact ? 15 : 13} strokeWidth={1.75} className="shrink-0" />
        {!compact && (
          <>
            <span className="min-w-0 flex-1 truncate text-left">Search or run a command…</span>
            <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground/80">{tokensFor("commandPalette.open")}</span>
          </>
        )}
      </button>

      {/* Notifications on the right on every platform; Settings lives at the foot of the activity rail. */}
      <NotificationBell onActivate={onActivateAgent} onActivateLocal={onActivateLocalAgent} />

      {USE_CUSTOM_WINDOW_CONTROLS && (
        <>
          <span className="ml-1 h-5 w-px shrink-0 bg-border" />
          <WindowControls />
        </>
      )}
    </div>
  );
}
