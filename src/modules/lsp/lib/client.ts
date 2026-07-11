import { highlightingFor, indentUnit, language } from "@codemirror/language";
import { highlightCode } from "@lezer/highlight";
import {
  type Extension,
  StateEffect,
  StateField,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
} from "@codemirror/view";
import {
  LanguageServerClient,
  languageServerPlugin,
  renameSymbol,
} from "codemirror-languageserver";
import {
  type LocationItem,
  locationsPanel,
  openLocationsPanel,
} from "./locationsPanel";
import { fileUriToPath } from "./uri";

export {
  languageServerWithTransport,
  SynchronizationMethod,
} from "codemirror-languageserver";

type LspPos = { line: number; character: number };
type LspRange = { start: LspPos };
type LspLocation = { uri: string; range: LspRange };

function offsetOf(doc: Text, pos: LspPos): number {
  if (pos.line >= doc.lines) return doc.length;
  const line = doc.line(pos.line + 1);
  return Math.min(line.from + pos.character, line.to);
}

// The lib's formatDocument command fires and forgets; save needs to await
// the edits before writing to disk.
export async function formatDocumentAndWait(
  view: EditorView,
): Promise<boolean> {
  const plugin = view.plugin(languageServerPlugin);
  if (!plugin) return false;
  const { client } = plugin;
  if (!client.ready || !client.capabilities?.documentFormattingProvider) {
    return false;
  }
  const doc = view.state.doc;
  const edits = await client.textDocumentFormatting({
    textDocument: { uri: plugin.documentUri },
    options: {
      tabSize: view.state.tabSize,
      insertSpaces: view.state.facet(indentUnit) !== "\t",
    },
  });
  if (!edits || edits.length === 0) return false;
  // Edits are offsets into the requested snapshot; typing during the
  // round-trip would corrupt the document.
  if (view.state.doc !== doc) return false;
  view.dispatch({
    changes: edits.map((e) => ({
      from: offsetOf(doc, e.range.start),
      to: offsetOf(doc, e.range.end),
      insert: e.newText,
    })),
  });
  return true;
}

// ── LSP hover code highlighting + cmd-hover link affordance (e874b39) ──
function highlightBlock(el: HTMLElement, view: EditorView): void {
  const lang = view.state.facet(language);
  const code = el.textContent;
  if (!lang || !code) return;
  const frag = document.createDocumentFragment();
  highlightCode(
    code,
    lang.parser.parse(code),
    { style: (tags) => highlightingFor(view.state, tags) },
    (text, classes) => {
      if (!classes) {
        frag.appendChild(document.createTextNode(text));
        return;
      }
      const span = document.createElement("span");
      span.className = classes;
      span.textContent = text;
      frag.appendChild(span);
    },
    () => frag.appendChild(document.createTextNode("\n")),
  );
  el.replaceChildren(frag);
}

// Tooltip docs arrive as plain markdown-rendered code; tokenize them with
// the file's own parser so signatures match the editor theme. Tooltips are
// direct children of the editor DOM, so the outer observer never fires on
// typing; the subtree observer lives only while a tooltip is mounted.
const hoverCodeHighlight = ViewPlugin.define((view) => {
  const seen = new WeakSet<HTMLElement>();
  const inner = new Map<Element, MutationObserver>();

  const scan = (root: Element) => {
    const blocks = root.querySelectorAll<HTMLElement>(
      ".documentation pre code",
    );
    for (const el of blocks) {
      if (seen.has(el)) continue;
      seen.add(el);
      highlightBlock(el, view);
    }
  };

  const outer = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (
          !(node instanceof Element) ||
          !node.classList.contains("cm-tooltip")
        ) {
          continue;
        }
        scan(node);
        const ob = new MutationObserver(() => scan(node));
        ob.observe(node, { childList: true, subtree: true });
        inner.set(node, ob);
      }
      for (const node of m.removedNodes) {
        if (!(node instanceof Element)) continue;
        inner.get(node)?.disconnect();
        inner.delete(node);
      }
    }
  });
  outer.observe(view.dom, { childList: true });

  return {
    destroy: () => {
      outer.disconnect();
      for (const ob of inner.values()) ob.disconnect();
      inner.clear();
    },
  };
});

const setLinkRange = StateEffect.define<{ from: number; to: number } | null>();
const linkMark = Decoration.mark({ class: "cm-lsp-link" });

const linkField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setLinkRange)) {
        return e.value
          ? Decoration.set([linkMark.range(e.value.from, e.value.to)])
          : Decoration.none;
      }
    }
    return tr.docChanged ? Decoration.none : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function currentLink(view: EditorView): { from: number; to: number } | null {
  const iter = view.state.field(linkField).iter();
  return iter.value ? { from: iter.from, to: iter.to } : null;
}

function updateLink(view: EditorView, event: MouseEvent | null): void {
  const prev = currentLink(view);
  let next: { from: number; to: number } | null = null;
  if (event && (event.metaKey || event.ctrlKey)) {
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos != null) next = view.state.wordAt(pos);
  }
  if (prev?.from === next?.from && prev?.to === next?.to) return;
  view.dispatch({ effects: setLinkRange.of(next) });
}

// Cmd/Ctrl-hover underlines the symbol under the pointer, matching the
// mod-click go-to-definition affordance.
const linkHover: Extension = [
  linkField,
  EditorView.domEventHandlers({
    mousemove: (event, view) => updateLink(view, event),
    keyup: (event, view) => {
      if (event.key === "Meta" || event.key === "Control") {
        updateLink(view, null);
      }
    },
    mouseleave: (_e, view) => updateLink(view, null),
  }),
  EditorView.theme({
    ".cm-lsp-link": {
      textDecoration: "underline",
      textUnderlineOffset: "2.5px",
      color: "var(--primary)",
      cursor: "pointer",
    },
  }),
];

export function lspInteractions(opts: {
  client: GearLspClient;
  documentUri: string;
  rootPath: string;
  onExternal: (uri: string, line: number) => void;
}): Extension {
  const positionAt = (view: EditorView, pos: number): LspPos => {
    const line = view.state.doc.lineAt(pos);
    return { line: line.number - 1, character: pos - line.from };
  };

  const navigate = (view: EditorView, loc: LspLocation): void => {
    if (loc.uri === opts.documentUri) {
      const targetLine = Math.min(
        loc.range.start.line + 1,
        view.state.doc.lines,
      );
      const lineObj = view.state.doc.line(targetLine);
      const target = Math.min(
        lineObj.from + loc.range.start.character,
        lineObj.to,
      );
      view.dispatch({
        selection: { anchor: target },
        effects: EditorView.scrollIntoView(target, { y: "center" }),
      });
      view.focus();
    } else {
      opts.onExternal(loc.uri, loc.range.start.line + 1);
    }
  };

  const label = (loc: LspLocation): string => {
    const path = fileUriToPath(loc.uri) ?? loc.uri;
    const rel = path.startsWith(`${opts.rootPath}/`)
      ? path.slice(opts.rootPath.length + 1)
      : path;
    return `${rel}:${loc.range.start.line + 1}`;
  };

  const showResults = (
    view: EditorView,
    title: string,
    locs: LspLocation[],
  ): void => {
    if (locs.length === 0) return;
    if (locs.length === 1) {
      navigate(view, locs[0]);
      return;
    }
    const byLoc = new Map<string, LspLocation>();
    for (const loc of locs) byLoc.set(label(loc), loc);
    const items: LocationItem[] = [...byLoc.entries()]
      .map(([text, loc]) => ({
        uri: loc.uri,
        line: loc.range.start.line,
        character: loc.range.start.character,
        label: text,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    openLocationsPanel(view, {
      title,
      items,
      onPick: (item) =>
        navigate(view, {
          uri: item.uri,
          range: { start: { line: item.line, character: item.character } },
        }),
    });
  };

  const findReferences = async (
    view: EditorView,
    pos: number,
  ): Promise<void> => {
    let result: LspLocation[] | null;
    try {
      result = await opts.client.textDocumentReferences({
        textDocument: { uri: opts.documentUri },
        position: positionAt(view, pos),
        context: { includeDeclaration: true },
      });
    } catch {
      return;
    }
    showResults(view, "References", result ?? []);
  };
  const gotoDefinition = async (
    view: EditorView,
    pos: number,
  ): Promise<void> => {
    const line = view.state.doc.lineAt(pos);
    let result: Awaited<
      ReturnType<LanguageServerClient["textDocumentDefinition"]>
    >;
    try {
      result = await opts.client.textDocumentDefinition({
        textDocument: { uri: opts.documentUri },
        position: { line: line.number - 1, character: pos - line.from },
      });
    } catch {
      return;
    }
    const loc = Array.isArray(result) ? result[0] : result;
    if (!loc) return;
    const uri = "uri" in loc ? loc.uri : loc.targetUri;
    const range: LspRange | undefined =
      "range" in loc
        ? loc.range
        : (loc.targetSelectionRange ?? loc.targetRange);
    if (!uri || !range) return;
    if (uri === opts.documentUri) {
      const targetLine = Math.min(range.start.line + 1, view.state.doc.lines);
      const target = Math.min(
        view.state.doc.line(targetLine).from + range.start.character,
        view.state.doc.length,
      );
      view.dispatch({
        selection: { anchor: target },
        effects: EditorView.scrollIntoView(target, { y: "center" }),
      });
      view.focus();
    } else {
      opts.onExternal(uri, range.start.line + 1);
    }
  };

  return [
    locationsPanel,
    hoverCodeHighlight,
    linkHover,
    keymap.of([
      {
        key: "F12",
        preventDefault: true,
        run: (view) => {
          void gotoDefinition(view, view.state.selection.main.head);
          return true;
        },
      },
      {
        key: "Shift-F12",
        preventDefault: true,
        run: (view) => {
          void findReferences(view, view.state.selection.main.head);
          return true;
        },
      },
      {
        key: "F2",
        preventDefault: true,
        run: renameSymbol,
      },
      {
        key: "Shift-Alt-f",
        preventDefault: true,
        run: (view) => {
          void formatDocumentAndWait(view);
          return true;
        },
      },
    ]),
    EditorView.domEventHandlers({
      mousedown: (event, view) => {
        if (!(event.metaKey || event.ctrlKey) || event.button !== 0) {
          return false;
        }
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos == null) return false;
        void gotoDefinition(view, pos);
        return true;
      },
    }),
  ];
}

type RawRpc = {
  notify(method: string, params: unknown): Promise<void>;
  request(method: string, params: unknown, timeout: number): Promise<unknown>;
};

// The lib's notify/request maps omit didClose, didSave and the
// shutdown/exit handshake; servers need all three for correct lifecycle.
export class GearLspClient extends LanguageServerClient {
  static hostPid: number | null = null;

  // The lib omits the publishDiagnostics capability and servers like
  // typescript-language-server push no diagnostics without it. processId
  // enables the server-side parent watchdog.
  protected override getInitializeParams() {
    const params = super.getInitializeParams();
    params.processId = GearLspClient.hostPid;
    params.capabilities.textDocument = {
      ...params.capabilities.textDocument,
      publishDiagnostics: { relatedInformation: true },
    };
    return params;
  }

  textDocumentDidClose(uri: string): void {
    void this.raw.notify("textDocument/didClose", { textDocument: { uri } });
  }

  textDocumentDidSave(uri: string): void {
    void this.raw.notify("textDocument/didSave", { textDocument: { uri } });
  }

  // The bundled lib doesn't type textDocument/references; go through the raw
  // transport (standard LSP — every server implements it).
  async textDocumentReferences(params: {
    textDocument: { uri: string };
    position: LspPos;
    context: { includeDeclaration: boolean };
  }): Promise<LspLocation[] | null> {
    const res = await this.raw.request(
      "textDocument/references",
      params,
      8000,
    );
    return (res as LspLocation[] | null) ?? null;
  }

  async shutdownGracefully(timeoutMs = 2000): Promise<void> {
    try {
      await this.raw.request("shutdown", null, timeoutMs);
      await this.raw.notify("exit", null);
    } catch {
      // Server already dead or unresponsive; the transport kill follows.
    }
  }

  private get raw(): RawRpc {
    return this as unknown as RawRpc;
  }
}
