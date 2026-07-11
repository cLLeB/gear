import { redo, undo } from "@codemirror/commands";
import {
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import { keymap, EditorView } from "@codemirror/view";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useTheme } from "@/modules/theme/ThemeProvider";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { EDITOR_THEME_EXT, resolveEditorTheme } from "./lib/themes";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { Prec } from "@codemirror/state";
import { vim } from "@replit/codemirror-vim";
import {
  buildSharedExtensions,
  indentCompartment,
  indentExtension,
  languageCompartment,
  lspCompartment,
  vimCompartment,
  wrapCompartment,
} from "./lib/extensions";
import { detectIndentUnit } from "./lib/indent";
import { lspFormatDocument, useLspExtension } from "@/modules/lsp";
import { toast } from "sonner";
import {
  applyFormattedContent,
  readFileText,
  resolveFormatter,
  runExternalFormatter,
} from "./lib/externalFormat";
import { convertFileSrc } from "@tauri-apps/api/core";
import { initVimGlobals, vimHandlersExtension } from "./lib/vim";

initVimGlobals();
import { resolveLanguage } from "./lib/languageResolver";
import { FORCE_READ_LIMIT, useDocument } from "./lib/useDocument";
import {
  inlineCompletion,
  triggerInlineCompletion,
} from "./lib/autocomplete/inlineExtension";
import { getKey } from "@/modules/ai/lib/keyring";
import { onKeysChanged } from "@/modules/settings/store";

export type EditorPaneHandle = {
  setQuery: (q: string) => void;
  findNext: () => void;
  findPrevious: () => void;
  clearQuery: () => void;
  focus: () => void;
  getSelection: () => string | null;
  getPath: () => string;
  /** Re-read the file from disk. Skips silently if the buffer is dirty. */
  reload: () => boolean;
  /** Apply CodeMirror's undo/redo commands. */
  undo: () => void;
  redo: () => void;
  /** Open the inline find & replace panel. */
  openFindReplace: () => void;
};

type Props = {
  path: string;
  languageOverride?: string;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: () => void;
  onClose?: () => void;
};

// Only formats the WebView2 (Chromium) engine can actually decode — so we never
// show a broken preview. TIFF/HEIC images and MKV/AVI video are intentionally
// excluded (the engine can't render them).
const IMAGE_EXTS = new Set([
  "png", "jpg", "jpeg", "jfif", "pjpeg", "gif", "webp", "svg", "ico", "bmp",
  "avif", "apng",
]);
const VIDEO_EXTS = new Set(["mp4", "webm", "ogv", "mov", "m4v"]);
const AUDIO_EXTS = new Set([
  "mp3", "wav", "flac", "aac", "m4a", "ogg", "oga", "opus", "weba",
]);

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const EditorPane = forwardRef<EditorPaneHandle, Props>(
  function EditorPane(
    { path, languageOverride, onDirtyChange, onSaved, onClose },
    ref,
  ) {
    const { doc, onChange, save, reload, openAnyway, adoptDiskText } =
      useDocument({
        path,
        onDirtyChange,
      });
    const reloadRef = useRef(reload);
    reloadRef.current = reload;
    const cmRef = useRef<ReactCodeMirrorRef>(null);
    const [findReplaceOpen, setFindReplaceOpen] = useState(false);
    const [findQuery, setFindQuery] = useState("");
    const [replaceQuery, setReplaceQuery] = useState("");
    const findInputRef = useRef<HTMLInputElement>(null);
    const editorThemeId = usePreferencesStore((s) => s.editorTheme);
    const { resolvedMode } = useTheme();
    const vimMode = usePreferencesStore((s) => s.vimMode);
    const wordWrap = usePreferencesStore((s) => s.wordWrap);
    const languageRef = useRef<string | null>(null);
    const apiKeyRef = useRef<string | null>(null);

    useEffect(() => {
      let cancelled = false;
      const refresh = async () => {
        const provider = usePreferencesStore.getState().autocompleteProvider;
        if (
          provider === "lmstudio" ||
          provider === "mlx" ||
          provider === "ollama"
        ) {
          apiKeyRef.current = null;
          return;
        }
        const k = await getKey(provider);
        if (!cancelled) apiKeyRef.current = k;
      };
      void refresh();
      let unlistenKeys: (() => void) | undefined;
      void onKeysChanged(() => void refresh()).then((un) => {
        unlistenKeys = un;
      });
      const unsubPrefs = usePreferencesStore.subscribe((state, prev) => {
        if (state.autocompleteProvider !== prev.autocompleteProvider) {
          void refresh();
        }
      });
      return () => {
        cancelled = true;
        unlistenKeys?.();
        unsubPrefs();
      };
    }, []);
    const themeExt = EDITOR_THEME_EXT[resolveEditorTheme(editorThemeId, resolvedMode)] ?? EDITOR_THEME_EXT.atomone;

    // Stabilize save + onSaved via refs so the extensions array never changes
    // identity — a new identity makes @uiw/react-codemirror reconfigure the
    // whole state, wiping the language compartment.
    const saveRef = useRef(save);
    saveRef.current = save;
    const onSavedRef = useRef(onSaved);
    onSavedRef.current = onSaved;
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;
    const adoptDiskTextRef = useRef(adoptDiskText);
    adoptDiskTextRef.current = adoptDiskText;

    const pathRef = useRef(path);
    pathRef.current = path;

    // Save, honoring format-on-save: LSP formatters run in-buffer before the
    // write; external CLI formatters run after (they rewrite the file on disk),
    // then the result is read back and adopted without a dirty flash.
    const performSave = useCallback(async () => {
      const view = cmRef.current?.view;
      const prefs = usePreferencesStore.getState();
      const formatter = resolveFormatter(languageRef.current, prefs);
      if (prefs.editorFormatOnSave && formatter === "lsp" && view) {
        try {
          await lspFormatDocument(view);
        } catch (e) {
          toast.error("Language server format failed", {
            description: String(e),
          });
        }
      }
      // Snapshot: edits typed during the formatter round-trip must not be
      // clobbered by the disk read-back.
      const docAtSave = view?.state.doc;
      const saved = await saveRef.current();
      if (!saved) return;
      if (prefs.editorFormatOnSave && formatter !== "lsp") {
        const error = await runExternalFormatter(
          formatter,
          pathRef.current,
          prefs.editorCustomFormatCommand,
        );
        if (error) {
          toast.error(`${formatter} format failed`, { description: error });
        } else {
          const readBack = await readFileText(pathRef.current);
          if (readBack !== null && view && view.state.doc === docAtSave) {
            applyFormattedContent(
              view,
              adoptDiskTextRef.current(readBack.text, readBack.mtime),
            );
          }
        }
      }
      onSavedRef.current?.();
    }, []);
    const performSaveRef = useRef(performSave);
    performSaveRef.current = performSave;

    // LSP: presets key languages by file extension; enable once the doc is ready.
    const langId = useMemo(
      () => languageOverride ?? (path.split(".").pop()?.toLowerCase() ?? null),
      [path, languageOverride],
    );
    const lspExt = useLspExtension(path, langId, doc.status === "ready");

    const extensions = useMemo(
      () => [
        // basicSetup is added before user extensions by @uiw/react-codemirror,
        // so we must elevate vim's precedence to win the keymap.
        vimCompartment.of(
          usePreferencesStore.getState().vimMode ? Prec.highest(vim()) : [],
        ),
        vimHandlersExtension(() => ({
          save: () => {
            void performSaveRef.current();
          },
          close: () => onCloseRef.current?.(),
        })),
        ...buildSharedExtensions(),
        languageCompartment.of([]),
        lspCompartment.of([]),
        inlineCompletion({
          getPrefs: () => {
            const s = usePreferencesStore.getState();
            const p = s.autocompleteProvider;
            const modelId =
              p === "lmstudio"
                ? s.lmstudioModelId
                : p === "mlx"
                  ? s.mlxModelId
                  : p === "ollama"
                    ? s.ollamaModelId
                    : p === "openai-compatible"
                      ? s.openaiCompatibleModelId
                      : p === "openrouter"
                        ? s.openrouterModelId
                        : s.autocompleteModelId;
            return {
              enabled: s.autocompleteEnabled,
              trigger: s.autocompleteTrigger,
              provider: p,
              modelId,
              apiKey: apiKeyRef.current,
              lmstudioBaseURL: s.lmstudioBaseURL,
              mlxBaseURL: s.mlxBaseURL,
              ollamaBaseURL: s.ollamaBaseURL,
              openaiCompatibleBaseURL: s.openaiCompatibleBaseURL,
            };
          },
          getPath: () => pathRef.current,
          getLanguage: () => languageRef.current,
        }),
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              void performSaveRef.current();
              return true;
            },
          },
          {
            // Manual AI autocomplete trigger (VS Code's Alt+\\ convention),
            // used when the trigger mode is "manual".
            key: "Alt-\\",
            preventDefault: true,
            run: (view) => triggerInlineCompletion(view),
          },
        ]),
      ],
      [],
    );

    useEffect(() => {
      const view = cmRef.current?.view;
      if (!view) return;
      view.dispatch({
        effects: vimCompartment.reconfigure(
          vimMode ? Prec.highest(vim()) : [],
        ),
      });
    }, [vimMode]);

    useEffect(() => {
      const view = cmRef.current?.view;
      if (!view) return;
      view.dispatch({
        effects: wrapCompartment.reconfigure(
          wordWrap ? EditorView.lineWrapping : [],
        ),
      });
    }, [wordWrap]);

    useEffect(() => {
      let cancelled = false;
      // A manual override resolves against a synthetic filename so the language
      // is picked by the chosen extension instead of the file's real one.
      const resolveTarget = languageOverride ? `_.${languageOverride}` : path;
      languageRef.current =
        languageOverride ?? (path.split(".").pop()?.toLowerCase() ?? null);
      resolveLanguage(resolveTarget).then((ext) => {
        if (cancelled) return;
        const view = cmRef.current?.view;
        if (!view) return;
        view.dispatch({
          effects: languageCompartment.reconfigure(ext ?? []),
        });
      });
      return () => {
        cancelled = true;
      };
    }, [path, doc.status, languageOverride]);

    // Match the file's own indentation (tabs vs N spaces) once it loads, so
    // edits don't fight the existing style.
    const readyContent = doc.status === "ready" ? doc.content : null;
    useEffect(() => {
      if (readyContent === null) return;
      const view = cmRef.current?.view;
      if (!view) return;
      view.dispatch({
        effects: indentCompartment.reconfigure(
          indentExtension(detectIndentUnit(readyContent)),
        ),
      });
    }, [readyContent]);

    // Swap the LSP extension in/out as activation and readiness change.
    useEffect(() => {
      const view = cmRef.current?.view;
      if (!view) return;
      view.dispatch({
        effects: lspCompartment.reconfigure(lspExt ?? []),
      });
    }, [lspExt]);

    const applySearchQuery = useCallback((search: string, replace: string) => {
      const view = cmRef.current?.view;
      if (!view) return;
      view.dispatch({
        effects: setSearchQuery.of(
          new SearchQuery({ search, replace, caseSensitive: false }),
        ),
      });
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        setQuery: (q: string) => {
          const view = cmRef.current?.view;
          if (!view) return;
          view.dispatch({
            effects: setSearchQuery.of(
              new SearchQuery({ search: q, caseSensitive: false }),
            ),
          });
          if (q) findNext(view);
        },
        findNext: () => {
          const view = cmRef.current?.view;
          if (view) findNext(view);
        },
        findPrevious: () => {
          const view = cmRef.current?.view;
          if (view) findPrevious(view);
        },
        clearQuery: () => {
          const view = cmRef.current?.view;
          if (!view) return;
          view.dispatch({
            effects: setSearchQuery.of(new SearchQuery({ search: "" })),
          });
        },
        focus: () => {
          cmRef.current?.view?.focus();
        },
        getSelection: () => {
          const view = cmRef.current?.view;
          if (!view) return null;
          const { from, to } = view.state.selection.main;
          if (from === to) return null;
          return view.state.sliceDoc(from, to);
        },
        getPath: () => path,
        reload: () => reloadRef.current(),
        undo: () => {
          const view = cmRef.current?.view;
          if (view) undo(view);
        },
        redo: () => {
          const view = cmRef.current?.view;
          if (view) redo(view);
        },
        openFindReplace: () => {
          setFindReplaceOpen(true);
          window.setTimeout(() => findInputRef.current?.focus(), 0);
        },
      }),
      [path],
    );

    if (doc.status === "loading") {
      return (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          Loading…
        </div>
      );
    }
    if (doc.status === "error") {
      return (
        <div className="flex h-full items-center justify-center px-6 text-center text-xs text-destructive">
          {doc.message}
        </div>
      );
    }

    // Media preview by extension — independent of how the reader classified the
    // file, so it works whether the file comes back binary, too-large, or text.
    const mediaExt = path.split(".").pop()?.toLowerCase() ?? "";
    const isImage = IMAGE_EXTS.has(mediaExt);
    const isVideo = VIDEO_EXTS.has(mediaExt);
    const isAudio = AUDIO_EXTS.has(mediaExt);
    const isPdf = mediaExt === "pdf";
    if (isImage || isVideo || isAudio || isPdf) {
      const assetUrl = convertFileSrc(path);
      const name = path.split(/[\\/]/).pop();
      return (
        <div className="flex h-full min-h-0 flex-col items-center justify-center overflow-auto bg-background p-4">
          {isImage && (
            <img
              src={assetUrl}
              loading="lazy"
              decoding="async"
              className="max-h-full max-w-full rounded-md border border-border object-contain shadow-sm"
              alt={name}
            />
          )}
          {isVideo && (
            // biome-ignore lint/a11y/useMediaCaption: local media preview, no caption track
            <video controls preload="metadata" className="max-h-full max-w-full" src={assetUrl} />
          )}
          {isAudio && (
            // biome-ignore lint/a11y/useMediaCaption: local media preview, no caption track
            <audio controls preload="metadata" className="w-full max-w-md" src={assetUrl} />
          )}
          {isPdf && (
            <iframe src={assetUrl} className="h-full w-full border-none" title={name} />
          )}
        </div>
      );
    }

    if (doc.status === "binary") {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
          <div className="text-sm text-foreground">Binary file</div>
          <div className="text-xs text-muted-foreground">
            {formatBytes(doc.size)} · preview not supported
          </div>
        </div>
      );
    }
    if (doc.status === "toolarge") {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
          <div className="text-sm text-foreground">File too large</div>
          <div className="text-xs text-muted-foreground">
            {formatBytes(doc.size)} exceeds the {formatBytes(doc.limit)} limit.
          </div>
          {doc.size <= FORCE_READ_LIMIT && (
            <button
              type="button"
              onClick={openAnyway}
              className="mt-1 rounded-md border border-border px-2.5 py-1 text-xs text-foreground/85 hover:bg-accent"
            >
              Open anyway
            </button>
          )}
        </div>
      );
    }

    return (
      <div className="flex h-full min-h-0 flex-col zoom-exempt">
        <CodeMirror
          ref={cmRef}
          value={doc.content}
          onChange={onChange}
          theme={themeExt}
          extensions={extensions}
          height="100%"
          className="flex-1 min-h-0 overflow-hidden"
          basicSetup={{
            lineNumbers: true,
            highlightActiveLineGutter: true,
            foldGutter: true,
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: true,
            highlightActiveLine: true,
            highlightSelectionMatches: true,
            searchKeymap: true,
          }}
        />
        {findReplaceOpen && (
          <div className="flex shrink-0 flex-col gap-1 border-t border-border/60 bg-card p-2">
            <div className="flex items-center gap-1.5">
              <input
                ref={findInputRef}
                type="text"
                placeholder="Find"
                value={findQuery}
                onChange={(e) => {
                  setFindQuery(e.target.value);
                  applySearchQuery(e.target.value, replaceQuery);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const view = cmRef.current?.view;
                    if (view) (e.shiftKey ? findPrevious : findNext)(view);
                  }
                  if (e.key === "Escape") {
                    setFindReplaceOpen(false);
                    cmRef.current?.view?.focus();
                  }
                }}
                className="h-7 w-48 rounded border border-border bg-background px-2 text-[12px] outline-none focus:border-foreground/40"
              />
              <button
                type="button"
                title="Previous (Shift+Enter)"
                onClick={() => { const v = cmRef.current?.view; if (v) findPrevious(v); }}
                className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                ↑
              </button>
              <button
                type="button"
                title="Next (Enter)"
                onClick={() => { const v = cmRef.current?.view; if (v) findNext(v); }}
                className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                ↓
              </button>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => {
                  setFindReplaceOpen(false);
                  applySearchQuery("", "");
                  cmRef.current?.view?.focus();
                }}
                className="rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                ✕
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                placeholder="Replace"
                value={replaceQuery}
                onChange={(e) => {
                  setReplaceQuery(e.target.value);
                  applySearchQuery(findQuery, e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setFindReplaceOpen(false);
                    cmRef.current?.view?.focus();
                  }
                }}
                className="h-7 w-48 rounded border border-border bg-background px-2 text-[12px] outline-none focus:border-foreground/40"
              />
              <button
                type="button"
                onClick={() => { const v = cmRef.current?.view; if (v) replaceNext(v); }}
                className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                Replace
              </button>
              <button
                type="button"
                onClick={() => { const v = cmRef.current?.view; if (v) replaceAll(v); }}
                className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                All
              </button>
            </div>
          </div>
        )}
      </div>
    );
  },
);
