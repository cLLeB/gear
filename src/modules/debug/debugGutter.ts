// Editor integration for the debugger: a breakpoint gutter (click to toggle,
// right-click for condition / hit count / logpoint), the paused line, inline
// variable values while paused, and breakpoints that follow edits.

import { type EditorState, RangeSet, RangeSetBuilder, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, gutter, GutterMarker, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { inputBox, quickPick } from "@/modules/quick-pick";
import { getFeature } from "@/modules/settings/useFeature";
import type { SourceBreakpoint } from "./debugSession";
import { activeEntry, breakpointsIn, moveBreakpoints, removeBreakpoint, runToLine, setBreakpointEnabled, toggleBreakpoint, upsertBreakpoint, useDebugStore } from "./store";

interface Snapshot {
  bps: (SourceBreakpoint & { verified: boolean | null })[];
  /** 1-based line where the selected frame is paused in this file, or null. */
  pausedLine: number | null;
  topFrame: boolean;
  inline: Map<number, string>;
}

const setSnapshot = StateEffect.define<Snapshot>();
const EMPTY: Snapshot = { bps: [], pausedLine: null, topFrame: true, inline: new Map() };

const snapshotField = StateField.define<Snapshot>({
  create: () => EMPTY,
  update: (v, tr) => {
    for (const e of tr.effects) if (e.is(setSnapshot)) return e.value;
    return v;
  },
});

class BpMarker extends GutterMarker {
  constructor(readonly bp: Snapshot["bps"][number]) {
    super();
  }
  eq(o: BpMarker) {
    return o.bp.line === this.bp.line && o.bp.enabled === this.bp.enabled && o.bp.verified === this.bp.verified && o.bp.condition === this.bp.condition && o.bp.logMessage === this.bp.logMessage && o.bp.hitCondition === this.bp.hitCondition;
  }
  toDOM() {
    const el = document.createElement("div");
    const b = this.bp;
    el.className = `cm-bp ${b.logMessage ? "cm-bp-log" : ""} ${b.condition || b.hitCondition ? "cm-bp-cond" : ""} ${!b.enabled ? "cm-bp-off" : b.verified === false ? "cm-bp-unverified" : ""}`;
    el.title = [b.logMessage ? `Logpoint: ${b.logMessage}` : "Breakpoint", b.condition ? `when ${b.condition}` : "", b.hitCondition ? `hit count ${b.hitCondition}` : "", !b.enabled ? "(disabled)" : b.verified === false ? "(not bound — no code on this line, or the file isn't loaded yet)" : "", "Click to remove · right-click for options"]
      .filter(Boolean)
      .join("\n");
    return el;
  }
}

class PausedMarker extends GutterMarker {
  constructor(readonly top: boolean) {
    super();
  }
  eq(o: PausedMarker) {
    return o.top === this.top;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = `cm-paused-arrow ${this.top ? "" : "cm-paused-caller"}`;
    el.textContent = "➜";
    return el;
  }
}

class HintMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement("div");
    el.className = "cm-bp-hint";
    return el;
  }
}
const hint = new HintMarker();

function markers(view: EditorView): RangeSet<GutterMarker> {
  const snap = view.state.field(snapshotField);
  const doc = view.state.doc;
  const items: { pos: number; m: GutterMarker }[] = [];
  for (const b of snap.bps) if (b.line >= 1 && b.line <= doc.lines) items.push({ pos: doc.line(b.line).from, m: new BpMarker(b) });
  if (snap.pausedLine && snap.pausedLine <= doc.lines && !snap.bps.some((b) => b.line === snap.pausedLine)) items.push({ pos: doc.line(snap.pausedLine).from, m: new PausedMarker(snap.topFrame) });
  items.sort((a, b) => a.pos - b.pos);
  const b = new RangeSetBuilder<GutterMarker>();
  for (const i of items) b.add(i.pos, i.pos, i.m);
  return b.finish();
}

async function breakpointMenu(path: string, line: number): Promise<void> {
  const existing = breakpointsIn(path).find((b) => b.line === line);
  const paused = activeEntry()?.state.status === "stopped";
  const pick = await quickPick(
    [
      ...(existing ? [{ label: existing.enabled ? "Disable breakpoint" : "Enable breakpoint", value: "toggle" }, { label: "Remove breakpoint", value: "remove" }] : [{ label: "Add breakpoint", value: "add" }]),
      { label: existing?.condition ? `Edit condition (${existing.condition})` : "Add conditional breakpoint…", value: "condition" },
      { label: existing?.hitCondition ? `Edit hit count (${existing.hitCondition})` : "Break after N hits…", value: "hit" },
      { label: existing?.logMessage ? "Edit logpoint message" : "Add logpoint (log a message, don't stop)…", value: "log" },
      ...(paused ? [{ label: "Run to this line", value: "run" }] : []),
    ],
    { title: `Line ${line}` },
  );
  if (!pick) return;
  const base: SourceBreakpoint = existing ?? { line, enabled: true };
  if (pick === "add") upsertBreakpoint(path, base);
  else if (pick === "toggle") setBreakpointEnabled(path, line, !base.enabled);
  else if (pick === "remove") removeBreakpoint(path, line);
  else if (pick === "run") void runToLine(path, line);
  else if (pick === "condition") {
    const v = await inputBox({ title: "Break when this expression is true", placeholder: "e.g. i > 10 && user.id == 42", value: base.condition ?? "" });
    if (v !== undefined) upsertBreakpoint(path, { ...base, condition: v.trim() || undefined, enabled: true });
  } else if (pick === "hit") {
    const v = await inputBox({ title: "Break when the hit count satisfies", placeholder: "e.g. 5   or   >= 10   or   % 3", value: base.hitCondition ?? "" });
    if (v !== undefined) upsertBreakpoint(path, { ...base, hitCondition: v.trim() || undefined, enabled: true });
  } else if (pick === "log") {
    const v = await inputBox({ title: "Log message ({expression} is interpolated)", placeholder: "user={user.name} total={total}", value: base.logMessage ?? "" });
    if (v !== undefined) upsertBreakpoint(path, { ...base, logMessage: v.trim() || undefined, enabled: true });
  }
}

class InlineValue extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(o: InlineValue) {
    return o.text === this.text;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-inline-value";
    s.textContent = this.text;
    return s;
  }
}

const pausedLineDeco = Decoration.line({ class: "cm-paused-line" });
const callerLineDeco = Decoration.line({ class: "cm-paused-caller-line" });

function lineDecorations(state: EditorState): DecorationSet {
  const snap = state.field(snapshotField);
  const doc = state.doc;
  const b = new RangeSetBuilder<Decoration>();
  const items: { pos: number; d: Decoration }[] = [];
  if (snap.pausedLine && snap.pausedLine <= doc.lines) items.push({ pos: doc.line(snap.pausedLine).from, d: snap.topFrame ? pausedLineDeco : callerLineDeco });
  for (const [line, text] of snap.inline) if (line <= doc.lines) items.push({ pos: doc.line(line).to, d: Decoration.widget({ widget: new InlineValue(text), side: 1 }) });
  items.sort((x, y) => x.pos - y.pos);
  for (const i of items) b.add(i.pos, i.pos, i.d);
  return b.finish();
}

/** `name = value` hints for lines up to the paused line that mention a local. */
export function inlineHints(lines: (n: number) => string, pausedLine: number, values: Map<string, string>, span = 40): Map<number, string> {
  const out = new Map<number, string>();
  if (!values.size) return out;
  for (let n = Math.max(1, pausedLine - span); n <= pausedLine; n++) {
    const text = lines(n).replace(/(\/\/|#).*$/, "");
    const names: string[] = [];
    for (const m of text.matchAll(/[A-Za-z_$][\w$]*/g)) if (values.has(m[0]) && !names.includes(m[0])) names.push(m[0]);
    if (names.length) out.set(n, names.slice(0, 4).map((k) => `${k} = ${values.get(k)}`).join(", "));
  }
  return out;
}

function compact(v: string): string {
  const one = v.replace(/\s+/g, " ");
  return one.length > 48 ? `${one.slice(0, 45)}…` : one;
}

/** Breakpoint gutter + paused-line + inline values for the file at `getPath()`. */
export function debugGutter(getPath: () => string): Extension {
  const norm = () => getPath().replace(/\\/g, "/");
  const plugin = ViewPlugin.fromClass(
    class {
      off: () => void;
      inlineKey = "";
      constructor(readonly view: EditorView) {
        this.off = useDebugStore.subscribe(() => this.refresh());
        queueMicrotask(() => this.refresh());
      }
      refresh() {
        const path = norm();
        if (!path) return;
        const s = useDebugStore.getState();
        const entry = s.sessions.find((e) => e.id === s.activeId);
        const verified = entry?.state.verified[path];
        const live = !!entry && entry.state.status !== "ended";
        const bps = breakpointsIn(path).map((b) => ({ ...b, verified: !live || !b.enabled ? null : (verified?.find((v) => v.line === b.line)?.verified ?? null) }));
        let pausedLine: number | null = null;
        let topFrame = true;
        let frameId: number | null = null;
        if (entry?.state.status === "stopped") {
          const frame = entry.state.frames.find((f) => f.id === s.selectedFrameId) ?? entry.state.frames[0];
          if (frame?.path && frame.path.replace(/\\/g, "/") === path) {
            pausedLine = frame.line;
            topFrame = frame.id === entry.state.frames[0]?.id;
            frameId = frame.id;
          }
        }
        const prev = this.view.state.field(snapshotField);
        const key = `${entry?.id}|${frameId}|${pausedLine}`;
        const inline = key === this.inlineKey ? prev.inline : new Map<number, string>();
        const next = { bps, pausedLine, topFrame, inline };
        if (JSON.stringify({ ...prev, inline: [...prev.inline] }) !== JSON.stringify({ ...next, inline: [...next.inline] })) this.view.dispatch({ effects: setSnapshot.of(next) });
        if (key !== this.inlineKey) {
          this.inlineKey = key;
          if (entry && frameId !== null && pausedLine && getFeature("debug.inlineValues")) void this.loadInline(entry.session, frameId, pausedLine, key);
        }
      }
      async loadInline(session: NonNullable<ReturnType<typeof activeEntry>>["session"], frameId: number, line: number, key: string) {
        try {
          const scopes = (await session.scopes(frameId)).filter((sc) => !sc.expensive).slice(0, 2);
          const values = new Map<string, string>();
          for (const sc of scopes) for (const v of await session.variables(sc.variablesReference)) if (!values.has(v.name) && !/^(special|function|class) variables$/i.test(v.name)) values.set(v.name, compact(v.value));
          if (key !== this.inlineKey) return;
          const doc = this.view.state.doc;
          const inline = inlineHints((n) => doc.line(n).text, Math.min(line, doc.lines), values);
          this.view.dispatch({ effects: setSnapshot.of({ ...this.view.state.field(snapshotField), inline }) });
        } catch {
          /* values are a nicety */
        }
      }
      update(u: ViewUpdate) {
        if (!u.docChanged) return;
        // Keep breakpoints on their code when lines are inserted or removed above them.
        const path = norm();
        const bps = breakpointsIn(path);
        if (!bps.length) return;
        const moves: { from: number; to: number }[] = [];
        for (const b of bps) {
          if (b.line > u.startState.doc.lines) continue;
          const pos = u.changes.mapPos(u.startState.doc.line(b.line).from, 1);
          const nl = u.state.doc.lineAt(pos).number;
          if (nl !== b.line) moves.push({ from: b.line, to: nl });
        }
        if (moves.length) queueMicrotask(() => moveBreakpoints(path, moves));
      }
      destroy() {
        this.off();
      }
    },
  );
  return [
    snapshotField,
    plugin,
    EditorView.decorations.compute([snapshotField, "doc"], lineDecorations),
    gutter({
      class: "cm-debug-gutter",
      markers: (view) => markers(view),
      lineMarkerChange: (u) => u.transactions.some((t) => t.effects.some((e) => e.is(setSnapshot))) || u.docChanged,
      initialSpacer: () => hint,
      domEventHandlers: {
        mousedown: (view, block, event) => {
          const e = event as MouseEvent;
          if (e.button !== 0) return false;
          const line = view.state.doc.lineAt(block.from).number;
          if (e.shiftKey || e.altKey) void breakpointMenu(norm(), line);
          else toggleBreakpoint(norm(), line);
          return true;
        },
        contextmenu: (view, block, event) => {
          event.preventDefault();
          void breakpointMenu(norm(), view.state.doc.lineAt(block.from).number);
          return true;
        },
      },
    }),
    EditorView.baseTheme({
      ".cm-debug-gutter": { width: "14px", cursor: "pointer" },
      ".cm-debug-gutter .cm-gutterElement": { display: "flex", alignItems: "center", justifyContent: "center" },
      ".cm-debug-gutter .cm-gutterElement:empty:hover::after": { content: '""', width: "9px", height: "9px", borderRadius: "50%", background: "rgba(229,20,0,0.35)" },
      ".cm-bp": { width: "9px", height: "9px", borderRadius: "50%", background: "#e51400", boxShadow: "0 0 0 1px rgba(0,0,0,0.15)" },
      ".cm-bp.cm-bp-cond": { background: "#e51400", outline: "2px solid rgba(229,20,0,0.35)", outlineOffset: "1px" },
      ".cm-bp.cm-bp-log": { borderRadius: "1px", transform: "rotate(45deg) scale(0.85)" },
      ".cm-bp.cm-bp-unverified": { background: "transparent", border: "1.5px solid #e51400" },
      ".cm-bp.cm-bp-off": { background: "#8a8a8a", opacity: "0.6" },
      ".cm-bp-hint": { width: "9px", height: "9px" },
      ".cm-paused-arrow": { color: "#f5c518", fontSize: "11px", lineHeight: "1" },
      ".cm-paused-arrow.cm-paused-caller": { color: "#4ea1ff" },
      ".cm-paused-line": { backgroundColor: "rgba(245, 197, 24, 0.18) !important", outline: "1px solid rgba(245,197,24,0.45)" },
      ".cm-paused-caller-line": { backgroundColor: "rgba(78, 161, 255, 0.14) !important" },
      ".cm-inline-value": { marginLeft: "2.5em", fontStyle: "italic", opacity: "0.65", color: "var(--color-primary, #3b82f6)", fontSize: "0.9em", whiteSpace: "pre" },
    }),
  ];
}
