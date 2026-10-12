// gear-hex://<file>: view and edit a file byte by byte. Type hex digits (or
// text, in the right-hand column) to overwrite; Insert toggles insert mode.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { app, frontFilePath } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { inputBox } from "@/modules/quick-pick";
import { base64ToBytes, bytesToBase64, formatBytes, toolPaneHandle, toolsNative } from "@/modules/tools/paneHandle";
import { applyEdit, BYTES_PER_ROW, bytesFromPaste, findBytes, hex2, inspect, invert, offsetLabel, parseNeedle, parseOffset, printable, rowCount, typeNibble, type Edit } from "./model";

const SCHEME = "gear-hex://";
const ROW_H = 20;
/** Larger files open read-only, showing their first part. */
const EDIT_CAP = 16 * 1024 * 1024;

export function openHexFor(file: string): void {
  app().openFile(`${SCHEME}${file}`);
}

export async function openHexEditor(): Promise<void> {
  const current = frontFilePath() ?? getActiveEditor()?.path ?? "";
  const file = await inputBox({ title: "Open in the hex editor", value: current, placeholder: "File path" });
  if (file?.trim()) openHexFor(file.trim());
}

const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";
const field = "rounded border border-border/60 bg-background px-1.5 py-0.5 font-mono text-[12px] outline-none focus:border-ring";

export const HexPane = forwardRef<EditorPaneHandle, { path: string; onDirtyChange?: (dirty: boolean) => void }>(function HexPane({ path, onDirtyChange }, ref) {
  const file = path.slice(SCHEME.length);
  const [data, setData] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [fullSize, setFullSize] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [column, setColumn] = useState<"hex" | "text">("hex");
  const [highNibble, setHighNibble] = useState(true);
  const [insertMode, setInsertMode] = useState(false);
  const [littleEndian, setLittleEndian] = useState(true);
  const [query, setQuery] = useState("");
  const [undo, setUndo] = useState<Edit[]>([]);
  const [redo, setRedo] = useState<Edit[]>([]);
  const [savedDepth, setSavedDepth] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  const scroller = useRef<HTMLDivElement>(null);

  const dirty = undo.length !== savedDepth;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const load = useCallback(async () => {
    try {
      const r = await toolsNative.readBytes(file, EDIT_CAP);
      setData(base64ToBytes(r.data));
      setReadOnly(r.truncated);
      setFullSize(r.size);
      setUndo([]);
      setRedo([]);
      setSavedDepth(0);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, [file]);

  useEffect(() => void load(), [load]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setHeight(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data === null]);

  const reveal = useCallback((offset: number) => {
    const el = scroller.current;
    if (!el) return;
    const top = Math.floor(offset / BYTES_PER_ROW) * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
  }, []);

  const moveTo = useCallback(
    (offset: number, extend = false) => {
      if (!data) return;
      const next = Math.max(0, Math.min(offset, insertMode ? data.length : Math.max(0, data.length - 1)));
      setAnchor(extend ? (anchor ?? cursor) : null);
      setCursor(next);
      setHighNibble(true);
      reveal(next);
    },
    [data, insertMode, anchor, cursor, reveal],
  );

  const commit = useCallback(
    (edit: Edit) => {
      if (!data || readOnly) return;
      setData(applyEdit(data, edit));
      // A redo branch that was already saved can never be reached again.
      if (savedDepth > undo.length) setSavedDepth(-1);
      setUndo([...undo, edit]);
      setRedo([]);
    },
    [data, readOnly, undo, savedDepth],
  );

  const doUndo = useCallback(() => {
    const e = undo[undo.length - 1];
    if (!e || !data) return;
    setData(applyEdit(data, invert(e)));
    setUndo(undo.slice(0, -1));
    setRedo([...redo, e]);
    setCursor(Math.min(e.at, Math.max(0, data.length - 1)));
  }, [undo, redo, data]);

  const doRedo = useCallback(() => {
    const e = redo[redo.length - 1];
    if (!e || !data) return;
    setData(applyEdit(data, e));
    setRedo(redo.slice(0, -1));
    setUndo([...undo, e]);
    setCursor(e.at);
  }, [undo, redo, data]);

  const save = useCallback(async () => {
    if (!data || readOnly || !dirty) return;
    try {
      await toolsNative.writeBytes(file, bytesToBase64(data));
      setSavedDepth(undo.length);
      setFullSize(data.length);
      toast.success(`Saved ${data.length.toLocaleString()} bytes`);
    } catch (err) {
      toast.error(`Could not save: ${String(err)}`);
    }
  }, [data, readOnly, dirty, file, undo.length]);

  const find = useCallback(
    (backwards = false) => {
      if (!data) return;
      const needle = parseNeedle(query);
      if (!needle) return;
      const at = findBytes(data, needle.bytes, backwards ? cursor - 1 : cursor + 1, backwards);
      if (at < 0) return void toast.info(`Not found (${needle.kind === "hex" ? "as bytes" : "as text"})`);
      setCursor(at);
      setAnchor(at + needle.bytes.length - 1);
      reveal(at);
    },
    [data, query, cursor, reveal],
  );

  // The handle must keep its identity: the tab host re-applies its own search
  // text to every new handle, which would wipe what was typed into Find here.
  const live = useRef({ find, dirty, load, doUndo, doRedo, save });
  live.current = { find, dirty, load, doUndo, doRedo, save };
  useImperativeHandle(
    ref,
    () =>
      toolPaneHandle(path, {
        findNext: () => live.current.find(false),
        findPrevious: () => live.current.find(true),
        focus: () => scroller.current?.focus(),
        reload: () => (live.current.dirty ? false : (void live.current.load(), true)),
        undo: () => live.current.doUndo(),
        redo: () => live.current.doRedo(),
        save: () => live.current.save(),
      }),
    [path],
  );

  const selection = useMemo(() => (anchor === null ? null : { from: Math.min(anchor, cursor), to: Math.max(anchor, cursor) }), [anchor, cursor]);

  const goto = async () => {
    if (!data) return;
    const v = await inputBox({ title: "Go to offset", placeholder: "1024, 0x400, +16", validate: (t) => (parseOffset(t, cursor, data.length) === null ? "Not an offset inside this file" : null) });
    const target = v ? parseOffset(v, cursor, data.length) : null;
    if (target !== null) moveTo(target);
    scroller.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!data) return;
    const mod = e.ctrlKey || e.metaKey;
    const page = Math.max(1, Math.floor(height / ROW_H) - 1) * BYTES_PER_ROW;
    const nav: Record<string, number> = { ArrowLeft: cursor - 1, ArrowRight: cursor + 1, ArrowUp: cursor - BYTES_PER_ROW, ArrowDown: cursor + BYTES_PER_ROW, PageUp: cursor - page, PageDown: cursor + page, Home: mod ? 0 : cursor - (cursor % BYTES_PER_ROW), End: mod ? data.length - 1 : cursor - (cursor % BYTES_PER_ROW) + BYTES_PER_ROW - 1 };
    if (e.key in nav) return void (e.preventDefault(), moveTo(nav[e.key], e.shiftKey));
    if (mod && e.key.toLowerCase() === "z") return void (e.preventDefault(), e.shiftKey ? doRedo() : doUndo());
    if (mod && e.key.toLowerCase() === "y") return void (e.preventDefault(), doRedo());
    if (mod && e.key.toLowerCase() === "s") return void (e.preventDefault(), void save());
    if (mod && e.key.toLowerCase() === "g") return void (e.preventDefault(), void goto());
    if (mod && e.key.toLowerCase() === "c") {
      const { from, to } = selection ?? { from: cursor, to: cursor };
      const slice = data.subarray(from, to + 1);
      e.preventDefault();
      return void navigator.clipboard.writeText(column === "hex" ? [...slice].map(hex2).join(" ") : new TextDecoder().decode(slice));
    }
    if (mod) return;
    if (e.key === "Tab") return void (e.preventDefault(), setColumn(column === "hex" ? "text" : "hex"), setHighNibble(true));
    if (e.key === "Insert") return void (e.preventDefault(), setInsertMode(!insertMode), setHighNibble(true));
    if (readOnly) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      const { from, to } = selection ?? (e.key === "Backspace" ? { from: cursor - 1, to: cursor - 1 } : { from: cursor, to: cursor });
      if (from < 0 || from >= data.length) return;
      commit({ kind: "delete", at: from, bytes: [...data.subarray(from, to + 1)] });
      setAnchor(null);
      setCursor(Math.max(0, Math.min(from, data.length - (to - from + 1) - (insertMode ? 0 : 1))));
      return;
    }
    if (e.key.length !== 1) return;
    e.preventDefault();
    if (column === "text") {
      const bytes = [...new TextEncoder().encode(e.key)];
      if (insertMode || cursor >= data.length) commit({ kind: "insert", at: Math.min(cursor, data.length), bytes });
      else if (bytes.length === 1) commit({ kind: "set", at: cursor, before: data[cursor], after: bytes[0] });
      else return;
      setCursor(cursor + (insertMode ? bytes.length : 1));
      return;
    }
    const digit = Number.parseInt(e.key, 16);
    if (Number.isNaN(digit)) return;
    if (highNibble && (insertMode || cursor >= data.length)) {
      commit({ kind: "insert", at: Math.min(cursor, data.length), bytes: [digit << 4] });
      setHighNibble(false);
    } else {
      commit(typeNibble(data, cursor, digit, highNibble));
      if (highNibble) setHighNibble(false);
      else {
        setHighNibble(true);
        setCursor(Math.min(cursor + 1, insertMode ? data.length : data.length - 1));
        reveal(cursor + 1);
      }
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    if (!data || readOnly) return;
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    const bytes = column === "hex" ? bytesFromPaste(text) : [...new TextEncoder().encode(text)];
    if (!bytes.length) return;
    commit({ kind: "insert", at: Math.min(cursor, data.length), bytes });
    setCursor(cursor + bytes.length);
  };

  if (error) return <div className="p-6 text-[12.5px] text-red-500">{error}</div>;
  if (!data) return <div className="p-6 text-[12.5px] text-muted-foreground">Reading the file…</div>;

  const rows = rowCount(data.length);
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 4);
  const last = Math.min(rows, first + Math.ceil(height / ROW_H) + 8);
  const inSel = (i: number) => (selection ? i >= selection.from && i <= selection.to : false);
  const readings = inspect(data, cursor, littleEndian);

  return (
    <div className="flex h-full flex-col text-[12.5px]">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 p-2">
        <span className="min-w-0 max-w-[36%] truncate font-mono text-[12px] text-muted-foreground" title={file}>
          {file}
        </span>
        <span className="text-muted-foreground">
          {formatBytes(data.length)}
          {dirty && <span className="ml-1 text-amber-600">● unsaved</span>}
        </span>
        <span className="flex-1" />
        <input className={cn(field, "w-[190px]")} value={query} placeholder='Find: 48 65 6C or "text"' onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), find(e.shiftKey))} />
        <button type="button" className={btn} onClick={() => find(true)}>
          ↑
        </button>
        <button type="button" className={btn} onClick={() => find(false)}>
          ↓
        </button>
        <button type="button" className={btn} onClick={() => void goto()}>
          Go to…
        </button>
        <button type="button" className={btn} title="Insert key" disabled={readOnly} onClick={() => setInsertMode(!insertMode)}>
          {insertMode ? "Insert" : "Overwrite"}
        </button>
        <button type="button" className={btn} disabled={!undo.length} onClick={doUndo}>
          Undo
        </button>
        <button type="button" className={btn} disabled={!redo.length} onClick={doRedo}>
          Redo
        </button>
        <button type="button" className={cn(btn, dirty && "bg-primary/10")} disabled={!dirty || readOnly} onClick={() => void save()}>
          Save
        </button>
      </div>
      {readOnly && (
        <div className="border-b border-border/60 bg-amber-500/10 px-3 py-1 text-amber-600">
          This file is {formatBytes(fullSize)}; only the first {formatBytes(data.length)} are shown, read-only.
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div ref={scroller} tabIndex={0} data-hex-grid className="min-w-0 flex-1 overflow-auto font-mono text-[12.5px] outline-none" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} onKeyDown={onKeyDown} onPaste={onPaste}>
          <div style={{ height: rows * ROW_H, position: "relative", minWidth: 660 }}>
            {Array.from({ length: Math.max(0, last - first) }, (_, k) => {
              const row = first + k;
              const base = row * BYTES_PER_ROW;
              return (
                <div key={row} className="absolute left-0 flex items-center whitespace-pre px-2" style={{ top: row * ROW_H, height: ROW_H }}>
                  <span className="mr-3 select-none text-muted-foreground">{offsetLabel(base, data.length)}</span>
                  {Array.from({ length: BYTES_PER_ROW }, (_, c) => {
                    const i = base + c;
                    const exists = i < data.length;
                    const here = i === cursor;
                    return (
                      <span
                        key={c}
                        data-byte={exists ? i : undefined}
                        className={cn("inline-block w-[22px] text-center", c === 8 && "ml-2", exists && "cursor-default", inSel(i) && exists && "bg-primary/25", here && (column === "hex" ? "bg-primary text-primary-foreground" : "outline outline-1 outline-primary"), exists && data[i] === 0 && !here && "text-muted-foreground/60")}
                        onMouseDown={(e) => (exists || i === data.length) && (setColumn("hex"), moveTo(i, e.shiftKey))}
                      >
                        {exists ? hex2(data[i]) : i === data.length && here ? "__" : "  "}
                      </span>
                    );
                  })}
                  <span className="ml-4">
                    {Array.from({ length: BYTES_PER_ROW }, (_, c) => {
                      const i = base + c;
                      if (i >= data.length) return null;
                      const here = i === cursor;
                      return (
                        <span key={c} className={cn("inline-block w-[8px] text-center", inSel(i) && "bg-primary/25", here && (column === "text" ? "bg-primary text-primary-foreground" : "outline outline-1 outline-primary"))} onMouseDown={(e) => (setColumn("text"), moveTo(i, e.shiftKey))}>
                          {printable(data[i])}
                        </span>
                      );
                    })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="w-[230px] shrink-0 overflow-auto border-l border-border/60 p-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-medium">At offset {cursor.toLocaleString()}</span>
            <button type="button" className={btn} title="Byte order" onClick={() => setLittleEndian(!littleEndian)}>
              {littleEndian ? "LE" : "BE"}
            </button>
          </div>
          <div className="mb-2 font-mono text-[11.5px] text-muted-foreground">
            0x{cursor.toString(16).toUpperCase()}
            {selection && ` · ${selection.to - selection.from + 1} bytes selected`}
          </div>
          {readings.map((r) => (
            <div key={r.label} className="flex justify-between gap-2 py-px">
              <span className="text-muted-foreground">{r.label}</span>
              <span className="truncate font-mono text-[11.5px]" data-reading={r.label} title={r.value}>
                {r.value}
              </span>
            </div>
          ))}
          <div className="mt-3 text-[11px] leading-snug text-muted-foreground">Tab switches between the hex and text columns. Insert toggles insert / overwrite. Ctrl+G goes to an offset, Ctrl+S saves.</div>
        </div>
      </div>
    </div>
  );
});

export const HEX_ACTIONS = [
  { id: "hex.open", label: "Hex editor: Open a file byte by byte…", keywords: ["hex", "binary", "bytes", "editor", "patch", "inspect"], run: () => void openHexEditor() },
  {
    id: "hex.openActive",
    label: "Hex editor: Open the current file",
    keywords: ["hex", "binary", "bytes", "editor", "current file"],
    run: () => {
      const f = frontFilePath() ?? getActiveEditor()?.path;
      if (f) openHexFor(f);
      else toast.info("Open a file first.");
    },
  },
];
