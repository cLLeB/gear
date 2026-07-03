import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  loadPreferences,
  onPreferencesChange,
  setTheme as persistMode,
  setThemeId as persistThemeId,
  type ThemePref,
} from "@/modules/settings/store";
import { applyTheme } from "./applyTheme";
import { loadCustomThemes, onCustomThemesChange } from "./customThemes";
import { getBuiltinTheme, getDefaultTheme } from "./themes";
import { SurfaceLayer } from "./SurfaceLayer";
import type { Theme } from "./types";

type ThemeProviderState = {
  mode: ThemePref;
  resolvedMode: "dark" | "light";
  themeId: string;
  customThemes: Theme[];
  setMode: (mode: ThemePref) => void;
  setThemeId: (id: string) => void;
  /** Apply a theme transiently without persisting; null reverts to committed. */
  previewThemeId: (id: string | null) => void;
};

const ThemeProviderContext = createContext<ThemeProviderState | null>(null);

const FAST_PATH_KEY = "Gear-ui-theme-shadow";
const FAST_PATH_THEME_ID = "Gear-ui-theme-id-shadow";

function readFastMode(fallback: ThemePref): ThemePref {
  if (typeof window === "undefined") return fallback;
  const v = window.localStorage.getItem(FAST_PATH_KEY);
  return v === "dark" || v === "light" || v === "system" ? v : fallback;
}

function readFastThemeId(fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return window.localStorage.getItem(FAST_PATH_THEME_ID) ?? fallback;
}

function writeFastPath(mode: ThemePref, themeId: string): void {
  try {
    window.localStorage.setItem(FAST_PATH_KEY, mode);
    window.localStorage.setItem(FAST_PATH_THEME_ID, themeId);
  } catch {
    // ignore
  }
}

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultMode?: ThemePref;
};

export function ThemeProvider({
  children,
  defaultMode = "system",
}: ThemeProviderProps) {
  const defaultThemeId = getDefaultTheme().id;

  const [mode, setModeState] = useState<ThemePref>(() =>
    readFastMode(defaultMode),
  );
  const [themeId, setThemeIdState] = useState<string>(() =>
    readFastThemeId(defaultThemeId),
  );
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [customThemes, setCustomThemes] = useState<Theme[]>([]);
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    typeof window === "undefined"
      ? true
      : window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const themeIdRef = useRef(themeId);
  themeIdRef.current = themeId;

  useEffect(() => {
    let alive = true;
    void loadPreferences().then((p) => {
      if (!alive) return;
      setModeState(p.theme);
      setThemeIdState(p.themeId);
      writeFastPath(p.theme, p.themeId);
    });
    const unlistenP = onPreferencesChange((key, value) => {
      if (
        key === "theme" &&
        (value === "system" || value === "light" || value === "dark")
      ) {
        setModeState(value);
      }
      if (key === "themeId" && typeof value === "string") {
        setThemeIdState(value);
      }
    });
    return () => {
      alive = false;
      void unlistenP.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void loadCustomThemes().then((themes) => {
      if (alive) setCustomThemes(themes);
    });
    let unlisten: (() => void) | undefined;
    void onCustomThemesChange((themes) => setCustomThemes(themes)).then(
      (un) => { unlisten = un; },
    );
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolvedMode: "dark" | "light" =
    mode === "system" ? (systemDark ? "dark" : "light") : mode;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolvedMode);
  }, [resolvedMode]);

  const effectiveId = previewId ?? themeId;
  useEffect(() => {
    const theme =
      customThemes.find((t) => t.id === effectiveId) ??
      getBuiltinTheme(effectiveId) ??
      getDefaultTheme();
    applyTheme(theme, resolvedMode);
  }, [effectiveId, resolvedMode, customThemes]);

  const setMode = useCallback((next: ThemePref) => {
    setModeState(next);
    writeFastPath(next, themeIdRef.current);
    void persistMode(next);
  }, []);

  const setThemeId = useCallback((next: string) => {
    setPreviewId(null);
    setThemeIdState(next);
    writeFastPath(modeRef.current, next);
    void persistThemeId(next);
  }, []);

  const previewThemeId = useCallback((id: string | null) => {
    setPreviewId(id);
  }, []);

  const value = useMemo<ThemeProviderState>(
    () => ({
      mode,
      resolvedMode,
      themeId,
      customThemes,
      setMode,
      setThemeId,
      previewThemeId,
    }),
    [
      mode,
      resolvedMode,
      themeId,
      customThemes,
      setMode,
      setThemeId,
      previewThemeId,
    ],
  );

  return (
    <ThemeProviderContext.Provider value={value}>
      <SurfaceLayer />
      {children}
    </ThemeProviderContext.Provider>
  );
}

export function useTheme(): ThemeProviderState {
  const ctx = useContext(ThemeProviderContext);
  if (!ctx) throw new Error("useTheme must be used within a <ThemeProvider>");
  return ctx;
}
