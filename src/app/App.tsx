import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { AgentNotificationsBridge } from "@/modules/agents";
import { useManagedAgentsStore } from "@/modules/agents/store/managedAgentsStore";
import { firePendingReviewForSession } from "@/modules/agents/lib/review";
import { Toaster } from "@/components/ui/sonner";
import {
  AgentRunBridge,
  AiInputBar,
  AiInputBarConnect,
  AiMiniWindow,
  getAllKeys,
  hasAnyKey,
  LocalAgentNotificationsBridge,
  SelectionAskAi,
  useChatStore,
} from "@/modules/ai";
import { AiComposerProvider } from "@/modules/ai/lib/composer";
import { redactSensitive } from "@/modules/ai/lib/redact";
import { native } from "@/modules/ai/lib/native";
import { useAgentsStore } from "@/modules/ai/store/agentsStore";
import { useSnippetsStore } from "@/modules/ai/store/snippetsStore";
import {
  AiDiffStack,
  EditorStack,
  GitDiffStack,
  NewEditorDialog,
  type EditorPaneHandle,
} from "@/modules/editor";
import {
  GitHistoryStack,
  type GitHistorySearchHandle,
} from "@/modules/git-history";
import { quoteShellArg } from "@/lib/shellQuote";
import { getLaunchDir } from "@/lib/launchDir";
import { useZoom } from "@/lib/useZoom";
import { FileExplorer, type FileExplorerHandle } from "@/modules/explorer";
import {
  CommandPalette,
  createCommandPaletteActions,
} from "@/modules/command-palette";
import {
  listenFsChanged,
  watchAdd,
  watchRemove,
} from "@/modules/explorer/lib/watch";
import {
  Header,
  type SearchInlineHandle,
  type SearchTarget,
} from "@/modules/header";
import { MarkdownStack } from "@/modules/markdown";
import { PreviewStack, type PreviewPaneHandle } from "@/modules/preview";
import { SettingsPane } from "@/settings/SettingsPane";
import type { SettingsViewTab } from "@/modules/tabs";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  getEffectiveDefaultModelId,
  useWorkspaceConfigStore,
} from "@/modules/settings/workspaceConfig";
import {
  onKeysChanged,
  setWordWrap,
  setSidebarPosition,
} from "@/modules/settings/store";
import {
  ShortcutsDialog,
  useGlobalShortcuts,
  type ShortcutHandlers,
  type ShortcutId,
} from "@/modules/shortcuts";
import { SidebarRail, type SidebarViewId } from "@/modules/sidebar";
import { SourceControlPanel, useSourceControl } from "@/modules/source-control";
import { StatusBar } from "@/modules/statusbar";
import { RewindPanel, useRewindStore } from "@/modules/rewind";
import { type SpaceMeta, SpaceSwitcher, useSpaces } from "@/modules/spaces";
import {
  DEFAULT_SPACE_ID,
  MAX_PANES_PER_TAB,
  useTabs,
  useWindowTitle,
  useWorkspaceCwd,
  type TerminalTab,
} from "@/modules/tabs";
import {
  clearFocusedTerminal,
  disposeSession,
  findLeafCwd,
  hasLeaf,
  leafHasForegroundProcess,
  leafIds,
  respawnSession,
  TerminalStack,
  useTerminalFileDrop,
  whenSessionReady,
  writeToSession,
  type TerminalPaneHandle,
} from "@/modules/terminal";
import {
  loadEditorPaths,
  loadSpacesMeta,
  loadTerminalTabs,
  saveEditorPaths,
  saveSpacesMeta,
  saveTerminalTabs,
} from "@/modules/terminal/lib/sessionPersistence";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useAppCloseGuard } from "./hooks/useAppCloseGuard";
import { ThemeProvider } from "@/modules/theme";
import { UpdaterDialog, WhatsNewDialog } from "@/modules/updater";
import {
  getWslHome,
  LOCAL_WORKSPACE,
  useWorkspaceEnvStore,
  type WorkspaceEnv,
} from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { SearchAddon } from "@xterm/addon-search";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";

type TuiWaitResult = "ready" | "gone" | "timeout";

async function waitForClaudeTuiReady(
  readBuf: () => string | null,
  timeoutMs = 8000,
): Promise<TuiWaitResult> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const buf = readBuf();
    if (buf === null) return "gone";
    if (buf.includes("shortcuts") || buf.includes("? for")) return "ready";
    await new Promise((r) => setTimeout(r, 120));
  }
  return "timeout";
}

function dirname(path: string | null): string | null {
  if (!path) return null;
  const normalized = path.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return normalized;
  return normalized.slice(0, idx);
}

const SIDEBAR_DEFAULT_WIDTH = 260;
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_WIDTH_STORAGE_KEY = "Gear.sidebar.width";
const SIDEBAR_VIEW_STORAGE_KEY = "Gear.sidebar.view";

function clampSidebarWidth(width: number): number {
  return Math.min(
    SIDEBAR_MAX_WIDTH,
    Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)),
  );
}

function readSidebarWidth(): number {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    const parsed = stored ? Number.parseInt(stored, 10) : NaN;
    return Number.isFinite(parsed)
      ? clampSidebarWidth(parsed)
      : SIDEBAR_DEFAULT_WIDTH;
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
}

function readSidebarView(): SidebarViewId {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_VIEW_STORAGE_KEY);
    if (stored === "explorer" || stored === "source-control") return stored;
  } catch {
    // ignore
  }
  return "explorer";
}

export default function App() {
  // Load persisted terminal sessions once on mount. If the app was launched
  // from a directory (CLI/Finder), we skip restoration and use that directory.
  const [restoredSessions] = useState(() =>
    getLaunchDir() ? null : loadTerminalTabs(),
  );
  const [restoredEditorPaths] = useState(() =>
    getLaunchDir() ? null : loadEditorPaths(),
  );

  const {
    tabs,
    activeId,
    setActiveId,
    newTab,
    newBlockTab,
    setActiveSpaceForNewTabs,
    moveTabToSpace,
    reassignSpaceTabs,
    setTabLanguage,
    newAgentTab,
    newPrivateTab,
    openFileTab,
    pinTab,
    newPreviewTab,
    newMarkdownTab,
    openAiDiffTab,
    closeAiDiffTab,
    openGitDiffTab,
    openCommitHistoryTab,
    openCommitFileDiffTab,
    closeTab,
    updateTab,
    selectByIndex,
    setLeafCwd,
    setLeafName,
    reorderTabs,
    focusPane,
    focusNextPaneInTab,
    splitActivePane,
    closeActivePane,
    closeOtherTabs,
    closePaneByLeaf,
    resetWorkspace,
    openSettingsTab,
  } = useTabs();

  // Open tabs 2..N from the restored session list after first mount.
  // Also re-open editor files that were open in the previous session.
  const restoredRef = useRef(restoredSessions);
  const restoredEditorPathsRef = useRef(restoredEditorPaths);
  useEffect(() => {
    const sessions = restoredRef.current;
    if (sessions && sessions.length > 1) {
      for (const s of sessions.slice(1)) {
        const id = newTab(s.cwd);
        if (s.spaceId && s.spaceId !== DEFAULT_SPACE_ID) {
          moveTabToSpace(id, s.spaceId);
        }
      }
    }
    const editorPaths = restoredEditorPathsRef.current;
    if (editorPaths) {
      for (const path of editorPaths) {
        openFileTab(path, true);
      }
    }
    // intentionally empty deps — runs once after mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror `tabs` into a ref so callbacks scheduled with `setTimeout`
  // (e.g. cdInNewTab) read the latest pane state instead of a stale closure.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  // Confirm before quitting while a terminal still has a running process.
  const { pendingAppClose, confirmAppClose, cancelAppClose } =
    useAppCloseGuard(tabsRef);

  // Persist terminal tabs and editor paths to localStorage for restore on relaunch.
  useEffect(() => {
    const toSave = tabs
      .filter((t): t is TerminalTab => t.kind === "terminal" && !t.private)
      .map((t) => ({ title: t.title, cwd: t.cwd, spaceId: t.spaceId }));
    const editorPaths = tabs
      .filter((t) => t.kind === "editor" && !("preview" in t && t.preview))
      .map((t) => (t as { path: string }).path);
    const id = window.setTimeout(() => {
      saveTerminalTabs(toSave);
      saveEditorPaths(editorPaths);
    }, 600);
    return () => window.clearTimeout(id);
  }, [tabs]);

  const activeTerminalTab = useMemo(() => {
    const t = tabs.find((x) => x.id === activeId);
    return t && t.kind === "terminal" ? t : null;
  }, [tabs, activeId]);
  const activeLeafId = activeTerminalTab?.activeLeafId ?? null;

  const searchAddons = useRef<Map<number, SearchAddon>>(new Map());
  const [activeSearchAddon, setActiveSearchAddon] =
    useState<SearchAddon | null>(null);
  const searchInlineRef = useRef<SearchInlineHandle | null>(null);
  const terminalRefs = useRef<Map<number, TerminalPaneHandle>>(new Map());
  const editorRefs = useRef<Map<number, EditorPaneHandle>>(new Map());
  const previewRefs = useRef<Map<number, PreviewPaneHandle>>(new Map());
  const [activeEditorHandle, setActiveEditorHandle] =
    useState<EditorPaneHandle | null>(null);
  const [gitHistoryHandle, setGitHistoryHandle] =
    useState<GitHistorySearchHandle | null>(null);
  const { zoomIn, zoomOut, zoomReset } = useZoom();
  useTerminalFileDrop();
  const explorerRef = useRef<FileExplorerHandle>(null);
  const explorerReturnFocusRef = useRef<HTMLElement | null>(null);

  const sidebarRef = useRef<PanelImperativeHandle | null>(null);
  const sidebarWidthRef = useRef(readSidebarWidth());
  const sidebarWidthWriteTimerRef = useRef(0);
  const [sidebarView, setSidebarViewState] =
    useState<SidebarViewId>(readSidebarView);
  // Reactive expanded/collapsed state for the sidebar content panel, so the
  // activity rail can reflect which view (if any) is currently visible.
  const [sidebarOpen] = useState(true);
  const persistSidebarView = useCallback((view: SidebarViewId) => {
    setSidebarViewState(view);
    try {
      window.localStorage.setItem(SIDEBAR_VIEW_STORAGE_KEY, view);
    } catch {
      // storage may fail in private mode
    }
  }, []);
  const toggleSidebar = useCallback(() => {
    const p = sidebarRef.current;
    if (!p) return;
    if (p.getSize().asPercentage <= 0) p.expand();
    else p.collapse();
  }, []);
  const cycleSidebarView = useCallback(
    (view: SidebarViewId) => {
      const panel = sidebarRef.current;
      const collapsed = panel ? panel.getSize().asPercentage <= 0 : false;
      if (collapsed) {
        if (panel) panel.resize(`${sidebarWidthRef.current}px`);
        if (view !== sidebarView) persistSidebarView(view);
        return;
      }
      if (view === sidebarView) {
        panel?.collapse();
        return;
      }
      persistSidebarView(view);
    },
    [persistSidebarView, sidebarView],
  );
  const persistSidebarWidth = useCallback((next: number) => {
    sidebarWidthRef.current = next;
    if (sidebarWidthWriteTimerRef.current) {
      window.clearTimeout(sidebarWidthWriteTimerRef.current);
    }
    sidebarWidthWriteTimerRef.current = window.setTimeout(() => {
      sidebarWidthWriteTimerRef.current = 0;
      try {
        window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(next));
      } catch {
        // ignore
      }
    }, 200);
  }, []);
  useEffect(() => {
    return () => {
      if (sidebarWidthWriteTimerRef.current) {
        window.clearTimeout(sidebarWidthWriteTimerRef.current);
      }
    };
  }, []);

  const toggleExplorerFocus = useCallback(() => {
    const explorer = explorerRef.current;
    const panel = sidebarRef.current;
    const collapsed = panel ? panel.getSize().asPercentage <= 0 : false;
    if (sidebarView !== "explorer" || collapsed) {
      if (panel && collapsed) panel.resize(`${sidebarWidthRef.current}px`);
      if (sidebarView !== "explorer") persistSidebarView("explorer");
      const active = document.activeElement;
      explorerReturnFocusRef.current =
        active instanceof HTMLElement && active !== document.body
          ? active
          : null;
      requestAnimationFrame(() => explorerRef.current?.focus());
      return;
    }
    if (!explorer) return;
    if (explorer.isFocused()) {
      const target = explorerReturnFocusRef.current;
      explorerReturnFocusRef.current = null;
      if (target && document.body.contains(target)) {
        target.focus();
      } else {
        (document.activeElement as HTMLElement | null)?.blur?.();
      }
      return;
    }
    const active = document.activeElement;
    explorerReturnFocusRef.current =
      active instanceof HTMLElement && active !== document.body ? active : null;
    explorer.focus();
  }, [persistSidebarView, sidebarView]);

  const [home, setHome] = useState<string | null>(null);
  const [pendingCloseTab, setPendingCloseTab] = useState<number | null>(null);
  const [pendingTerminalCloseTab, setPendingTerminalCloseTab] = useState<
    number | null
  >(null);
  const workspaceEnv = useWorkspaceEnvStore((s) => s.env);
  const setWorkspaceEnv = useWorkspaceEnvStore((s) => s.setEnv);
  const [launchCwd, setLaunchCwd] = useState<string | null>(null);

  // ── Spaces (in-session tab groups) ─────────────────────────────────────────
  const activeSpaceId = useSpaces((s) => s.activeId) ?? DEFAULT_SPACE_ID;
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const spacesList = useSpaces((s) => s.spaces);

  // Restore persisted spaces, or seed a single default space. The default
  // space's id IS DEFAULT_SPACE_ID, so existing/undefined-space tabs belong to
  // it and stay visible. Defensive: any failure falls back to the default so
  // startup can never break.
  useEffect(() => {
    const st = useSpaces.getState();
    if (st.spaces.length > 0) return;
    try {
      const saved = loadSpacesMeta();
      if (saved && saved.spaces.length > 0) {
        st.hydrate(
          saved.spaces as SpaceMeta[],
          saved.activeId ?? DEFAULT_SPACE_ID,
        );
        return;
      }
    } catch {
      // fall through to default
    }
    const now = Date.now();
    st.hydrate(
      [
        {
          id: DEFAULT_SPACE_ID,
          name: "Main",
          root: null,
          env: workspaceEnv,
          createdAt: now,
          updatedAt: now,
        },
      ],
      DEFAULT_SPACE_ID,
    );
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the spaces list + active space (debounced) for restore on relaunch.
  useEffect(() => {
    if (spacesList.length === 0) return;
    const id = window.setTimeout(
      () => saveSpacesMeta({ spaces: spacesList, activeId: activeSpaceId }),
      600,
    );
    return () => window.clearTimeout(id);
  }, [spacesList, activeSpaceId]);

  // Only the active space's tabs appear in the tab strip; all tabs stay mounted
  // so switching spaces never tears down a background terminal's PTY.
  const spaceTabs = useMemo(
    () => tabs.filter((t) => (t.spaceId ?? DEFAULT_SPACE_ID) === activeSpaceId),
    [tabs, activeSpaceId],
  );

  useEffect(() => {
    setActiveSpaceForNewTabs(activeSpaceId);
    const inSpace = tabsRef.current.filter(
      (t) => (t.spaceId ?? DEFAULT_SPACE_ID) === activeSpaceId,
    );
    if (inSpace.length > 0 && !inSpace.some((t) => t.id === activeId)) {
      setActiveId(inSpace[inSpace.length - 1].id);
    }
  }, [activeSpaceId, activeId, setActiveSpaceForNewTabs, setActiveId]);

  const handleNewSpace = useCallback(() => {
    const st = useSpaces.getState();
    const meta = st.create({
      name: `Space ${st.spaces.length + 1}`,
      root: null,
      env: workspaceEnv,
    });
    setActiveSpaceForNewTabs(meta.id);
    st.setActive(meta.id);
    newTab();
  }, [workspaceEnv, setActiveSpaceForNewTabs, newTab]);

  const handleDeleteSpace = useCallback(
    (id: string) => {
      const next = useSpaces.getState().remove(id);
      if (!next) return; // refuses to delete the last space
      reassignSpaceTabs(id, next);
    },
    [reassignSpaceTabs],
  );

  const handleNewTabInSpace = useCallback(
    (spaceId: string) => {
      useSpaces.getState().setActive(spaceId);
      setActiveSpaceForNewTabs(spaceId);
      newTab();
    },
    [newTab, setActiveSpaceForNewTabs],
  );

  const handleJumpTab = useCallback(
    (tabId: number) => {
      const t = tabsRef.current.find((x) => x.id === tabId);
      if (!t) return;
      setActiveId(tabId);
      useSpaces.getState().setActive(t.spaceId ?? DEFAULT_SPACE_ID);
      setSwitcherOpen(false);
    },
    [setActiveId],
  );

  const handleMoveTabToSpace = useCallback(
    (tabId: number, targetSpaceId: string) => {
      moveTabToSpace(tabId, targetSpaceId);
      useSpaces.getState().setActive(targetSpaceId);
    },
    [moveTabToSpace],
  );

  // Dropping a tab onto another tab: if they're in different spaces, move the
  // dragged tab into the target's space (drag-to-organize across spaces).
  const handleReorderTabAcrossSpaces = useCallback(
    (tabId: number, targetTabId: number) => {
      const all = tabsRef.current;
      const moved = all.find((t) => t.id === tabId);
      const target = all.find((t) => t.id === targetTabId);
      if (!moved || !target) return;
      const targetSpace = target.spaceId ?? DEFAULT_SPACE_ID;
      if ((moved.spaceId ?? DEFAULT_SPACE_ID) !== targetSpace) {
        moveTabToSpace(tabId, targetSpace);
        useSpaces.getState().setActive(targetSpace);
      }
    },
    [moveTabToSpace],
  );
  const [launchCwdResolved, setLaunchCwdResolved] = useState(false);
  const [pendingDeleteTabs, setPendingDeleteTabs] = useState<number[] | null>(
    null,
  );
  useEffect(() => {
    homeDir()
      .then(async (p) => {
        const normalized = p.replace(/\\/g, "/");
        setHome(normalized);
        try {
          await native.workspaceAuthorize(normalized);
        } catch {
          // Bootstrap already authorizes home from Rust; ignore.
        }
      })
      .catch(() => setHome(null));
  }, []);

  const switchWorkspace = useCallback(
    async (env: WorkspaceEnv) => {
      if (
        env.kind === workspaceEnv.kind &&
        (env.kind === "local" ||
          (workspaceEnv.kind === "wsl" && env.distro === workspaceEnv.distro))
      ) {
        return;
      }
      const dirty = tabsRef.current.some((t) => t.kind === "editor" && t.dirty);
      if (dirty) {
        window.alert(
          "Save or close unsaved editor tabs before switching workspace.",
        );
        return;
      }

      let nextHome: string | null = null;
      try {
        if (env.kind === "wsl") {
          nextHome = await getWslHome(env.distro);
        } else {
          nextHome = (await homeDir()).replace(/\\/g, "/");
        }
      } catch (e) {
        window.alert(String(e));
        return;
      }

      for (const id of liveLeavesRef.current) disposeSession(id);
      searchAddons.current.clear();
      terminalRefs.current.clear();
      editorRefs.current.clear();
      previewRefs.current.clear();
      setActiveSearchAddon(null);
      setActiveEditorHandle(null);
      setWorkspaceEnv(env.kind === "local" ? LOCAL_WORKSPACE : env);
      setHome(nextHome);
      setLaunchCwd(nextHome);
      if (nextHome) {
        try {
          await native.workspaceAuthorize(nextHome);
        } catch {
          // Non-fatal — git panel will surface "not authorized" if needed.
        }
      }
      resetWorkspace(nextHome ?? undefined);
    },
    [workspaceEnv, setWorkspaceEnv, resetWorkspace],
  );
  useEffect(() => {
    native
      .workspaceCurrentDir()
      .then(setLaunchCwd)
      .catch(() => setLaunchCwd(null))
      .finally(() => setLaunchCwdResolved(true));
  }, []);

  // Listen for openSettingsWindow() calls from any module.
  useEffect(() => {
    const handler = (e: Event) => {
      const section = (e as CustomEvent<string | null>).detail ?? undefined;
      openSettingsTab(section);
    };
    window.addEventListener("Gear:open-settings", handler);
    return () => window.removeEventListener("Gear:open-settings", handler);
  }, [openSettingsTab]);

  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [zenMode, setZenMode] = useState(false);
  const [newEditorOpen, setNewEditorOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const miniOpen = useChatStore((s) => s.mini.open);
  const openMini = useChatStore((s) => s.openMini);
  const focusInput = useChatStore((s) => s.focusInput);
  const openPanel = useChatStore((s) => s.openPanel);
  const panelOpen = useChatStore((s) => s.panelOpen);
  const apiKeys = useChatStore((s) => s.apiKeys);
  const setApiKeys = useChatStore((s) => s.setApiKeys);
  const setSelectedModelId = useChatStore((s) => s.setSelectedModelId);
  const setLive = useChatStore((s) => s.setLive);
  const respondToApproval = useChatStore((s) => s.respondToApproval);
  const lmstudioModelId = usePreferencesStore((s) => s.lmstudioModelId);
  const lmstudioBaseURL = usePreferencesStore((s) => s.lmstudioBaseURL);
  const mlxModelId = usePreferencesStore((s) => s.mlxModelId);
  const mlxBaseURL = usePreferencesStore((s) => s.mlxBaseURL);
  const ollamaModelId = usePreferencesStore((s) => s.ollamaModelId);
  const ollamaBaseURL = usePreferencesStore((s) => s.ollamaBaseURL);
  const openaiCompatibleModelId = usePreferencesStore(
    (s) => s.openaiCompatibleModelId,
  );
  const openaiCompatibleBaseURL = usePreferencesStore(
    (s) => s.openaiCompatibleBaseURL,
  );
  const openrouterModelId = usePreferencesStore((s) => s.openrouterModelId);
  const hasLocalModel =
    (lmstudioBaseURL.trim().length > 0 && lmstudioModelId.trim().length > 0) ||
    (mlxBaseURL.trim().length > 0 && mlxModelId.trim().length > 0) ||
    (ollamaBaseURL.trim().length > 0 && ollamaModelId.trim().length > 0) ||
    (openaiCompatibleBaseURL.trim().length > 0 &&
      openaiCompatibleModelId.trim().length > 0) ||
    openrouterModelId.trim().length > 0;
  const hasComposer = hasAnyKey(apiKeys) || hasLocalModel;

  const [keysLoaded, setKeysLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    const reload = () => {
      void getAllKeys().then((keys) => {
        if (!alive) return;
        setApiKeys(keys);
        setKeysLoaded(true);
      });
    };
    reload();
    const unlistenP = onKeysChanged(reload);
    return () => {
      alive = false;
      void unlistenP.then((fn) => fn());
    };
  }, [setApiKeys]);

  // Hydrate the cross-window preference store and mirror the default model
  // into chatStore so the dropdown reflects what the user picked in Settings.
  const initPrefs = usePreferencesStore((s) => s.init);
  const prefDefaultModel = usePreferencesStore((s) => s.defaultModelId);
  const prefsHydrated = usePreferencesStore((s) => s.hydrated);
  const wordWrap = usePreferencesStore((s) => s.wordWrap);
  const sidebarPosition = usePreferencesStore((s) => s.sidebarPosition);
  const wsConfig = useWorkspaceConfigStore((s) => s.config);
  useEffect(() => {
    void initPrefs();
  }, [initPrefs]);
  useEffect(() => {
    if (!prefsHydrated) return;
    setSelectedModelId(getEffectiveDefaultModelId(prefDefaultModel));
  }, [prefsHydrated, prefDefaultModel, wsConfig, setSelectedModelId]);

  const hydrateSessions = useChatStore((s) => s.hydrateSessions);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  useEffect(() => {
    void hydrateSessions();
    void useAgentsStore.getState().hydrate();
    void useSnippetsStore.getState().hydrate();
  }, [hydrateSessions]);

  useEffect(() => {
    if (activeSessionId) firePendingReviewForSession(activeSessionId);
  }, [activeSessionId]);

  const activeTab = tabs.find((t) => t.id === activeId);
  const isTerminalTab = activeTab?.kind === "terminal";
  const isEditorTab = activeTab?.kind === "editor";
  const isPreviewTab = activeTab?.kind === "preview";
  const isMarkdownTab = activeTab?.kind === "markdown";
  const isAiDiffTab = activeTab?.kind === "ai-diff";
  const isGitDiffTab =
    activeTab?.kind === "git-diff" || activeTab?.kind === "git-commit-file";
  const isGitHistoryTab = activeTab?.kind === "git-history";
  const isSettingsTab = activeTab?.kind === "settings";
  const settingsTab = tabs.find((t) => t.kind === "settings") as
    | SettingsViewTab
    | undefined;

  // When an AI diff is approved (write_file applied to disk), reload any
  // open editor tabs for that path so the user sees the new content. We
  // track which approvalIds we've already handled to fire the reload only
  // once per applied diff.
  const appliedDiffsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const t of tabs) {
      if (t.kind !== "ai-diff") continue;
      if (t.status !== "approved") continue;
      if (appliedDiffsRef.current.has(t.approvalId)) continue;
      appliedDiffsRef.current.add(t.approvalId);
      for (const e of tabs) {
        if (e.kind !== "editor") continue;
        if (e.path !== t.path) continue;
        editorRefs.current.get(e.id)?.reload();
      }
    }
  }, [tabs]);

  useEffect(() => {
    type FileWrittenPayload = { path: string; source?: string };
    const unlistenPromise =
      getCurrentWebviewWindow().listen<FileWrittenPayload>(
        "fs:file-written",
        (event) => {
          if (event.payload.source === "editor") return;
          const normalizedPath = event.payload.path.replace(/\\/g, "/");
          const currentTabs = tabsRef.current;
          for (const t of currentTabs) {
            if (t.kind !== "editor") continue;
            if (t.path.replace(/\\/g, "/") === normalizedPath) {
              editorRefs.current.get(t.id)?.reload();
            }
          }
        },
      );
    return () => {
      void unlistenPromise.then((un) => un());
    };
  }, []);

  // Watch parent dirs of open editor files so external changes trigger reload.
  const editorWatchRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const newDirs = new Set<string>();
    for (const t of tabs) {
      if (t.kind === "editor") {
        const d = dirname(t.path);
        if (d) newDirs.add(d);
      }
    }
    const added = [...newDirs].filter((d) => !editorWatchRef.current.has(d));
    const removed = [...editorWatchRef.current].filter((d) => !newDirs.has(d));
    if (added.length > 0) watchAdd(added);
    if (removed.length > 0) watchRemove(removed);
    editorWatchRef.current = newDirs;
  }, [tabs]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listenFsChanged((paths) => {
      const currentTabs = tabsRef.current;
      for (const changed of paths) {
        const norm = changed.replace(/\\/g, "/");
        for (const t of currentTabs) {
          if (t.kind !== "editor") continue;
          if (t.path.replace(/\\/g, "/") === norm) {
            editorRefs.current.get(t.id)?.reload();
          }
        }
      }
    })
      .then((u) => {
        unlisten = u;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  const { explorerRoot, inheritedCwdForNewTab } = useWorkspaceCwd(
    activeTab,
    tabs,
    launchCwd ?? home,
  );

  useWindowTitle(activeTab, explorerRoot);

  useEffect(() => {
    void useWorkspaceConfigStore.getState().load(explorerRoot);
  }, [explorerRoot]);

  useEffect(() => {
    setActiveSearchAddon(
      activeLeafId !== null
        ? (searchAddons.current.get(activeLeafId) ?? null)
        : null,
    );
    setActiveEditorHandle(editorRefs.current.get(activeId) ?? null);
  }, [activeId, activeLeafId]);

  const handleSearchReady = useCallback(
    (leafId: number, addon: SearchAddon) => {
      searchAddons.current.set(leafId, addon);
      if (leafId === activeLeafId) setActiveSearchAddon(addon);
    },
    [activeLeafId],
  );

  const disposeTab = useCallback(
    (id: number) => {
      // Terminal-leaf-keyed maps (terminalRefs/searchAddons) are pruned by
      // the effect below as the pane tree changes; only the tab-id-keyed
      // handles need explicit cleanup here.
      editorRefs.current.delete(id);
      previewRefs.current.delete(id);
      closeTab(id);
    },
    [closeTab],
  );

  // Drives session disposal off the pane tree, not React lifecycles —
  // split/unsplit re-mount components but the leaf is still live.
  const liveLeavesRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const live = new Set<number>();
    for (const t of tabs) {
      if (t.kind === "terminal") {
        for (const id of leafIds(t.paneTree)) live.add(id);
      }
    }
    for (const id of liveLeavesRef.current) {
      if (!live.has(id)) disposeSession(id);
    }
    liveLeavesRef.current = live;
    for (const k of [...terminalRefs.current.keys()])
      if (!live.has(k)) terminalRefs.current.delete(k);
    for (const k of [...searchAddons.current.keys()])
      if (!live.has(k)) searchAddons.current.delete(k);
  }, [tabs]);

  const handleClose = useCallback(
    async (id: number) => {
      const t = tabs.find((x) => x.id === id);
      if (t?.kind === "editor" && t.dirty) {
        setPendingCloseTab(id);
        return;
      }
      if (t?.kind === "terminal") {
        const leaves = leafIds(t.paneTree);
        const checks = await Promise.all(leaves.map(leafHasForegroundProcess));
        if (checks.some(Boolean)) {
          setPendingTerminalCloseTab(id);
          return;
        }
      }
      disposeTab(id);
    },
    [tabs, disposeTab],
  );

  const confirmClose = useCallback(() => {
    if (pendingCloseTab !== null) {
      disposeTab(pendingCloseTab);
      setPendingCloseTab(null);
    }
  }, [pendingCloseTab, disposeTab]);

  const cancelClose = useCallback(() => {
    setPendingCloseTab(null);
  }, []);

  const cycleTab = useCallback(
    (delta: 1 | -1) => {
      if (tabs.length < 2) return;
      const idx = tabs.findIndex((t) => t.id === activeId);
      const nextIdx = (idx + delta + tabs.length) % tabs.length;
      setActiveId(tabs[nextIdx].id);
    },
    [tabs, activeId, setActiveId],
  );

  const captureActiveSelection = useCallback((): string | null => {
    const t = tabs.find((x) => x.id === activeId);
    if (!t) return null;
    if (t.kind === "terminal") {
      const lid = t.activeLeafId;
      return terminalRefs.current.get(lid)?.getSelection() ?? null;
    }
    if (t.kind === "editor") {
      return editorRefs.current.get(activeId)?.getSelection() ?? null;
    }
    return null;
  }, [tabs, activeId]);

  const togglePanelAndFocus = useCallback(() => {
    if (!hasComposer) {
      openSettingsTab("models");
      return;
    }
    if (panelOpen) {
      useChatStore.getState().closePanel();
    } else {
      openPanel();
      focusInput(null);
    }
  }, [panelOpen, openPanel, focusInput, hasComposer, openSettingsTab]);

  const attachSelection = useChatStore((s) => s.attachSelection);

  const handleAttachFileToAgent = useCallback(
    (path: string) => {
      // Dispatch a window event the composer listens for. Same pattern as
      // selections — keeps file-explorer decoupled from the AI module.
      window.dispatchEvent(
        new CustomEvent<string>("Gear:ai-attach-file", { detail: path }),
      );
      openPanel();
      focusInput(null);
    },
    [openPanel, focusInput],
  );

  const askFromSelection = useCallback(
    (prefix = "") => {
      const selection = captureActiveSelection();
      if (!selection || !selection.trim()) {
        focusInput(null);
        return;
      }
      const source: "terminal" | "editor" =
        activeTab?.kind === "editor" ? "editor" : "terminal";
      const text = prefix ? `${prefix}${selection}` : selection;
      attachSelection(text, source);
    },
    [captureActiveSelection, focusInput, attachSelection, activeTab],
  );

  const [askPopup, setAskPopup] = useState<{ x: number; y: number } | null>(
    null,
  );

  useEffect(() => {
    const isInsideAi = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      return !!(
        el.closest("[data-selection-ask-ai]") ||
        el.closest("[data-ai-input-bar]") ||
        el.closest("[data-ai-mini-window]")
      );
    };

    const onDown = (e: MouseEvent) => {
      if (isInsideAi(e.target)) return;
      setAskPopup(null);
    };
    const onUp = (e: MouseEvent) => {
      if (isInsideAi(e.target)) return;
      const el = e.target as HTMLElement | null;
      const inContentArea = el?.closest?.(".xterm, .cm-editor");
      if (!inContentArea) return;
      // Defer one tick so xterm/CodeMirror finalize the selection.
      setTimeout(() => {
        const text = captureActiveSelection();
        if (text && text.trim().length > 0) {
          setAskPopup({ x: e.clientX, y: e.clientY });
        } else {
          setAskPopup(null);
        }
      }, 0);
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("mouseup", onUp);
    };
  }, [captureActiveSelection]);

  const onAskFromSelection = useCallback(
    (prefix = "") => {
      askFromSelection(prefix);
      setAskPopup(null);
    },
    [askFromSelection],
  );

  const openNewTab = useCallback((shellPath?: string) => {
    newTab(inheritedCwdForNewTab(), shellPath);
  }, [newTab, inheritedCwdForNewTab]);

  const openNewPrivateTab = useCallback(() => {
    newPrivateTab(inheritedCwdForNewTab());
  }, [newPrivateTab, inheritedCwdForNewTab]);

  const openBlockTab = useCallback(() => {
    newBlockTab(inheritedCwdForNewTab());
  }, [newBlockTab, inheritedCwdForNewTab]);

  const sendCd = useCallback(
    (path: string) => {
      if (activeLeafId === null) return;
      const term = terminalRefs.current.get(activeLeafId);
      if (!term) return;
      term.write(`cd ${quoteShellArg(path)}\r`);
      term.focus();
    },
    [activeLeafId],
  );

  const cdInNewTab = useCallback(
    (path: string) => {
      const tabId = newTab(path);
      setTimeout(() => {
        const tab = tabsRef.current.find((x) => x.id === tabId);
        if (!tab || tab.kind !== "terminal") return;
        const t = terminalRefs.current.get(tab.activeLeafId);
        if (!t) return;
        t.write(`cd ${quoteShellArg(path)}\r`);
        t.focus();
      }, 80);
    },
    [newTab],
  );

  const handleOpenFile = useCallback(
    (path: string, pin?: boolean) => {
      // Markdown opens rendered by default; the preview has an "Edit raw"
      // button that reopens it in the code editor.
      const ext = path.split(".").pop()?.toLowerCase();
      if (ext === "md" || ext === "markdown") {
        newMarkdownTab(path);
        return;
      }
      // Explorer defaults to preview (pin=false); explicit actions like
      // context-menu "Open" pass pin=true for a persistent tab.
      // We default to pin=true so files open in new persistent tabs instead of replacing.
      openFileTab(path, pin ?? true);
    },
    [openFileTab, newMarkdownTab],
  );

  const handlePathRenamed = useCallback(
    (from: string, to: string) => {
      for (const t of tabs) {
        if (t.kind !== "editor") continue;
        if (t.path === from) {
          const i = to.lastIndexOf("/");
          updateTab(t.id, { path: to, title: i === -1 ? to : to.slice(i + 1) });
        } else if (t.path.startsWith(`${from}/`)) {
          const suffix = t.path.slice(from.length);
          const newPath = `${to}${suffix}`;
          const i = newPath.lastIndexOf("/");
          updateTab(t.id, {
            path: newPath,
            title: i === -1 ? newPath : newPath.slice(i + 1),
          });
        }
      }
    },
    [tabs, updateTab],
  );

  const confirmDeleteClose = useCallback(() => {
    if (pendingDeleteTabs !== null) {
      for (const id of pendingDeleteTabs) disposeTab(id);
      setPendingDeleteTabs(null);
    }
  }, [pendingDeleteTabs, disposeTab]);

  const cancelDeleteClose = useCallback(() => {
    setPendingDeleteTabs(null);
  }, []);

  const handlePathDeleted = useCallback(
    (path: string) => {
      const dirty: number[] = [];
      for (const t of tabs) {
        if (t.kind !== "editor") continue;
        if (t.path !== path && !t.path.startsWith(`${path}/`)) continue;
        if (t.dirty) {
          dirty.push(t.id);
        } else {
          disposeTab(t.id);
        }
      }
      if (dirty.length > 0) setPendingDeleteTabs(dirty);
    },
    [tabs, disposeTab],
  );

  const activeTerminalLeafCwd =
    activeTab?.kind === "terminal"
      ? (findLeafCwd(activeTab.paneTree, activeTab.activeLeafId) ??
        activeTab.cwd ??
        null)
      : null;

  const activeFilePath = (() => {
    if (activeTab?.kind === "editor") return activeTab.path;
    if (activeTab?.kind === "git-diff") {
      if (/^([A-Za-z]:|\/|\\)/.test(activeTab.path)) return activeTab.path;
      const root = activeTab.repoRoot.replace(/[\\/]+$/, "");
      const rel = activeTab.path.replace(/^[\\/]+/, "");
      return `${root}/${rel}`;
    }
    if (activeTab?.kind === "git-commit-file") {
      const root = activeTab.repoRoot.replace(/[\\/]+$/, "");
      const rel = activeTab.path.replace(/^[\\/]+/, "");
      return `${root}/${rel}`;
    }
    return null;
  })();
  const explorerActiveFilePath =
    activeTab?.kind === "editor" || activeTab?.kind === "markdown"
      ? activeTab.path
      : null;
  const workspaceFallbackPath = launchCwdResolved
    ? (launchCwd ?? home ?? null)
    : null;
  const sourceControlContextPath = (() => {
    if (activeTab?.kind === "terminal") {
      return activeTerminalLeafCwd ?? explorerRoot ?? workspaceFallbackPath;
    }
    if (activeTab?.kind === "editor") return dirname(activeTab.path);
    if (activeTab?.kind === "git-diff") return activeTab.repoRoot;
    if (activeTab?.kind === "git-commit-file") return activeTab.repoRoot;
    if (activeTab?.kind === "git-history") return activeTab.repoRoot;
    return explorerRoot ?? workspaceFallbackPath;
  })();
  const hasOpenGitTab = useMemo(
    () =>
      tabs.some(
        (t) =>
          t.kind === "git-diff" ||
          t.kind === "git-history" ||
          t.kind === "git-commit-file",
      ),
    [tabs],
  );
  const sourceControlActive = hasOpenGitTab || sidebarView === "source-control";
  // Stable per-session path so switching tabs / cd-ing in a shell does NOT
  // re-fire git IPC for the badge. The active panel resolves the current
  // context path on its own when the user actually opens git.
  const badgeContextPath = workspaceFallbackPath;
  const sourceControlPath = sourceControlActive
    ? sourceControlContextPath
    : badgeContextPath;
  const sourceControl = useSourceControl(sourceControlPath, true);

  const toggleSidebarPosition = useCallback(() => {
    void setSidebarPosition(sidebarPosition === "left" ? "right" : "left");
  }, [sidebarPosition]);

  const toggleSourceControl = useCallback(() => {
    cycleSidebarView("source-control");
  }, [cycleSidebarView]);

  const openGitGraphFromContext = useCallback(async () => {
    const known = sourceControl.hasRepo ? sourceControl.repo : null;
    if (known) {
      openCommitHistoryTab({
        repoRoot: known.repoRoot,
        branch: sourceControl.status?.branch ?? null,
      });
      return;
    }
    if (!sourceControlContextPath) return;
    try {
      const repo = await native.gitResolveRepo(sourceControlContextPath);
      if (!repo) return;
      openCommitHistoryTab({ repoRoot: repo.repoRoot, branch: repo.branch });
    } catch {
      /* noop */
    }
  }, [
    openCommitHistoryTab,
    sourceControl.hasRepo,
    sourceControl.repo,
    sourceControl.status?.branch,
    sourceControlContextPath,
  ]);

  const openPreviewTab = useCallback(
    (url: string) => {
      const id = newPreviewTab(url);
      // Focus the address bar if the URL is empty so the user can type.
      if (!url) {
        setTimeout(() => previewRefs.current.get(id)?.focusAddressBar(), 0);
      }
      return id;
    },
    [newPreviewTab],
  );

  const openMarkdownPreview = useCallback(
    (path: string) => {
      newMarkdownTab(path);
    },
    [newMarkdownTab],
  );

  const splitActivePaneInActiveTab = useCallback(
    (dir: "row" | "col") => {
      const t = tabsRef.current.find((x) => x.id === activeId);
      if (!t || t.kind !== "terminal") return;
      splitActivePane(activeId, dir);
    },
    [activeId, splitActivePane],
  );

  const handleCloseTabOrPane = useCallback(() => {
    const t = tabsRef.current.find((x) => x.id === activeId);
    if (t?.kind === "terminal" && leafIds(t.paneTree).length > 1) {
      closeActivePane(activeId);
      return;
    }
    void handleClose(activeId);
  }, [activeId, closeActivePane, handleClose]);

  const shortcutHandlers = useMemo<ShortcutHandlers>(
    () => ({
      "commandPalette.open": () => setCommandPaletteOpen(true),
      "tab.new": () => openNewTab(),
      "tab.newPrivate": openNewPrivateTab,
      "tab.newBlocks": openBlockTab,
      "space.overview": () => setSwitcherOpen(true),
      "tab.newPreview": () => openPreviewTab(""),
      "tab.newEditor": () => setNewEditorOpen(true),
      "tab.close": handleCloseTabOrPane,
      "tab.next": () => cycleTab(1),
      "tab.prev": () => cycleTab(-1),
      "tab.selectByIndex": (e) => selectByIndex(parseInt(e.key, 10) - 1),
      "pane.splitRight": () => splitActivePaneInActiveTab("row"),
      "pane.splitDown": () => splitActivePaneInActiveTab("col"),
      "pane.close": () => {
        const t = tabsRef.current.find((x) => x.id === activeId);
        if (t?.kind === "terminal" && leafIds(t.paneTree).length > 1) {
          closeActivePane(activeId);
        }
      },
      "pane.focusNext": () => focusNextPaneInTab(activeId, 1),
      "pane.focusPrev": () => focusNextPaneInTab(activeId, -1),
      "pane.source": toggleSourceControl,
      "search.focus": () => searchInlineRef.current?.focus(),
      "ai.toggle": togglePanelAndFocus,
      "ai.askSelection": () => askFromSelection(),
      "shortcuts.open": () => setShortcutsOpen((v) => !v),
      "settings.open": () => openSettingsTab(),
      "sidebar.toggle": toggleSidebar,
      "explorer.focus": toggleExplorerFocus,
      "view.zoomIn": zoomIn,
      "view.zoomOut": zoomOut,
      "view.zoomReset": zoomReset,
      "editor.undo": () => editorRefs.current.get(activeId)?.undo(),
      "editor.redo": () => editorRefs.current.get(activeId)?.redo(),
      "editor.findReplace": () =>
        editorRefs.current.get(activeId)?.openFindReplace(),
      "editor.toggleWordWrap": () => void setWordWrap(!wordWrap),
      "terminal.clear": () => {
        clearFocusedTerminal();
      },
      "view.zenMode": () => setZenMode((v) => !v),
      "view.rewind": () => useRewindStore.getState().toggle(),
    }),
    [
      activeId,
      cycleTab,
      handleCloseTabOrPane,
      openNewTab,
      openNewPrivateTab,
      openBlockTab,
      openPreviewTab,
      selectByIndex,
      splitActivePaneInActiveTab,
      focusNextPaneInTab,
      toggleSourceControl,
      togglePanelAndFocus,
      askFromSelection,
      toggleSidebar,
      toggleExplorerFocus,
      zoomIn,
      zoomOut,
      zoomReset,
      wordWrap,
    ],
  );

  const shortcutsDisabled = useCallback(
    (id: ShortcutId, e: KeyboardEvent) => {
      if (
        id === "editor.undo" ||
        id === "editor.redo" ||
        id === "editor.findReplace"
      ) {
        return activeTab?.kind !== "editor";
      }
      if (id === "ai.askSelection") {
        const target =
          (e.target as HTMLElement | null) ?? document.activeElement;
        const inTerminal = !!(target as HTMLElement | null)?.closest?.(
          ".xterm",
        );
        if (!inTerminal) return false;
        const sel = captureActiveSelection();
        return !sel || !sel.trim();
      }
      return false;
    },
    [activeTab],
  );

  useGlobalShortcuts(shortcutHandlers, { isDisabled: shortcutsDisabled });

  const registerTerminalHandle = useCallback(
    (leafId: number, h: TerminalPaneHandle | null) => {
      if (h) terminalRefs.current.set(leafId, h);
      else terminalRefs.current.delete(leafId);
    },
    [],
  );

  const registerEditorHandle = useCallback(
    (id: number, h: EditorPaneHandle | null) => {
      if (h) editorRefs.current.set(id, h);
      else editorRefs.current.delete(id);
      if (id === activeId) setActiveEditorHandle(h);
    },
    [activeId],
  );

  const registerPreviewHandle = useCallback(
    (id: number, h: PreviewPaneHandle | null) => {
      if (h) previewRefs.current.set(id, h);
      else previewRefs.current.delete(id);
    },
    [],
  );

  const handlePreviewUrl = useCallback(
    (id: number, url: string) => updateTab(id, { url }),
    [updateTab],
  );

  const handleTerminalCwd = useCallback(
    (leafId: number, cwd: string) => {
      setLeafCwd(leafId, cwd);
      native.workspaceAuthorize(cwd).catch(() => {});
    },
    [setLeafCwd],
  );

  const handleFocusLeaf = useCallback(
    (tabId: number, leafId: number) => focusPane(tabId, leafId),
    [focusPane],
  );

  const onActivateAgent = useCallback(
    (tabId: number, leafId: number) => {
      setActiveId(tabId);
      focusPane(tabId, leafId);
    },
    [setActiveId, focusPane],
  );

  const onActivateLocalAgent = useCallback(() => {
    openPanel();
    focusInput(null);
  }, [openPanel, focusInput]);

  const handleLeafExit = useCallback(
    (leafId: number, _code: number) => {
      const all = tabsRef.current;
      const tab = all.find(
        (t) => t.kind === "terminal" && hasLeaf(t.paneTree, leafId),
      );
      if (!tab || tab.kind !== "terminal") return;
      const isLast =
        leafIds(tab.paneTree).length === 1 &&
        all.filter((t) => t.kind === "terminal").length === 1;
      if (isLast) {
        void respawnSession(leafId, tab.cwd);
      } else {
        closePaneByLeaf(leafId);
      }
    },
    [closePaneByLeaf],
  );

  const handleEditorDirty = useCallback(
    (id: number, dirty: boolean) => updateTab(id, { dirty }),
    [updateTab],
  );

  const handleRenameTab = useCallback(
    (id: number, title: string) => updateTab(id, { customTitle: title.trim() }),
    [updateTab],
  );

  const searchTarget = useMemo<SearchTarget>(() => {
    if (isTerminalTab && activeLeafId !== null && activeSearchAddon)
      return {
        kind: "terminal",
        addon: activeSearchAddon,
        focus: () => terminalRefs.current.get(activeLeafId)?.focus(),
      };
    if (isEditorTab && activeEditorHandle)
      return {
        kind: "editor",
        handle: activeEditorHandle,
        focus: () => activeEditorHandle.focus(),
      };
    if (isGitHistoryTab && gitHistoryHandle)
      return {
        kind: "git-history",
        handle: gitHistoryHandle,
        focus: () => {},
      };
    return null;
  }, [
    isTerminalTab,
    isEditorTab,
    isGitHistoryTab,
    activeLeafId,
    activeSearchAddon,
    activeEditorHandle,
    gitHistoryHandle,
  ]);

  const commandPaletteActions = useMemo(
    () =>
      createCommandPaletteActions({
        tabs,
        activeId,
        searchTarget,
        explorerRoot,
        home,
        openNewTab,
        openNewPrivate: openNewPrivateTab,
        openNewEditor: () => setNewEditorOpen(true),
        openNewPreview: () => openPreviewTab(""),
        closeActiveTabOrPane: handleCloseTabOrPane,
        nextTab: () => cycleTab(1),
        previousTab: () => cycleTab(-1),
        splitPaneRight: () => splitActivePaneInActiveTab("row"),
        splitPaneDown: () => splitActivePaneInActiveTab("col"),
        focusNextPane: () => focusNextPaneInTab(activeId, 1),
        focusPreviousPane: () => focusNextPaneInTab(activeId, -1),
        focusSearch: () => searchInlineRef.current?.focus(),
        focusExplorerSearch: () => explorerRef.current?.focusSearch(),
        toggleSidebar,
        toggleAi: togglePanelAndFocus,
        askAiSelection: askFromSelection,
        openSettings: () => openSettingsTab(),
        openShortcuts: () => setShortcutsOpen(true),
      }),
    [
      tabs,
      activeId,
      searchTarget,
      explorerRoot,
      home,
      openNewTab,
      openNewPrivateTab,
      openPreviewTab,
      handleCloseTabOrPane,
      cycleTab,
      splitActivePaneInActiveTab,
      focusNextPaneInTab,
      toggleSidebar,
      togglePanelAndFocus,
      askFromSelection,
      openSettingsTab,
    ],
  );

  const activeCwd = activeTerminalLeafCwd;

  useEffect(() => {
    const findCwd = () => {
      const active = tabs.find((x) => x.id === activeId);
      if (active?.kind === "terminal") {
        return (
          findLeafCwd(active.paneTree, active.activeLeafId) ??
          active.cwd ??
          null
        );
      }
      for (let i = tabs.length - 1; i >= 0; i--) {
        const t = tabs[i];
        if (t.kind !== "terminal") continue;
        const cwd = findLeafCwd(t.paneTree, t.activeLeafId) ?? t.cwd;
        if (cwd) return cwd;
      }
      return explorerRoot ?? launchCwd ?? home ?? null;
    };

    setLive({
      getCwd: findCwd,
      getTerminalContext: () => {
        const t = tabs.find((x) => x.id === activeId);
        if (t?.kind !== "terminal") return null;
        if (t.private) return null;
        const buf = terminalRefs.current.get(t.activeLeafId)?.getBuffer(300);
        return buf ? redactSensitive(buf) : null;
      },
      isActiveTerminalPrivate: () => {
        const t = tabs.find((x) => x.id === activeId);
        return t?.kind === "terminal" && t.private === true;
      },
      injectIntoActivePty: (text) => {
        const t = tabs.find((x) => x.id === activeId);
        if (t?.kind !== "terminal") return false;
        const term = terminalRefs.current.get(t.activeLeafId);
        if (!term) return false;
        term.write(text);
        term.focus();
        return true;
      },
      getWorkspaceRoot: () => explorerRoot ?? launchCwd ?? home ?? null,
      getActiveFile: () => {
        const t = tabs.find((x) => x.id === activeId);
        return t?.kind === "editor" ? t.path : null;
      },
      openPreview: (url: string) => {
        openPreviewTab(url);
        return true;
      },
      spawnManagedAgent: (prompt: string, sessionId: string) => {
        const trimmed = prompt.trim();
        if (!trimmed) return null;
        const oneLine = trimmed.replace(/\s*\r?\n\s*/g, " ");
        const cwd = findCwd();
        const short =
          oneLine.length > 32 ? `${oneLine.slice(0, 32)}…` : oneLine;
        const { tabId, leafId } = newAgentTab(
          cwd ?? undefined,
          `claude · ${short}`,
        );
        useManagedAgentsStore
          .getState()
          .register({ leafId, tabId, sessionId, task: oneLine, cwd });
        const hooksReady = invoke("agent_enable_claude_hooks").catch(() => {});
        void (async () => {
          await Promise.all([whenSessionReady(leafId), hooksReady]);
          if (!writeToSession(leafId, "claude\r")) {
            useManagedAgentsStore.getState().remove(leafId);
            return;
          }
          const readBuf = () => {
            const term = terminalRefs.current.get(leafId);
            return term ? term.getBuffer(120) : null;
          };
          const result = await waitForClaudeTuiReady(readBuf);
          if (result !== "ready") {
            if (result === "timeout") {
              console.warn(
                "[gear] Claude TUI did not appear in time; aborting prompt send",
              );
            }
            useManagedAgentsStore.getState().remove(leafId);
            return;
          }
          if (!writeToSession(leafId, `\x1b[200~${trimmed}\x1b[201~`)) {
            useManagedAgentsStore.getState().remove(leafId);
            return;
          }
          setTimeout(() => writeToSession(leafId, "\r"), 120);
          useManagedAgentsStore.getState().setPhase(leafId, "working");
        })();
        return { tabId, leafId };
      },
      readLeafBuffer: (leafId) => {
        return terminalRefs.current.get(leafId)?.getBuffer(500) ?? null;
      },
    });
  }, [
    setLive,
    activeId,
    tabs,
    explorerRoot,
    launchCwd,
    home,
    openPreviewTab,
    newAgentTab,
  ]);

  const workspaceSurface = (
    <div className="relative h-full min-h-0">
      <div
        className={cn(
          "absolute inset-0 px-3 pt-2 pb-2",
          !isTerminalTab && "invisible pointer-events-none",
        )}
        aria-hidden={!isTerminalTab}
      >
        <ErrorBoundary label="Terminal" compact>
          <TerminalStack
            tabs={tabs}
            activeId={activeId}
            registerHandle={registerTerminalHandle}
            onSearchReady={handleSearchReady}
            onCwd={handleTerminalCwd}
            onExit={handleLeafExit}
            onFocusLeaf={handleFocusLeaf}
            onRenameLeaf={(_tabId, leafId, name) => setLeafName(leafId, name)}
            onCloseLeaf={(_tabId, leafId) => closePaneByLeaf(leafId)}
          />
        </ErrorBoundary>
      </div>
      <div
        className={cn(
          "absolute inset-0 px-3 pt-2 pb-2",
          !isEditorTab && "invisible pointer-events-none",
        )}
        aria-hidden={!isEditorTab}
      >
        <ErrorBoundary label="Editor" compact>
          <EditorStack
            tabs={tabs}
            activeId={activeId}
            registerHandle={registerEditorHandle}
            onDirtyChange={handleEditorDirty}
            onCloseTab={disposeTab}
          />
        </ErrorBoundary>
      </div>
      <div
        className={cn(
          "absolute inset-0 px-3 pt-2 pb-2",
          !isPreviewTab && "invisible pointer-events-none",
        )}
        aria-hidden={!isPreviewTab}
      >
        <PreviewStack
          tabs={tabs}
          activeId={activeId}
          registerHandle={registerPreviewHandle}
          onUrlChange={handlePreviewUrl}
        />
      </div>
      <div
        className={cn(
          "absolute inset-0 px-3 pt-2 pb-2",
          !isMarkdownTab && "invisible pointer-events-none",
        )}
        aria-hidden={!isMarkdownTab}
      >
        <MarkdownStack
          tabs={tabs}
          activeId={activeId}
          onEditRaw={(path) => openFileTab(path, true)}
        />
      </div>
      <div
        className={cn(
          "absolute inset-0 px-3 pt-2 pb-2",
          !isAiDiffTab && "invisible pointer-events-none",
        )}
        aria-hidden={!isAiDiffTab}
      >
        <AiDiffStack
          tabs={tabs}
          activeId={activeId}
          onAccept={(id) => respondToApproval(id, true)}
          onReject={(id) => respondToApproval(id, false)}
        />
      </div>
      <div
        className={cn(
          "absolute inset-0 px-3 pt-2 pb-2",
          !isGitDiffTab && "invisible pointer-events-none",
        )}
        aria-hidden={!isGitDiffTab}
      >
        <GitDiffStack tabs={tabs} activeId={activeId} />
      </div>
      <div
        className={cn(
          "absolute inset-0",
          !isGitHistoryTab && "invisible pointer-events-none",
        )}
        aria-hidden={!isGitHistoryTab}
      >
        <GitHistoryStack
          tabs={tabs}
          activeId={activeId}
          onOpenCommitFile={openCommitFileDiffTab}
          onSearchHandle={setGitHistoryHandle}
        />
      </div>
      <div
        className={cn(
          "absolute inset-0",
          !isSettingsTab && "invisible pointer-events-none",
        )}
        aria-hidden={!isSettingsTab}
      >
        {settingsTab && (
          <SettingsPane
            section={settingsTab.section}
            onSectionChange={(s) => updateTab(settingsTab.id, { section: s })}
          />
        )}
      </div>
    </div>
  );

  const shell = (
    <ThemeProvider>
      <TooltipProvider>
        <div className="relative flex h-screen flex-col overflow-hidden bg-background text-foreground">
          {!zenMode && (
            <div data-tauri-drag-region className="h-[2px] w-full shrink-0 bg-gradient-to-r from-primary/30 via-primary to-primary/30" />
          )}
          {!zenMode && (
            <Header
              tabs={spaceTabs}
              activeId={activeId}
              onSelect={setActiveId}
              onNew={openNewTab}
              onNewPrivate={openNewPrivateTab}
              onNewBlocks={openBlockTab}
              onNewPreview={() => openPreviewTab("")}
              onNewEditor={() => setNewEditorOpen(true)}
              onNewGitGraph={openGitGraphFromContext}
              onClose={handleClose}
              onPin={pinTab}
              onRename={handleRenameTab}
              onReorder={reorderTabs}
              onToggleSidebar={toggleSidebar}
              onSplit={splitActivePaneInActiveTab}
              canSplit={
                activeTerminalTab !== null &&
                leafIds(activeTerminalTab.paneTree).length < MAX_PANES_PER_TAB
              }
              onClosePane={() => closeActivePane(activeId)}
              canClosePane={
                activeTerminalTab !== null &&
                leafIds(activeTerminalTab.paneTree).length > 1
              }
              onCloseOthers={closeOtherTabs}
              onActivateAgent={onActivateAgent}
              onActivateLocalAgent={onActivateLocalAgent}
              onOpenSettings={() => openSettingsTab()}
              searchTarget={searchTarget}
              searchRef={searchInlineRef}
            />
          )}

          <main className="zoom-content flex flex-col min-h-0 flex-1 relative bg-background">
            <ResizablePanelGroup
              orientation="horizontal"
              className="min-h-0 flex-1"
            >
              {!zenMode && sidebarPosition === "left" && (
                <>
                  <ResizablePanel
                    id="sidebar"
                    panelRef={sidebarRef}
                    defaultSize={`${sidebarWidthRef.current}px`}
                    minSize={`${SIDEBAR_MIN_WIDTH}px`}
                    maxSize={`${SIDEBAR_MAX_WIDTH}px`}
                    collapsible
                    collapsedSize={0}
                    onResize={(size) => {
                      if (size.inPixels > 0) persistSidebarWidth(size.inPixels);
                    }}
                  >
                    <div className="flex h-full min-h-0 flex-col p-2 pr-1">
                      <div className="min-h-0 flex-1 rounded-xl border border-border/40 bg-card/60 backdrop-blur-md shadow-sm overflow-hidden flex flex-col">
                        <ErrorBoundary compact label="Sidebar">
                          {sidebarView === "explorer" ? (
                            <FileExplorer
                              ref={explorerRef}
                              rootPath={explorerRoot}
                              activeFilePath={explorerActiveFilePath}
                              onOpenFile={handleOpenFile}
                              onPathRenamed={handlePathRenamed}
                              onPathDeleted={handlePathDeleted}
                              onRevealInTerminal={cdInNewTab}
                              onAttachToAgent={handleAttachFileToAgent}
                              onOpenMarkdownPreview={openMarkdownPreview}
                            />
                          ) : (
                            <SourceControlPanel
                              open
                              sourceControl={sourceControl}
                              onOpenDiff={openGitDiffTab}
                              onOpenGitGraph={openGitGraphFromContext}
                              onOpenFile={handleOpenFile}
                            />
                          )}
                        </ErrorBoundary>
                      </div>
                    </div>
                  </ResizablePanel>
                  <ResizableHandle withHandle className="bg-transparent w-2" />
                </>
              )}
              <ResizablePanel id="workspace" defaultSize="78%" minSize="30%">
                <div className="flex h-full min-h-0 flex-col p-2 pl-1 pr-1">
                  <div className="relative min-h-0 flex-1 rounded-xl border border-border/40 bg-background/90 backdrop-blur shadow-sm overflow-hidden">
                    {workspaceSurface}
                  </div>
                  {keysLoaded ? (
                    <motion.div
                      data-ai-input-bar
                      initial={false}
                      animate={{
                        height: panelOpen ? "auto" : 0,
                        opacity: panelOpen ? 1 : 0,
                      }}
                      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                      aria-hidden={!panelOpen}
                    >
                      {hasComposer ? (
                        <AiInputBar />
                      ) : (
                        <AiInputBarConnect
                          onAdd={() => openSettingsTab("models")}
                        />
                      )}
                    </motion.div>
                  ) : null}
                  {!zenMode && (
                    <div className="flex justify-center pb-1 pt-2 shrink-0">
                      <SidebarRail
                        activeView={sidebarView}
                        sidebarOpen={sidebarOpen}
                        onSelectView={cycleSidebarView}
                        changedCount={sourceControl.changedCount}
                        aiActive={panelOpen}
                        onToggleAi={togglePanelAndFocus}
                        onToggleRewind={() => useRewindStore.getState().toggle()}
                        onOpenSettings={() => openSettingsTab()}
                        sidebarPosition={sidebarPosition}
                        onToggleSidebarPosition={toggleSidebarPosition}
                      />
                    </div>
                  )}
                </div>
              </ResizablePanel>
              {!zenMode && sidebarPosition === "right" && (
                <>
                  <ResizableHandle withHandle className="bg-transparent w-2" />
                  <ResizablePanel
                    id="sidebar"
                    panelRef={sidebarRef}
                    defaultSize={`${sidebarWidthRef.current}px`}
                    minSize={`${SIDEBAR_MIN_WIDTH}px`}
                    maxSize={`${SIDEBAR_MAX_WIDTH}px`}
                    collapsible
                    collapsedSize={0}
                    onResize={(size) => {
                      if (size.inPixels > 0) persistSidebarWidth(size.inPixels);
                    }}
                  >
                    <div className="flex h-full min-h-0 flex-col p-2 pl-1">
                      <div className="min-h-0 flex-1 rounded-xl border border-border/40 bg-card/60 backdrop-blur-md shadow-sm overflow-hidden flex flex-col">
                        <ErrorBoundary compact label="Sidebar">
                          {sidebarView === "explorer" ? (
                            <FileExplorer
                              ref={explorerRef}
                              rootPath={explorerRoot}
                              activeFilePath={explorerActiveFilePath}
                              onOpenFile={handleOpenFile}
                              onPathRenamed={handlePathRenamed}
                              onPathDeleted={handlePathDeleted}
                              onRevealInTerminal={cdInNewTab}
                              onAttachToAgent={handleAttachFileToAgent}
                              onOpenMarkdownPreview={openMarkdownPreview}
                            />
                          ) : (
                            <SourceControlPanel
                              open
                              sourceControl={sourceControl}
                              onOpenDiff={openGitDiffTab}
                              onOpenGitGraph={openGitGraphFromContext}
                              onOpenFile={handleOpenFile}
                            />
                          )}
                        </ErrorBoundary>
                      </div>
                    </div>
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </main>

          {!zenMode && (
            <StatusBar
              cwd={activeCwd}
              filePath={activeFilePath}
              home={home}
              onCd={sendCd}
              onWorkspaceChange={switchWorkspace}
              onOpenMini={openMini}
              hasComposer={hasComposer}
              onConnectProvider={() => openSettingsTab("models")}
              privateActive={
                activeTab?.kind === "terminal" && activeTab.private === true
              }
              editorLanguage={
                activeTab?.kind === "editor"
                  ? (activeTab.languageOverride ??
                    activeTab.path.split(".").pop()?.toLowerCase() ??
                    "txt")
                  : null
              }
              editorLanguageIsOverride={
                activeTab?.kind === "editor" && !!activeTab.languageOverride
              }
              onSetEditorLanguage={(ext) => setTabLanguage(activeId, ext)}
            />
          )}

          <RewindPanel />

          <AlertDialog
            open={pendingAppClose}
            onOpenChange={(open) => !open && cancelAppClose()}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Quit Gear?</AlertDialogTitle>
                <AlertDialogDescription>
                  A terminal still has a running process. Quitting will end it.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={cancelAppClose}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction onClick={confirmAppClose}>
                  Quit
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <SpaceSwitcher
            open={switcherOpen}
            onOpenChange={setSwitcherOpen}
            tabs={tabs}
            onNewSpace={handleNewSpace}
            onDeleteSpace={handleDeleteSpace}
            onNewTabInSpace={handleNewTabInSpace}
            onJumpTab={handleJumpTab}
            onCloseTab={handleClose}
            onMoveTabToSpace={handleMoveTabToSpace}
            onReorderTab={(tabId, targetTabId) =>
              handleReorderTabAcrossSpaces(tabId, targetTabId)
            }
            onReorderSpaces={(ids) => useSpaces.getState().reorder(ids)}
          />

          <CommandPalette
            open={commandPaletteOpen}
            onOpenChange={setCommandPaletteOpen}
            actions={commandPaletteActions}
            workspaceRoot={explorerRoot}
            onOpenFile={handleOpenFile}
          />

          <AgentNotificationsBridge
            tabs={tabs}
            activeId={activeId}
            onActivate={onActivateAgent}
          />
          <Toaster position="bottom-right" />

          {hasComposer ? (
            <>
              <AgentRunBridge
                openAiDiffTab={openAiDiffTab}
                closeAiDiffTab={closeAiDiffTab}
              />
              <LocalAgentNotificationsBridge />
            </>
          ) : null}

          <AnimatePresence>
            {miniOpen ? <AiMiniWindow key="ai-mini" /> : null}
            {askPopup ? (
              <SelectionAskAi
                key="ask-ai-popup"
                x={askPopup.x}
                y={askPopup.y}
                onAsk={onAskFromSelection}
                onDismiss={() => setAskPopup(null)}
              />
            ) : null}
            {zenMode ? (
              <motion.div
                key="zen-hint"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ delay: 1.5, duration: 0.4 }}
                className="pointer-events-none fixed bottom-3 right-3 z-50 rounded-md border border-border/40 bg-background/60 px-2 py-1 text-[10px] text-muted-foreground/60 backdrop-blur"
              >
                Zen Mode — press Ctrl+Shift+Z to exit
              </motion.div>
            ) : null}
          </AnimatePresence>

          <ShortcutsDialog
            open={shortcutsOpen}
            onOpenChange={setShortcutsOpen}
          />

          <NewEditorDialog
            open={newEditorOpen}
            onOpenChange={setNewEditorOpen}
            rootPath={explorerRoot ?? home}
            onCreated={(path) => openFileTab(path)}
          />

          <UpdaterDialog />
          <WhatsNewDialog />

          <AlertDialog
            open={pendingCloseTab !== null}
            onOpenChange={(open) => !open && cancelClose()}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
                <AlertDialogDescription>
                  {tabs.find((t) => t.id === pendingCloseTab)?.title
                    ? `"${
                        tabs.find((t) => t.id === pendingCloseTab)?.title
                      }" has unsaved changes. Close anyway?`
                    : "This file has unsaved changes. Close anyway?"}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={cancelClose}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction onClick={confirmClose}>
                  Close Anyway
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog
            open={pendingTerminalCloseTab !== null}
            onOpenChange={(open) => !open && setPendingTerminalCloseTab(null)}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Close Terminal?</AlertDialogTitle>
                <AlertDialogDescription>
                  A process is running. Closing this tab will terminate it.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel
                  onClick={() => setPendingTerminalCloseTab(null)}
                >
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    if (pendingTerminalCloseTab !== null)
                      disposeTab(pendingTerminalCloseTab);
                    setPendingTerminalCloseTab(null);
                  }}
                >
                  Close Anyway
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog
            open={pendingDeleteTabs !== null}
            onOpenChange={(open) => !open && cancelDeleteClose()}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
                <AlertDialogDescription>
                  {pendingDeleteTabs?.length === 1
                    ? (() => {
                        const title = tabs.find(
                          (t) => t.id === pendingDeleteTabs[0],
                        )?.title;
                        return title
                          ? `"${title}" has unsaved changes. The file has been deleted. Close anyway?`
                          : "This file has unsaved changes. The file has been deleted. Close anyway?";
                      })()
                    : `${pendingDeleteTabs?.length ?? 0} files have unsaved changes. They have been deleted. Close all anyway?`}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={cancelDeleteClose}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction onClick={confirmDeleteClose}>
                  Close Anyway
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </TooltipProvider>
    </ThemeProvider>
  );

  return <AiComposerProvider>{shell}</AiComposerProvider>;
}
