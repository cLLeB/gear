// A read-only diff of two texts in a dialog — "compare with clipboard",
// "compare with file". Original on the left of each change, modified inline.

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { unifiedMergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo } from "react";
import { create } from "zustand";
import { DIFF_THEME } from "@/modules/editor/GitDiffPane";
import { buildSharedExtensions } from "@/modules/editor/lib/extensions";
import { resolveLanguageSync } from "@/modules/editor/lib/languageResolver";
import { EDITOR_THEME_EXT } from "@/modules/editor/lib/themes";

export interface CompareRequest {
  title: string;
  originalLabel: string;
  modifiedLabel: string;
  original: string;
  modified: string;
  /** File name used to pick syntax highlighting. */
  languageHint?: string;
  /** Show `modified` alone (a read-only text viewer) instead of a diff. */
  viewOnly?: boolean;
}

/** Read-only viewer for generated text (hex dumps, reports). */
export function openTextViewer(title: string, text: string, languageHint?: string): void {
  openCompare({ title, originalLabel: "", modifiedLabel: "", original: text, modified: text, languageHint, viewOnly: true });
}

export const useCompareStore = create<{ request: CompareRequest | null }>(() => ({ request: null }));

export function openCompare(request: CompareRequest): void {
  useCompareStore.setState({ request });
}

const SHARED = buildSharedExtensions();

export function CompareDialog() {
  const request = useCompareStore((s) => s.request);
  const editorThemeId = usePreferencesStore((s) => s.editorTheme);
  const themeExt = EDITOR_THEME_EXT[editorThemeId] ?? EDITOR_THEME_EXT.atomone;
  const extensions = useMemo(() => {
    if (!request) return [];
    const lang = request.languageHint ? resolveLanguageSync(request.languageHint) : null;
    return [
      ...SHARED,
      ...(lang ? [lang] : []),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      ...(request.viewOnly ? [] : [unifiedMergeView({
        original: request.original,
        mergeControls: false,
        highlightChanges: true,
        gutter: true,
        syntaxHighlightDeletions: true,
        collapseUnchanged: { margin: 3, minSize: 8 },
      }),
      DIFF_THEME]),
    ];
  }, [request]);
  if (!request) return null;
  const same = request.original === request.modified;
  return (
    <Dialog open onOpenChange={(open) => !open && useCompareStore.setState({ request: null })}>
      <DialogContent className="flex h-[min(80vh,900px)] w-[min(1100px,calc(100vw-32px))] max-w-none flex-col gap-2 p-3 sm:max-w-none">
        <DialogTitle className="text-sm">{request.title}</DialogTitle>
        <div className={request.viewOnly ? "hidden" : "flex items-center gap-3 text-[11.5px] text-muted-foreground"}>
          <span className="rounded-sm bg-red-500/15 px-1.5 py-0.5">− {request.originalLabel}</span>
          <span className="rounded-sm bg-green-500/15 px-1.5 py-0.5">+ {request.modifiedLabel}</span>
          {same ? <span>Identical</span> : null}
        </div>
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
          <CodeMirror
            value={request.modified}
            theme={themeExt}
            extensions={extensions}
            editable={false}
            height="100%"
            className="h-full"
            basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: false }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
