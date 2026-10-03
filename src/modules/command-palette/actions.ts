import type { SearchTarget } from "@/modules/header";
import type { ShortcutId } from "@/modules/shortcuts";
import { MAX_PANES_PER_TAB, type Tab } from "@/modules/tabs";
import { leafIds } from "@/modules/terminal";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  CodeIcon,
  FileEditIcon,
  Globe02Icon,
  IncognitoIcon,
  KeyboardIcon,
  LayoutTwoColumnIcon,
  LayoutTwoRowIcon,
  PlayIcon,
  Search01Icon,
  Settings01Icon,
  SidebarLeftIcon,
  SparklesIcon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";
import { CODE_ACTIONS, runCodeActionOnActiveEditor } from "@/modules/editor/lib/codeActions";
import { TEXT_ACTIONS } from "@/modules/editor/lib/textTools/commands";
import { PANE_ACTIONS, TERMINAL_ACTIONS, toggleBroadcast } from "@/modules/terminal";
import { TERMINAL_FEATURE_ACTIONS } from "@/modules/terminal/features";
import { RUN_TASK_ACTIONS } from "@/modules/run/taskActions";
import { WORKSPACE_ACTIONS } from "@/modules/workspace/actions";
import { pickClosedTab } from "@/modules/tabs/tabActions";
import { app } from "@/app/appBridge";

type CommandIcon = typeof TerminalIcon;

export type CommandPaletteActionGroup =
  | "General"
  | "Tabs"
  | "Panes"
  | "View"
  | "Search"
  | "Code"
  | "Terminal"
  | "Text"
  | "Git"
  | "Workspace"
  | "AI";

export type CommandPaletteAction = {
  id: string;
  label: string;
  group: CommandPaletteActionGroup;
  keywords: string[];
  icon: CommandIcon;
  shortcutId?: ShortcutId;
  disabledReason?: string;
  run: () => void;
  deferRun?: boolean;
};

export const COMMAND_PALETTE_ACTION_GROUPS: readonly CommandPaletteActionGroup[] =
  [
    "General",
    "Tabs",
    "Panes",
    "Terminal",
    "View",
    "Search",
    "Code",
    "Text",
    "Git",
    "Workspace",
    "AI",
  ] as const;

export type CommandPaletteActionContext = {
  tabs: Tab[];
  activeId: number;
  searchTarget: SearchTarget;
  explorerRoot: string | null;
  home: string | null;
  openNewTab: () => void;
  openNewPrivate: () => void;
  openNewEditor: () => void;
  openNewPreview: () => void;
  closeActiveTabOrPane: () => void;
  nextTab: () => void;
  previousTab: () => void;
  splitPaneRight: () => void;
  splitPaneDown: () => void;
  focusNextPane: () => void;
  focusPreviousPane: () => void;
  focusSearch: () => void;
  focusExplorerSearch: () => void;
  toggleSidebar: () => void;
  toggleAi: () => void;
  askAiSelection: () => void;
  /** Toggle the git blame gutter in the active editor. */
  toggleBlame: () => void;
  /** True when a file is open that blame can run against. */
  canBlame: boolean;
  openSettings: () => void;
  openShortcuts: () => void;
  runActiveFile: () => void;
  /** Name of the config that would run the active file; null when none does. */
  runLabel: string | null;
};

export function createCommandPaletteActions(
  ctx: CommandPaletteActionContext,
): CommandPaletteAction[] {
  const activeTab = ctx.tabs.find((tab) => tab.id === ctx.activeId);
  const activeTerminalTab = activeTab?.kind === "terminal" ? activeTab : null;
  const activePaneCount = activeTerminalTab
    ? leafIds(activeTerminalTab.paneTree).length
    : 0;
  const onlyOneTab = ctx.tabs.length < 2;
  const noWorkspaceRoot = !ctx.explorerRoot && !ctx.home;
  const splitPaneDisabledReason = !activeTerminalTab
    ? "No terminal tab"
    : activePaneCount >= MAX_PANES_PER_TAB
      ? "Pane limit"
      : undefined;
  const focusPaneDisabledReason = !activeTerminalTab
    ? "No terminal tab"
    : activePaneCount < 2
      ? "Only one pane"
      : undefined;
  const closeDisabledReason =
    onlyOneTab && activePaneCount < 2 ? "Last tab" : undefined;
  const activeEditorPath =
    activeTab?.kind === "editor" ? activeTab.path : null;
  const runDisabledReason = !activeEditorPath
    ? "No file open"
    : !ctx.runLabel
      ? "No run command for this file type"
      : undefined;

  return [
    {
      id: "settings.open",
      label: "Open settings",
      group: "General",
      keywords: ["preferences", "config"],
      icon: Settings01Icon,
      shortcutId: "settings.open",
      run: ctx.openSettings,
      deferRun: true,
    },
    {
      id: "shortcuts.open",
      label: "Show keyboard shortcuts",
      group: "General",
      keywords: ["keys", "keybindings", "help"],
      icon: KeyboardIcon,
      shortcutId: "shortcuts.open",
      run: ctx.openShortcuts,
      deferRun: true,
    },
    {
      id: "run.file",
      label: ctx.runLabel ? `Run current file (${ctx.runLabel})` : "Run current file",
      group: "Code",
      keywords: ["run", "execute", "start", "python", "node", "script"],
      icon: PlayIcon,
      shortcutId: "run.file",
      disabledReason: runDisabledReason,
      run: ctx.runActiveFile,
    },
    {
      id: "tab.new",
      label: "New terminal",
      group: "Tabs",
      keywords: ["shell", "terminal", "new tab"],
      icon: TerminalIcon,
      shortcutId: "tab.new",
      run: ctx.openNewTab,
    },
    {
      id: "tab.newPrivate",
      label: "New private terminal",
      group: "Tabs",
      keywords: ["privacy", "private", "incognito", "hidden from ai"],
      icon: IncognitoIcon,
      shortcutId: "tab.newPrivate",
      run: ctx.openNewPrivate,
    },
    {
      id: "tab.newEditor",
      label: "New editor tab",
      group: "Tabs",
      keywords: ["file", "editor", "create"],
      icon: FileEditIcon,
      shortcutId: "tab.newEditor",
      disabledReason: noWorkspaceRoot ? "No workspace root" : undefined,
      run: ctx.openNewEditor,
      deferRun: true,
    },
    {
      id: "tab.newPreview",
      label: "New preview tab",
      group: "Tabs",
      keywords: ["browser", "web", "localhost"],
      icon: Globe02Icon,
      shortcutId: "tab.newPreview",
      run: ctx.openNewPreview,
    },
    {
      id: "tab.close",
      label: "Close tab or pane",
      group: "Tabs",
      keywords: ["close", "remove", "pane"],
      icon: Cancel01Icon,
      shortcutId: "tab.close",
      disabledReason: closeDisabledReason,
      run: ctx.closeActiveTabOrPane,
    },
    {
      id: "tab.reopenClosed",
      label: "Reopen closed tab",
      group: "Tabs",
      keywords: ["undo close", "restore", "recent", "history"],
      icon: ArrowLeft01Icon,
      shortcutId: "tab.reopenClosed",
      run: () => {
        app().reopenClosedTab();
      },
    },
    {
      id: "tab.reopenClosedPick",
      label: "Reopen closed tab…",
      group: "Tabs",
      keywords: ["undo close", "restore", "recent", "history", "list"],
      icon: ArrowLeft01Icon,
      run: () => void pickClosedTab(),
      deferRun: true,
    },
    {
      id: "tab.next",
      label: "Next tab",
      group: "Tabs",
      keywords: ["switch", "right"],
      icon: ArrowRight01Icon,
      shortcutId: "tab.next",
      disabledReason: onlyOneTab ? "Only one tab" : undefined,
      run: ctx.nextTab,
    },
    {
      id: "tab.prev",
      label: "Previous tab",
      group: "Tabs",
      keywords: ["switch", "left"],
      icon: ArrowLeft01Icon,
      shortcutId: "tab.prev",
      disabledReason: onlyOneTab ? "Only one tab" : undefined,
      run: ctx.previousTab,
    },
    {
      id: "pane.splitRight",
      label: "Split pane right",
      group: "Panes",
      keywords: ["terminal", "pane", "split", "right", "column"],
      icon: LayoutTwoColumnIcon,
      shortcutId: "pane.splitRight",
      disabledReason: splitPaneDisabledReason,
      run: ctx.splitPaneRight,
    },
    {
      id: "pane.splitDown",
      label: "Split pane down",
      group: "Panes",
      keywords: ["terminal", "pane", "split", "down", "row"],
      icon: LayoutTwoRowIcon,
      shortcutId: "pane.splitDown",
      disabledReason: splitPaneDisabledReason,
      run: ctx.splitPaneDown,
    },
    {
      id: "pane.focusNext",
      label: "Focus next pane",
      group: "Panes",
      keywords: ["terminal", "pane", "focus", "next"],
      icon: ArrowRight01Icon,
      shortcutId: "pane.focusNext",
      disabledReason: focusPaneDisabledReason,
      run: ctx.focusNextPane,
    },
    {
      id: "pane.focusPrev",
      label: "Focus previous pane",
      group: "Panes",
      keywords: ["terminal", "pane", "focus", "previous"],
      icon: ArrowLeft01Icon,
      shortcutId: "pane.focusPrev",
      disabledReason: focusPaneDisabledReason,
      run: ctx.focusPreviousPane,
    },
    ...PANE_ACTIONS.map((action): CommandPaletteAction => ({
      id: action.id,
      label: action.label,
      group: "Panes",
      keywords: ["pane", "split", ...action.keywords],
      icon: LayoutTwoColumnIcon,
      shortcutId: action.id === "pane.toggleZoom" ? "pane.toggleZoom" : undefined,
      run: () => void action.run(),
      deferRun: true,
    })),
    {
      id: "terminal.toggleBroadcast",
      label: "Terminal: Toggle Broadcast Input",
      group: "Panes",
      keywords: ["broadcast", "sync", "terminals", "type all"],
      icon: KeyboardIcon,
      run: toggleBroadcast,
    },
    {
      id: "sidebar.toggle",
      label: "Toggle file explorer",
      group: "View",
      keywords: ["sidebar", "files", "explorer"],
      icon: SidebarLeftIcon,
      shortcutId: "sidebar.toggle",
      run: ctx.toggleSidebar,
    },
    {
      id: "explorer.search",
      label: "Search files",
      group: "Search",
      keywords: ["explorer", "workspace", "file search"],
      icon: Search01Icon,
      shortcutId: "explorer.search",
      disabledReason: ctx.explorerRoot ? undefined : "No workspace root",
      run: ctx.focusExplorerSearch,
      deferRun: true,
    },
    {
      id: "search.focus",
      label: "Focus search",
      group: "Search",
      keywords: ["find", "terminal", "editor"],
      icon: Search01Icon,
      shortcutId: "search.focus",
      disabledReason: ctx.searchTarget ? undefined : "No searchable view",
      run: ctx.focusSearch,
      deferRun: true,
    },
    {
      id: "editor.toggleBlame",
      label: "Toggle git blame",
      group: "Code",
      keywords: ["blame", "annotate", "git", "author", "history"],
      icon: CodeIcon,
      disabledReason: ctx.canBlame ? undefined : "No file open",
      run: ctx.toggleBlame,
      deferRun: true,
    },
    {
      id: "ai.toggle",
      label: "Toggle AI agent",
      group: "AI",
      keywords: ["assistant", "chat", "agent"],
      icon: SparklesIcon,
      shortcutId: "ai.toggle",
      run: ctx.toggleAi,
    },
    {
      id: "ai.askSelection",
      label: "Ask AI about selection",
      group: "AI",
      keywords: ["selection", "explain", "assistant", "chat"],
      icon: SparklesIcon,
      shortcutId: "ai.askSelection",
      run: ctx.askAiSelection,
    },
    ...[...TERMINAL_ACTIONS, ...TERMINAL_FEATURE_ACTIONS].map((action): CommandPaletteAction => ({
      id: action.id,
      label: action.label,
      group: "Terminal",
      keywords: ["terminal", ...action.keywords],
      icon: TerminalIcon,
      run: () => void action.run(),
      deferRun: true,
    })),
    ...[...RUN_TASK_ACTIONS, ...WORKSPACE_ACTIONS].map((action): CommandPaletteAction => ({
      id: action.id,
      label: action.label,
      group: "Workspace",
      keywords: ["workspace", "project", ...action.keywords],
      icon: PlayIcon,
      run: () => void action.run(),
      deferRun: true,
    })),
    // Code-intelligence actions from the in-process toolkit (src/lib/lang).
    // They operate on the last-focused editor; each reports or edits in place.
    ...CODE_ACTIONS.map((action): CommandPaletteAction => ({
      id: action.id,
      label: action.label,
      group: "Code",
      keywords: action.keywords,
      icon: CodeIcon,
      run: () => runCodeActionOnActiveEditor(action),
      deferRun: true,
    })),
    ...TEXT_ACTIONS.map((action): CommandPaletteAction => ({
      id: action.id,
      label: action.label,
      group: "Text",
      keywords: ["text", "editor", ...action.keywords],
      icon: FileEditIcon,
      run: () => runCodeActionOnActiveEditor(action),
      deferRun: true,
    })),
  ];
}
