/**
 * Git blame rendered as a CodeMirror gutter. The blame data lives in editor
 * state rather than in React so the extension array keeps a stable identity —
 * @uiw/react-codemirror rebuilds the whole state when that identity changes,
 * which would wipe the language compartment on every blame refresh.
 */

import { StateEffect, StateField } from "@codemirror/state";
import { EditorView, gutter, GutterMarker } from "@codemirror/view";
import {
  blameLabel,
  blameTooltip,
  blameHue,
  commitForLine,
  type BlameResult,
} from "./blame";

/** Install a blame result, or clear it with `null` to hide the gutter. */
export const setBlame = StateEffect.define<BlameResult | null>();

export const blameField = StateField.define<BlameResult | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setBlame)) return effect.value;
    }
    return value;
  },
});

export function isBlameVisible(view: EditorView): boolean {
  return view.state.field(blameField, false) != null;
}

class BlameMarker extends GutterMarker {
  constructor(
    private readonly label: string,
    private readonly title: string,
    private readonly hue: number,
  ) {
    super();
  }

  eq(other: BlameMarker): boolean {
    return other.label === this.label && other.title === this.title;
  }

  toDOM(): Node {
    const span = document.createElement("span");
    span.className = "cm-blameEntry";
    span.textContent = this.label;
    span.title = this.title;
    span.style.borderLeftColor = `hsl(${this.hue} 60% 55% / 0.85)`;
    return span;
  }
}

const blameTheme = EditorView.theme({
  ".cm-blameGutter": {
    minWidth: "8.5em",
    color: "var(--muted-foreground)",
    fontSize: "0.85em",
    userSelect: "none",
    cursor: "default",
  },
  ".cm-blameEntry": {
    display: "block",
    paddingLeft: "6px",
    paddingRight: "8px",
    borderLeft: "2px solid transparent",
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
});

export function blameGutter() {
  return [
    blameField,
    blameTheme,
    gutter({
      class: "cm-blameGutter",
      lineMarker(view, block) {
        const blame = view.state.field(blameField, false);
        if (!blame) return null;
        const line = view.state.doc.lineAt(block.from).number;
        const commit = commitForLine(blame, line);
        if (!commit) return null;
        // Only the first line of a run is labelled; repeating the same author
        // down a 40-line block is noise, and the colour bar keeps the grouping
        // legible.
        const previous = line > 1 ? commitForLine(blame, line - 1) : null;
        const label =
          previous && previous.sha === commit.sha
            ? ""
            : blameLabel(commit, Date.now() / 1000);
        return new BlameMarker(
          label,
          blameTooltip(commit),
          blameHue(commit.sha),
        );
      },
      // Without this the gutter collapses to zero width when no line has a
      // marker, making the toggle look broken on an unversioned file.
      initialSpacer: () => new BlameMarker("", "", 0),
    }),
  ];
}
