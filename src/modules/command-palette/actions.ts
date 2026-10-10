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
import { clearEveryBookmark, listBookmarks, TEXT_ACTIONS } from "@/modules/editor/lib/textTools/commands";
import { DATA_TEXT_ACTIONS } from "@/modules/editor/lib/textTools/dataCommands";
import { MORE_TEXT_ACTIONS } from "@/modules/editor/lib/textTools/moreCommands";
import { FORMAT_ACTIONS } from "@/modules/tools/formatCommands";
import { TEXT3_ACTIONS } from "@/modules/editor/lib/textTools/text3Commands";
import { DATA2_ACTIONS } from "@/modules/tools/dataToolActions";
import { CODE_TOOL_ACTIONS, FILE_TOOL_ACTIONS } from "@/modules/editor/lib/textTools/codeCommands";
import { TOOL_ACTIONS } from "@/modules/tools/toolActions";
import { NET_ACTIONS } from "@/modules/tools/netActions";
import { copyPermalink, copyReference, openPermalink } from "@/modules/editor/lib/textTools/permalinkAction";
import { PANE_ACTIONS, TERMINAL_ACTIONS, toggleBroadcast } from "@/modules/terminal";
import { TERMINAL_FEATURE_ACTIONS } from "@/modules/terminal/features";
import { RUN_TASK_ACTIONS } from "@/modules/run/taskActions";
import { WORKSPACE_ACTIONS } from "@/modules/workspace/actions";
import { pickClosedTab, TAB_ACTIONS } from "@/modules/tabs/tabActions";
import { deleteSavedLayout, openSavedLayout, saveCurrentLayout } from "@/modules/tabs/layoutActions";
import { GIT_ACTIONS } from "@/modules/git-actions/actions";
import { GIT_EXTRA_ACTIONS } from "@/modules/git-actions/extraActions";
import { GIT_EXTRA_ACTIONS_2 } from "@/modules/git-actions/extraActions2";
import { GIT_EXTRA_ACTIONS_3 } from "@/modules/git-actions/extraActions3";
import { GIT_EXTRA_ACTIONS_4 } from "@/modules/git-actions/extraActions4";
import { MERGE_ACTIONS } from "@/modules/merge/mergeActions";
import { DEBUG_ACTIONS } from "@/modules/debug/debugActions";
import { TESTING_ACTIONS } from "@/modules/testing/actions";
import { NOTEBOOK_ACTIONS } from "@/modules/notebook/actions";
import { PROFILER_ACTIONS } from "@/modules/profiler/actions";
import { DATABASE_ACTIONS } from "@/modules/database/actions";
import { CONTAINER_ACTIONS } from "@/modules/containers/actions";
import { EXTENSION_ACTIONS } from "@/modules/extensions/actions";
import { REMOTE_ACTIONS } from "@/modules/remote/actions";
import { HTTP_ACTIONS } from "@/modules/http/actions";
import { THEME_ACTIONS } from "@/modules/theme/themeActions";
import { NOTIFICATION_ACTIONS } from "@/modules/notifications/actions";
import { COMPARE_ACTIONS } from "@/modules/compare/actions";
import { AI_TOOL_ACTIONS } from "@/modules/ai/tools/aiActions";
import { AI_TOOL_ACTIONS_2 } from "@/modules/ai/tools/aiActions2";
import { installThemeSchedule, UI_ACTIONS } from "@/modules/focus/uiActions";

installThemeSchedule();
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
  | "Tools"
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
    "Tools",
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
      id: "tab.saveLayout",
      label: "Tabs: Save layout…",
      group: "Tabs",
      keywords: ["layout", "launch configuration", "workspace", "split", "save", "preset"],
      icon: LayoutTwoColumnIcon,
      run: () => void saveCurrentLayout(),
      deferRun: true,
    },
    {
      id: "tab.openLayout",
      label: "Tabs: Open saved layout…",
      group: "Tabs",
      keywords: ["layout", "launch configuration", "workspace", "restore", "startup"],
      icon: LayoutTwoColumnIcon,
      run: () => void openSavedLayout(),
      deferRun: true,
    },
    {
      id: "tab.deleteLayout",
      label: "Tabs: Delete saved layout…",
      group: "Tabs",
      keywords: ["layout", "remove"],
      icon: LayoutTwoColumnIcon,
      run: () => void deleteSavedLayout(),
      deferRun: true,
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
    ...[...GIT_ACTIONS, ...GIT_EXTRA_ACTIONS, ...GIT_EXTRA_ACTIONS_2, ...GIT_EXTRA_ACTIONS_3, ...GIT_EXTRA_ACTIONS_4, ...MERGE_ACTIONS].map((action): CommandPaletteAction => ({
      id: action.id,
      label: action.label,
      group: "Git",
      keywords: ["git", ...action.keywords],
      icon: CodeIcon,
      run: () => void action.run(),
      deferRun: true,
    })),
    ...[...AI_TOOL_ACTIONS, ...AI_TOOL_ACTIONS_2].map((action): CommandPaletteAction => ({
      id: action.id,
      label: action.label,
      group: "AI",
      keywords: ["ai", ...action.keywords],
      icon: SparklesIcon,
      run: () => void action.run(),
      deferRun: true,
    })),
    ...[...DEBUG_ACTIONS, ...TESTING_ACTIONS, ...NOTEBOOK_ACTIONS, ...PROFILER_ACTIONS, ...DATABASE_ACTIONS, ...CONTAINER_ACTIONS, ...EXTENSION_ACTIONS, ...REMOTE_ACTIONS, ...HTTP_ACTIONS].map((action): CommandPaletteAction => ({
      id: action.id,
      label: action.label,
      group: "Code",
      keywords: ["debug", ...action.keywords],
      icon: SparklesIcon,
      run: () => void action.run(),
      deferRun: true,
    })),
    ...[...TOOL_ACTIONS, ...NET_ACTIONS].map((action): CommandPaletteAction => ({
      id: action.id,
      label: action.label,
      group: "Tools",
      keywords: ["tool", ...action.keywords],
      icon: SparklesIcon,
      run: () => void action.run(),
      deferRun: true,
    })),
    ...[...COMPARE_ACTIONS, ...FILE_TOOL_ACTIONS].map((action): CommandPaletteAction => ({
      id: action.id,
      label: action.label,
      group: "Text",
      keywords: ["text", ...action.keywords],
      icon: FileEditIcon,
      run: () => void action.run(),
      deferRun: true,
    })),
    ...TAB_ACTIONS.map((action): CommandPaletteAction => ({
      id: action.id,
      label: action.label,
      group: action.id.startsWith("panes.") ? "Panes" : "Tabs",
      keywords: ["tab", ...action.keywords],
      icon: LayoutTwoColumnIcon,
      run: () => void action.run(),
      deferRun: true,
    })),
    ...[...THEME_ACTIONS, ...NOTIFICATION_ACTIONS, ...UI_ACTIONS].map((action): CommandPaletteAction => ({
      id: action.id,
      label: action.label,
      group: "View",
      keywords: ["theme", ...action.keywords],
      icon: Settings01Icon,
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
    {
      id: "text.copyReference",
      label: "Copy reference to file / lines…",
      group: "Text",
      keywords: ["path", "relative", "absolute", "line", "markdown", "mention", "copy", "filename"],
      icon: FileEditIcon,
      run: () => void copyReference(),
      deferRun: true,
    },
    {
      id: "git.copyPermalink",
      label: "Git: Copy permalink to line(s)",
      group: "Git",
      keywords: ["github", "gitlab", "bitbucket", "link", "share", "url", "permalink", "remote"],
      icon: CodeIcon,
      run: () => void copyPermalink(),
      deferRun: true,
    },
    {
      id: "git.openOnRemote",
      label: "Git: Open line(s) on GitHub/GitLab…",
      group: "Git",
      keywords: ["github", "gitlab", "bitbucket", "browser", "remote", "web"],
      icon: Globe02Icon,
      run: () => void openPermalink(),
      deferRun: true,
    },
    {
      id: "text.listBookmarks",
      label: "List all bookmarks…",
      group: "Text",
      keywords: ["bookmark", "marks", "jump", "files"],
      icon: FileEditIcon,
      run: () => void listBookmarks(),
      deferRun: true,
    },
    {
      id: "text.clearAllBookmarks",
      label: "Clear all bookmarks (every file)",
      group: "Text",
      keywords: ["bookmark", "remove", "reset"],
      icon: FileEditIcon,
      run: clearEveryBookmark,
    },
    ...[...TEXT_ACTIONS, ...DATA_TEXT_ACTIONS, ...MORE_TEXT_ACTIONS, ...FORMAT_ACTIONS, ...CODE_TOOL_ACTIONS, ...TEXT3_ACTIONS, ...DATA2_ACTIONS].map((action): CommandPaletteAction => ({
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
