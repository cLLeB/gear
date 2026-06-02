import { detectMonoFontFamily, ensureMonoFontsLoaded } from "@/lib/fonts";
import { IS_MAC } from "@/lib/platform";
import { invoke } from "@tauri-apps/api/core";
import { getLaunchDir } from "@/lib/launchDir";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { buildTerminalTheme } from "@/styles/terminalTheme";
import { openUrl } from "@tauri-apps/plugin-opener";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  createShellIntegrationState,
  registerCwdHandler,
  registerPromptTracker,
} from "./osc-handlers";
import { openPty, type PtySession } from "./pty-bridge";
import {
  terminalDeleteSequence,
  terminalLineNavigationSequence,
  terminalWordNavigationSequence,
} from "./keymap";

// ── types ──────────────────────────────────────────────────────────────────

type Callbacks = {
  onSearchReady?: (addon: SearchAddon) => void;
  onExit?: (code: number) => void;
  onCwd?: (cwd: string) => void;
};

type Session = {
  pty: PtySession | null;
  ptyOpening: boolean;
  initialCwd: string | undefined;
  lastCwd: string | null;
  /** Private terminals are excluded from Chronicle capture. */
  isPrivate: boolean;
  pendingExit: number | null;
  shellExited: boolean;
  callbacks: Callbacks;
  visibleNow: boolean;
  focusedNow: boolean;
  disposed: boolean;
  ready: Promise<void>;
  // Each session owns its terminal directly — no pool slot swapping
  term: Terminal | null;
  fitAddon: FitAddon | null;
  searchAddon: SearchAddon | null;
  webglAddon: WebglAddon | null;
  observer: ResizeObserver | null;
  container: HTMLDivElement | null;
  oscDisposers: (() => void)[];
  fitTimer: ReturnType<typeof setTimeout> | null;
  ptyTimer: ReturnType<typeof setTimeout> | null;
  lastCols: number;
  lastRows: number;
};

// ── module state ───────────────────────────────────────────────────────────

const sessions = new Map<number, Session>();

const readyLeaves = new Set<number>();
const readyWaiters = new Map<
  number,
  { resolve: () => void; timer: ReturnType<typeof setTimeout> }[]
>();

// ── constants ──────────────────────────────────────────────────────────────

const FIT_DEBOUNCE_MS = 8;
const PTY_RESIZE_DEBOUNCE_MS = 256;
const WEBGL_RECOVERY_DELAY_MS = 250;

// ── ready signalling ───────────────────────────────────────────────────────

function markSessionReady(leafId: number): void {
  if (readyLeaves.has(leafId)) return;
  readyLeaves.add(leafId);
  const waiters = readyWaiters.get(leafId);
  if (!waiters) return;
  readyWaiters.delete(leafId);
  for (const w of waiters) {
    clearTimeout(w.timer);
    w.resolve();
  }
}

export function whenSessionReady(leafId: number, timeoutMs = 4000): Promise<void> {
  if (readyLeaves.has(leafId)) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const arr = readyWaiters.get(leafId);
      const i = arr?.findIndex((w) => w.timer === timer) ?? -1;
      if (arr && i >= 0) arr.splice(i, 1);
      resolve();
    }, timeoutMs);
    const arr = readyWaiters.get(leafId) ?? [];
    arr.push({ resolve, timer });
    readyWaiters.set(leafId, arr);
  });
}

// ── public helpers ─────────────────────────────────────────────────────────

export function writeToSession(leafId: number, data: string): boolean {
  const s = sessions.get(leafId);
  if (!s || !s.pty) return false;
  void s.pty.write(data);
  return true;
}

// Bracketed paste via xterm, so an app that enabled it (Claude Code) treats a
// dropped path as a real paste while a plain shell gets the literal text.
export function pasteIntoLeaf(leafId: number, text: string): boolean {
  const s = sessions.get(leafId);
  if (!s || !s.term) return false;
  s.term.paste(text);
  return true;
}

export async function leafHasForegroundProcess(
  leafId: number,
): Promise<boolean> {
  const s = sessions.get(leafId);
  if (!s?.pty || s.shellExited) return false;
  try {
    return await invoke<boolean>("pty_has_foreground_process", {
      id: s.pty.id,
    });
  } catch (e) {
    console.error(
      "[Gear] pty_has_foreground_process failed for leaf",
      leafId,
      e,
    );
    return false;
  }
}

export function clearFocusedTerminal(): boolean {
  for (const [, s] of sessions) {
    if (!s.visibleNow || !s.focusedNow || !s.term) continue;
    s.term.clear();
    return true;
  }
  return false;
}

export function leafIdForPty(ptyId: number): number | null {
  for (const [leafId, s] of sessions) {
    if (s.pty?.id === ptyId) return leafId;
  }
  return null;
}

export function refitSlot(leafId: number): void {
  const s = sessions.get(leafId);
  if (!s?.fitAddon || !s.term) return;
  s.fitAddon.fit();
  const newCols = s.term.cols;
  const newRows = s.term.rows;
  if (newCols !== s.lastCols || newRows !== s.lastRows) {
    s.lastCols = newCols;
    s.lastRows = newRows;
    void s.pty?.resize(newCols, newRows);
  }
}

// ── terminal creation ──────────────────────────────────────────────────────

function termOptions() {
  const prefs = usePreferencesStore.getState();
  return {
    fontFamily: prefs.terminalFontFamily || detectMonoFontFamily(),
    letterSpacing: prefs.terminalLetterSpacing,
    fontSize: Math.max(4, Math.round(prefs.terminalFontSize * prefs.zoomLevel)),
    theme: buildTerminalTheme(),
    cursorBlink: false,
    cursorStyle: "bar" as const,
    cursorInactiveStyle: "outline" as const,
    scrollback: prefs.terminalScrollback,
    allowProposedApi: true,
  };
}

function attachWebgl(s: Session): void {
  if (!s.term || s.webglAddon || !s.term.element) return;
  if (!usePreferencesStore.getState().terminalWebglEnabled) return;
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => {
      if (s.webglAddon === webgl) s.webglAddon = null;
      try { webgl.dispose(); } catch {}
      setTimeout(() => {
        if (s.webglAddon || !s.term) return;
        if (!usePreferencesStore.getState().terminalWebglEnabled) return;
        attachWebgl(s);
        if (s.webglAddon) {
          try { s.term.refresh(0, s.term.rows - 1); } catch {}
        }
      }, WEBGL_RECOVERY_DELAY_MS);
    });
    s.term.loadAddon(webgl);
    s.webglAddon = webgl;
  } catch (e) {
    console.warn("[Gear-webgl] unavailable:", e);
  }
}

function setupResizeObserver(s: Session, container: HTMLDivElement): void {
  s.observer?.disconnect();
  if (s.fitTimer) clearTimeout(s.fitTimer);
  if (s.ptyTimer) clearTimeout(s.ptyTimer);
  s.fitTimer = null;
  s.ptyTimer = null;

  const flushPty = () => {
    s.ptyTimer = null;
    if (!s.term || !s.pty) return;
    if (s.term.cols === s.lastCols && s.term.rows === s.lastRows) return;
    s.lastCols = s.term.cols;
    s.lastRows = s.term.rows;
    void s.pty.resize(s.lastCols, s.lastRows);
  };

  s.observer = new ResizeObserver(() => {
    if (s.fitTimer) clearTimeout(s.fitTimer);
    s.fitTimer = setTimeout(() => {
      s.fitTimer = null;
      if (!s.fitAddon) return;
      s.fitAddon.fit();
      if (s.ptyTimer) clearTimeout(s.ptyTimer);
      s.ptyTimer = setTimeout(flushPty, PTY_RESIZE_DEBOUNCE_MS);
    }, FIT_DEBOUNCE_MS);
  });
  s.observer.observe(container);
}

function createTerminal(leafId: number, s: Session, container: HTMLDivElement): void {
  const term = new Terminal(termOptions());
  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();

  term.loadAddon(fitAddon);
  term.loadAddon(searchAddon);
  term.loadAddon(
    new WebLinksAddon((_e, uri) => openUrl(uri).catch(console.error)),
  );

  // Open directly into the real container — no off-screen staging
  term.open(container);
  fitAddon.fit();

  s.term = term;
  s.fitAddon = fitAddon;
  s.searchAddon = searchAddon;
  s.lastCols = term.cols;
  s.lastRows = term.rows;

  attachWebgl(s);

  // PTY input: terminal keystrokes → PTY write
  term.onData((data) => {
    void s.pty?.write(data);
  });

  // Custom key overrides (word/line nav, smart delete, shift-enter, paste)
  term.attachCustomKeyEventHandler((event) => {
    if (event.isComposing || event.keyCode === 229) return false;

    const lineNav = terminalLineNavigationSequence(event, { isMac: IS_MAC });
    if (lineNav) {
      event.preventDefault();
      if (event.type === "keydown") void s.pty?.write(lineNav);
      return false;
    }
    const wordNav = terminalWordNavigationSequence(event);
    if (wordNav) {
      event.preventDefault();
      if (event.type === "keydown") void s.pty?.write(wordNav);
      return false;
    }
    const del = terminalDeleteSequence(event, { isMac: IS_MAC });
    if (del) {
      event.preventDefault();
      if (event.type === "keydown") void s.pty?.write(del);
      return false;
    }
    if (isShiftEnter(event)) {
      event.preventDefault();
      if (event.type === "keydown") void s.pty?.write("\x1b\r");
      return false;
    }
    if (isCtrlPaste(event)) {
      if (event.type === "keydown") {
        navigator.clipboard
          .readText()
          .then((text) => { if (text) term.paste(text); })
          .catch(() => {});
      }
      return false;
    }
    return true;
  });

  // OSC 7 (cwd) + OSC 133 (prompt boundary) integration
  const shellState = createShellIntegrationState();
  const cwdDispose = registerCwdHandler(
    term,
    (next) => {
      markSessionReady(leafId);
      if (s.lastCwd === next) return;
      s.lastCwd = next;
      s.callbacks.onCwd?.(next);
    },
    shellState,
  );
  const prompt = registerPromptTracker(term, shellState, (cmd) => {
    // Capture completed commands into the session timeline. Private terminals
    // are excluded; capture is best-effort and must never disrupt the shell.
    if (s.isPrivate) return;
    const root = getLaunchDir();
    if (!root) return;
    void invoke("chronicle_record_command", {
      workspaceRoot: root,
      command: cmd.command,
      exitCode: cmd.exitCode,
      durationMs: cmd.durationMs,
      cwd: s.lastCwd,
    }).catch(() => {});
  });
  s.oscDisposers = [cwdDispose, prompt.dispose];

  setupResizeObserver(s, container);

  s.callbacks.onSearchReady?.(searchAddon);
}

// ── session lifecycle ──────────────────────────────────────────────────────

function ensureSession(leafId: number, initialCwd?: string): Session {
  const existing = sessions.get(leafId);
  if (existing) return existing;

  const session: Session = {
    pty: null,
    ptyOpening: false,
    initialCwd,
    lastCwd: null,
    isPrivate: false,
    pendingExit: null,
    shellExited: false,
    callbacks: {},
    visibleNow: false,
    focusedNow: false,
    disposed: false,
    ready: Promise.resolve(),
    term: null,
    fitAddon: null,
    searchAddon: null,
    webglAddon: null,
    observer: null,
    container: null,
    oscDisposers: [],
    fitTimer: null,
    ptyTimer: null,
    lastCols: 0,
    lastRows: 0,
  };
  sessions.set(leafId, session);

  session.ready = (async () => {
    await ensureMonoFontsLoaded();
    await document.fonts.ready;
  })();

  return session;
}

async function openPtyForSession(
  s: Session,
  cwd: string | undefined,
): Promise<PtySession> {
  const startCols = s.lastCols > 0 ? s.lastCols : 80;
  const startRows = s.lastRows > 0 ? s.lastRows : 24;
  return openPty(
    startCols,
    startRows,
    {
      onData: (bytes) => s.term?.write(bytes),
      onExit: (code) => {
        s.shellExited = true;
        s.pty = null;
        if (s.term) s.term.options.disableStdin = true;
        if (s.callbacks.onExit) s.callbacks.onExit(code);
        else s.pendingExit = code;
      },
    },
    cwd,
  );
}

function attachSession(
  leafId: number,
  container: HTMLDivElement,
  callbacks: Callbacks,
): void {
  const s = sessions.get(leafId);
  if (!s || s.disposed) return;
  s.callbacks = callbacks;
  s.container = container;

  // Create the terminal directly in the real container on first attach
  if (!s.term) {
    createTerminal(leafId, s, container);
  }

  // Start PTY if not already running
  if (!s.pty && !s.ptyOpening && !s.shellExited) {
    s.ptyOpening = true;
    openPtyForSession(s, s.initialCwd)
      .then((pty) => {
        s.ptyOpening = false;
        if (s.disposed) { pty.close(); return; }
        s.pty = pty;
        if (s.lastCols > 0 && s.lastRows > 0) void pty.resize(s.lastCols, s.lastRows);
      })
      .catch((e) => {
        s.ptyOpening = false;
        console.error("[Gear] openPty failed:", e);
      });
  }

  // Flush any callbacks that fired while detached
  if (s.lastCwd !== null) s.callbacks.onCwd?.(s.lastCwd);
  if (s.pendingExit !== null) {
    const code = s.pendingExit;
    s.pendingExit = null;
    s.callbacks.onExit?.(code);
  }
}

function detachSession(leafId: number): void {
  const s = sessions.get(leafId);
  if (!s) return;
  // Clear callbacks and container reference but keep terminal alive
  s.callbacks = {};
  s.container = null;
}

export async function respawnSession(leafId: number, cwd?: string): Promise<void> {
  const s = sessions.get(leafId);
  if (!s || s.disposed || !s.term) return;

  s.pty?.close();
  s.pty = null;
  s.shellExited = false;
  s.pendingExit = null;
  readyLeaves.delete(leafId);

  s.term.options.disableStdin = false;
  s.term.clear();
  s.term.reset();

  s.ptyOpening = true;
  let pty: PtySession;
  try {
    pty = await openPtyForSession(s, cwd ?? s.initialCwd);
  } catch (e) {
    s.ptyOpening = false;
    console.error("[Gear] respawn openPty failed:", e);
    return;
  }
  s.ptyOpening = false;
  if (s.disposed) { pty.close(); return; }
  s.pty = pty;
  if (s.lastCols > 0 && s.lastRows > 0) void pty.resize(s.lastCols, s.lastRows);
}

export function disposeSession(leafId: number): void {
  const s = sessions.get(leafId);
  if (!s) return;
  s.disposed = true;

  for (const d of s.oscDisposers) { try { d(); } catch {} }
  s.oscDisposers = [];

  s.observer?.disconnect();
  s.observer = null;
  if (s.fitTimer) { clearTimeout(s.fitTimer); s.fitTimer = null; }
  if (s.ptyTimer) { clearTimeout(s.ptyTimer); s.ptyTimer = null; }

  s.pty?.close();
  s.pty = null;

  if (s.webglAddon) {
    try { s.webglAddon.dispose(); } catch {}
    s.webglAddon = null;
  }
  if (s.term) {
    try { s.term.dispose(); } catch {}
    s.term = null;
  }

  sessions.delete(leafId);
  readyLeaves.delete(leafId);

  const waiters = readyWaiters.get(leafId);
  if (waiters) {
    readyWaiters.delete(leafId);
    for (const w of waiters) {
      clearTimeout(w.timer);
      w.resolve();
    }
  }
}

// ── React hook ─────────────────────────────────────────────────────────────

type Options = {
  leafId: number;
  container: React.RefObject<HTMLDivElement | null>;
  visible: boolean;
  focused?: boolean;
  initialCwd?: string;
  /** When true, this terminal's commands are excluded from Chronicle capture. */
  isPrivate?: boolean;
  onSearchReady?: (addon: SearchAddon) => void;
  onExit?: (code: number) => void;
  onCwd?: (cwd: string) => void;
};

export function useTerminalSession({
  leafId,
  container,
  visible,
  focused = true,
  initialCwd,
  isPrivate = false,
  onSearchReady,
  onExit,
  onCwd,
}: Options) {
  const cbRef = useRef({ onSearchReady, onExit, onCwd });
  cbRef.current = { onSearchReady, onExit, onCwd };

  // Create terminal and PTY once, detach on cleanup (terminal stays alive)
  useEffect(() => {
    let cancelled = false;
    const s = ensureSession(leafId, initialCwd);
    s.isPrivate = isPrivate;
    const callbacks: Callbacks = {
      onSearchReady: (a) => cbRef.current.onSearchReady?.(a),
      onExit: (c) => cbRef.current.onExit?.(c),
      onCwd: (c) => cbRef.current.onCwd?.(c),
    };

    const node = container.current;
    if (node) attachSession(leafId, node, callbacks);

    // After fonts resolve, refit so character cells are exact
    s.ready.then(() => {
      if (cancelled || s.disposed) return;
      refitSlot(leafId);
    });

    return () => {
      cancelled = true;
      detachSession(leafId);
    };
    // initialCwd intentionally omitted: cwd changes via OSC 7 must not
    // trigger a detach/re-attach cycle that briefly drops the terminal
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leafId, container]);

  // Visibility/focus: refit on show, update cursor blink
  useEffect(() => {
    const s = sessions.get(leafId);
    if (!s) return;
    s.visibleNow = visible;
    s.focusedNow = focused;
    if (visible) {
      // Refit in case the container resized while this tab was hidden
      refitSlot(leafId);
      if (s.term) {
        s.term.options.cursorBlink = focused;
        if (focused) s.term.focus();
      }
    } else if (s.term) {
      s.term.options.cursorBlink = false;
    }
  }, [leafId, visible, focused]);

  // Per-session preference effects — each terminal manages its own options

  const fontSize = usePreferencesStore((p) => p.terminalFontSize);
  const zoomLevel = usePreferencesStore((p) => p.zoomLevel);
  useEffect(() => {
    const s = sessions.get(leafId);
    if (!s?.term || !s.fitAddon) return;
    const size = Math.max(4, Math.round(fontSize * zoomLevel));
    if (s.term.options.fontSize === size) return;
    s.term.options.fontSize = size;
    s.fitAddon.fit();
    s.lastCols = s.term.cols;
    s.lastRows = s.term.rows;
    void s.pty?.resize(s.term.cols, s.term.rows);
  }, [leafId, fontSize, zoomLevel]);

  const fontFamily = usePreferencesStore((p) => p.terminalFontFamily);
  useEffect(() => {
    const s = sessions.get(leafId);
    if (!s?.term || !s.fitAddon) return;
    const resolved = fontFamily || detectMonoFontFamily();
    if (s.term.options.fontFamily === resolved) return;
    s.term.options.fontFamily = resolved;
    s.fitAddon.fit();
    s.lastCols = s.term.cols;
    s.lastRows = s.term.rows;
    void s.pty?.resize(s.term.cols, s.term.rows);
  }, [leafId, fontFamily]);

  const letterSpacing = usePreferencesStore((p) => p.terminalLetterSpacing);
  useEffect(() => {
    const s = sessions.get(leafId);
    if (!s?.term || !s.fitAddon) return;
    if (s.term.options.letterSpacing === letterSpacing) return;
    s.term.options.letterSpacing = letterSpacing;
    s.fitAddon.fit();
  }, [leafId, letterSpacing]);

  const scrollback = usePreferencesStore((p) => p.terminalScrollback);
  useEffect(() => {
    const s = sessions.get(leafId);
    if (!s?.term) return;
    if (s.term.options.scrollback === scrollback) return;
    s.term.options.scrollback = scrollback;
  }, [leafId, scrollback]);

  const webglPref = usePreferencesStore((p) => p.terminalWebglEnabled);
  useEffect(() => {
    const s = sessions.get(leafId);
    if (!s?.term) return;
    if (webglPref && !s.webglAddon) {
      attachWebgl(s);
    } else if (!webglPref && s.webglAddon) {
      try { s.webglAddon.dispose(); } catch {}
      s.webglAddon = null;
    }
  }, [leafId, webglPref]);

  const applyTheme = useCallback(() => {
    const s = sessions.get(leafId);
    if (!s?.term) return;
    s.term.options.theme = buildTerminalTheme();
  }, [leafId]);

  const write = useCallback(
    (data: string) => { void sessions.get(leafId)?.pty?.write(data); },
    [leafId],
  );

  const focus = useCallback(() => {
    sessions.get(leafId)?.term?.focus();
  }, [leafId]);

  const getBuffer = useCallback((maxLines = 200): string | null => {
    const s = sessions.get(leafId);
    if (!s?.term) return null;
    const buf = s.term.buffer.active;
    const total = buf.length;
    const lines: string[] = [];
    const start = Math.max(0, total - maxLines);
    for (let i = start; i < total; i++) {
      lines.push(buf.getLine(i)?.translateToString(true) ?? "");
    }
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    return lines.join("\n");
  }, [leafId]);

  const getSelection = useCallback((): string | null => {
    const s = sessions.get(leafId);
    if (!s?.term) return null;
    const sel = s.term.getSelection();
    return sel.length > 0 ? sel : null;
  }, [leafId]);

  return useMemo(
    () => ({ write, focus, getBuffer, getSelection, applyTheme }),
    [write, focus, getBuffer, getSelection, applyTheme],
  );
}

// ── helpers ────────────────────────────────────────────────────────────────

function isShiftEnter(e: KeyboardEvent): boolean {
  return e.key === "Enter" && e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
}

function isCtrlPaste(e: KeyboardEvent): boolean {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isMac = /Mac|iPhone|iPad/.test(ua);
  const mod = isMac ? (e.metaKey && !e.ctrlKey) : (!e.metaKey && e.ctrlKey);
  return mod && !e.altKey && !e.shiftKey && (e.key === "v" || e.code === "KeyV");
}
