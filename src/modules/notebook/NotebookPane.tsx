// Jupyter notebook editor: code / Markdown cells with CodeMirror, a real
// kernel (via the Python bridge), rich outputs (text, images, sanitized HTML,
// Markdown, JSON, errors), Jupyter-style keys (Shift+Enter, A/B, DD, M/Y),
// kernel interrupt / restart / switch, and .ipynb save.

import { autocompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorView, keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import { pythonFor } from "@/modules/debug/store";
import { stdioAdapter } from "@/modules/debug/transports";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { buildSharedExtensions } from "@/modules/editor/lib/extensions";
import { resolveLanguage, resolveLanguageSync } from "@/modules/editor/lib/languageResolver";
import { markdownToHtml } from "@/modules/editor/lib/textTools/text3";
import { EDITOR_THEME_EXT } from "@/modules/editor/lib/themes";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { BRIDGE, KernelSession, type KernelStatus } from "./kernel";
import { ansiToHtml, applyIopub, emptyNotebook, newCellId, parseNotebook, pickMime, serializeNotebook, type Cell, type CellType, type Notebook, type Output, type OutputState } from "./model";
import { sanitizeHtml } from "./sanitize";

type Props = { path: string; onDirtyChange?: (dirty: boolean) => void; onClose?: () => void };

const SHARED = buildSharedExtensions();

function OutputView({ o }: { o: Output }) {
  if (o.output_type === "stream") {
    return <pre className={cn("whitespace-pre-wrap break-words font-mono text-[12px] leading-snug", o.name === "stderr" && "rounded bg-red-500/10 px-1 text-red-700 dark:text-red-300")} dangerouslySetInnerHTML={{ __html: ansiToHtml(o.text) }} />;
  }
  if (o.output_type === "error") {
    return <pre className="whitespace-pre-wrap break-words rounded bg-red-500/10 p-1.5 font-mono text-[12px] leading-snug" dangerouslySetInnerHTML={{ __html: ansiToHtml(o.traceback.length ? o.traceback.join("\n") : `${o.ename}: ${o.evalue}`) }} />;
  }
  const mime = pickMime(o.data);
  const v = mime ? o.data[mime] : null;
  if (!mime || v === null || v === undefined) return null;
  if (mime === "image/png" || mime === "image/jpeg" || mime === "image/gif") {
    const md = (o.metadata[mime] as { width?: number; height?: number } | undefined) ?? {};
    return <img alt="output" className="max-w-full bg-white" style={{ width: md.width, height: md.height }} src={`data:${mime};base64,${String(v).replace(/\s/g, "")}`} />;
  }
  if (mime === "image/svg+xml") return <img alt="svg output" className="max-w-full bg-white" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(String(v))}`} />;
  if (mime === "text/html") return <div className="nb-html max-w-full overflow-auto text-[12.5px]" dangerouslySetInnerHTML={{ __html: sanitizeHtml(String(v)) }} />;
  if (mime === "text/markdown") return <div className="nb-md text-[13px]" dangerouslySetInnerHTML={{ __html: sanitizeHtml(markdownToHtml(String(v))) }} />;
  if (mime === "application/json") return <pre className="whitespace-pre-wrap font-mono text-[12px]">{JSON.stringify(v, null, 2)}</pre>;
  return <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-snug" dangerouslySetInnerHTML={{ __html: ansiToHtml(String(v)) }} />;
}

interface CellProps {
  cell: Cell;
  index: number;
  selected: boolean;
  editing: boolean;
  running: "running" | "queued" | null;
  language: string;
  themeExt: unknown;
  onSelect: (i: number, edit: boolean) => void;
  onChange: (i: number, source: string) => void;
  onKey: (i: number, key: "run" | "runNext" | "runInsert" | "escape" | "up" | "down" | "save") => boolean;
  complete: (code: string, pos: number) => Promise<CompletionResult | null>;
  onCollapse: (i: number) => void;
}

const CellView = memo(function CellView({ cell, index, selected, editing, running, language, themeExt, onSelect, onChange, onKey, complete, onCollapse }: CellProps) {
  const ref = useRef<ReactCodeMirrorRef>(null);
  const keyRef = useRef(onKey);
  keyRef.current = onKey;
  const completeRef = useRef(complete);
  completeRef.current = complete;
  const langFile = cell.cell_type === "markdown" ? "x.md" : cell.cell_type === "code" ? `x.${language === "python" ? "py" : language === "javascript" ? "js" : language === "r" ? "r" : language === "julia" ? "jl" : "txt"}` : null;
  const [lang, setLang] = useState(() => (langFile ? resolveLanguageSync(langFile) : null));
  useEffect(() => {
    if (!langFile) return void setLang(null);
    const sync = resolveLanguageSync(langFile);
    if (sync) return void setLang(sync);
    let alive = true;
    void resolveLanguage(langFile).then((ext) => alive && setLang(ext ?? null));
    return () => {
      alive = false;
    };
  }, [langFile]);
  const extensions = useMemo(
    () => [
      ...SHARED,
      ...(lang ? [lang] : []),
      EditorView.lineWrapping,
      Prec.highest(
        keymap.of([
          { key: "Shift-Enter", run: () => keyRef.current(index, "runNext") },
          { key: "Mod-Enter", run: () => keyRef.current(index, "run") },
          { key: "Alt-Enter", run: () => keyRef.current(index, "runInsert") },
          { key: "Escape", run: () => keyRef.current(index, "escape") },
          { key: "Mod-s", preventDefault: true, run: () => keyRef.current(index, "save") },
          { key: "ArrowUp", run: (v) => v.state.doc.lineAt(v.state.selection.main.head).number === 1 && keyRef.current(index, "up") },
          { key: "ArrowDown", run: (v) => v.state.doc.lineAt(v.state.selection.main.head).number === v.state.doc.lines && keyRef.current(index, "down") },
        ]),
      ),
      ...(cell.cell_type === "code" ? [autocompletion({ override: [(ctx: CompletionContext) => (ctx.explicit || /[\w.]$/.test(ctx.state.sliceDoc(Math.max(0, ctx.pos - 1), ctx.pos)) ? completeRef.current(ctx.state.doc.toString(), ctx.pos) : null)], activateOnTyping: true })] : []),
      EditorView.theme({ "&": { fontSize: "13px" }, ".cm-gutters": { display: "none" }, ".cm-content": { padding: "6px 0" } }),
    ],
    [lang, cell.cell_type, index],
  );
  useEffect(() => {
    if (editing && selected) ref.current?.view?.focus();
  }, [editing, selected]);
  const rendered = cell.cell_type === "markdown" && !editing;
  const collapsed = cell.metadata.collapsed === true || (cell.metadata.jupyter as { outputs_hidden?: boolean } | undefined)?.outputs_hidden === true;
  return (
    <div className={cn("group relative flex gap-2 rounded-md border-l-[3px] px-2 py-1", selected ? (editing ? "border-l-green-500 bg-muted/30" : "border-l-sky-500 bg-muted/20") : "border-l-transparent")} onMouseDown={() => !selected && onSelect(index, false)} data-cell={index}>
      <div className="w-14 shrink-0 pt-1.5 text-right font-mono text-[11px] text-muted-foreground">
        {cell.cell_type === "code" ? (running === "running" ? <span className="text-amber-500">[*]</span> : running === "queued" ? "[…]" : `[${cell.execution_count ?? " "}]`) : null}
      </div>
      <div className="min-w-0 flex-1">
        {rendered ? (
          <div className="nb-md min-h-6 cursor-text py-1 text-[13.5px]" onDoubleClick={() => onSelect(index, true)} dangerouslySetInnerHTML={{ __html: cell.source.trim() ? sanitizeHtml(markdownToHtml(cell.source)) : '<p class="text-muted-foreground italic">Empty Markdown cell — double-click to edit</p>' }} />
        ) : (
          <div className={cn("overflow-hidden rounded border", cell.cell_type === "raw" ? "border-dashed" : "border-border/60")} onFocus={() => onSelect(index, true)}>
            <CodeMirror ref={ref} value={cell.source} theme={themeExt as never} extensions={extensions} onChange={(v) => onChange(index, v)} basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: false }} />
          </div>
        )}
        {cell.cell_type === "code" && cell.outputs.length ? (
          collapsed ? (
            <button type="button" className="mt-1 text-[11px] text-muted-foreground hover:underline" onClick={() => onCollapse(index)}>
              … {cell.outputs.length} output(s) hidden
            </button>
          ) : (
            <div className="mt-1 flex max-h-[600px] flex-col gap-1 overflow-auto" onDoubleClick={() => onCollapse(index)}>
              {cell.outputs.map((o, k) => (
                <OutputView key={k} o={o} />
              ))}
            </div>
          )
        ) : null}
      </div>
    </div>
  );
});

export const NotebookPane = forwardRef<EditorPaneHandle, Props>(function NotebookPane({ path, onDirtyChange }, ref) {
  const editorThemeId = usePreferencesStore((s) => s.editorTheme);
  const themeExt = EDITOR_THEME_EXT[editorThemeId] ?? EDITOR_THEME_EXT.atomone;
  const [nb, setNb] = useState<Notebook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [sel, setSel] = useState(0);
  const [editing, setEditing] = useState(false);
  const [running, setRunning] = useState<Record<string, "running" | "queued">>({});
  const [status, setStatus] = useState<KernelStatus | "none">("none");
  const [kernelName, setKernelName] = useState<string | null>(null);
  const [specs, setSpecs] = useState<Record<string, string>>({});
  const kernel = useRef<KernelSession | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  /** Bumped to cancel everything queued (error in run-all, interrupt, restart). */
  const generation = useRef(0);
  const nbRef = useRef<Notebook | null>(null);
  nbRef.current = nb;
  const pendingD = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const dir = path.replace(/[\\/][^\\/]*$/, "");

  const load = useCallback(async () => {
    try {
      const r = await native.readFile(path);
      if (r.kind !== "text") throw new Error("Not a text file");
      setNb(r.content.trim() ? parseNotebook(r.content) : emptyNotebook());
      setDirty(false);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [path]);
  useEffect(() => void load(), [load]);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const mutate = useCallback((f: (nb: Notebook) => Notebook) => {
    setNb((cur) => (cur ? f(cur) : cur));
    setDirty(true);
  }, []);

  const save = useCallback(async () => {
    const cur = nbRef.current;
    if (!cur) return;
    try {
      await native.writeFile(path, serializeNotebook(cur), "user");
      setDirty(false);
    } catch (e) {
      toast.error("Couldn't save the notebook", { description: String(e) });
    }
  }, [path]);

  const saveRef = useRef(save);
  saveRef.current = save;

  const startKernel = useCallback(
    async (name?: string) => {
      kernel.current?.shutdown();
      kernel.current = null;
      setStatus("starting");
      const cur = nbRef.current;
      const wanted = name ?? ((cur?.metadata.kernelspec as { name?: string } | undefined)?.name || "python3");
      try {
        const py = await pythonFor(dir);
        if (!py) throw new Error("Python not found — install Python and `pip install ipykernel`");
        const transport = await stdioAdapter(py, ["-u", "-c", BRIDGE, wanted], dir);
        const k = new KernelSession(transport);
        kernel.current = k;
        k.onStatus((s) => setStatus(s));
        const info = await k.ready;
        setKernelName(info.kernel);
        setSpecs(info.specs);
        if (name && cur) mutate((n) => ({ ...n, metadata: { ...n.metadata, kernelspec: { name: info.kernel, display_name: info.specs[info.kernel] ?? info.kernel, language: info.language } } }));
        return k;
      } catch (e) {
        setStatus("dead");
        toast.error("Kernel didn't start", { description: e instanceof Error ? e.message : String(e) });
        return null;
      }
    },
    [dir, mutate],
  );

  useEffect(() => () => kernel.current?.shutdown(), []);

  const ensureKernel = useCallback(async () => (kernel.current && kernel.current.status !== "dead" ? kernel.current : startKernel()), [startKernel]);

  const runCell = useCallback(
    (id: string) => {
      const cell = nbRef.current?.cells.find((c) => c.id === id);
      if (!cell) return;
      if (cell.cell_type !== "code") return;
      setRunning((r) => ({ ...r, [id]: "queued" }));
      const gen = generation.current;
      chain.current = chain.current.then(async () => {
        if (gen !== generation.current) {
          setRunning(({ [id]: _, ...r }) => r);
          return;
        }
        const k = await ensureKernel();
        const cur = nbRef.current?.cells.find((c) => c.id === id);
        if (!k || !cur) {
          setRunning(({ [id]: _, ...r }) => r);
          return;
        }
        setRunning((r) => ({ ...r, [id]: "running" }));
        let state: OutputState = { outputs: [], clearPending: false };
        mutate((n) => ({ ...n, cells: n.cells.map((c) => (c.id === id ? { ...c, outputs: [] } : c)) }));
        try {
          const reply = await k.execute(cur.source, (t, content) => {
            const next = applyIopub(state, t, content);
            if (!next) return;
            state = next;
            setNb((n) => (n ? { ...n, cells: n.cells.map((c) => (c.id === id ? { ...c, outputs: next.outputs } : c)) } : n));
          });
          mutate((n) => ({ ...n, cells: n.cells.map((c) => (c.id === id ? { ...c, execution_count: reply.execution_count ?? c.execution_count } : c)) }));
          // Stop the queue on an error, like Jupyter's "run all".
          if (reply.status === "error") generation.current++;
        } catch {
          generation.current++;
        } finally {
          setRunning(({ [id]: _, ...r }) => r);
        }
      });
      chain.current = chain.current.catch(() => {});
    },
    [ensureKernel, mutate],
  );

  const insert = useCallback(
    (at: number, type: CellType = "code") => {
      mutate((n) => ({ ...n, cells: [...n.cells.slice(0, at), { id: newCellId(), cell_type: type, source: "", metadata: {}, outputs: [], execution_count: null }, ...n.cells.slice(at)] }));
      setSel(at);
      setEditing(true);
    },
    [mutate],
  );

  const onKey = useCallback(
    (i: number, key: "run" | "runNext" | "runInsert" | "escape" | "up" | "down" | "save"): boolean => {
      if (key === "save") {
        void saveRef.current();
        return true;
      }
      const cells = nbRef.current?.cells ?? [];
      const cell = cells[i];
      if (!cell) return false;
      if (key === "escape") {
        setEditing(false);
        root.current?.focus();
        return true;
      }
      if (key === "up" || key === "down") {
        const j = key === "up" ? i - 1 : i + 1;
        if (j < 0 || j >= cells.length) return false;
        setSel(j);
        setEditing(true);
        return true;
      }
      runCell(cell.id);
      if (key === "run") {
        if (cell.cell_type === "markdown") setEditing(false);
        return true;
      }
      if (key === "runInsert" || i === cells.length - 1) insert(i + 1);
      else {
        setSel(i + 1);
        setEditing(cells[i + 1].cell_type !== "markdown");
      }
      if (cell.cell_type === "markdown" && key !== "runInsert") setEditing(false);
      return true;
    },
    [insert, runCell],
  );

  const complete = useCallback(async (code: string, pos: number): Promise<CompletionResult | null> => {
    const k = kernel.current;
    if (!k || k.status !== "idle") return null;
    try {
      const r = await Promise.race([k.complete(code, pos), new Promise<null>((res) => setTimeout(() => res(null), 1500))]);
      if (!r || !r.matches.length) return null;
      return { from: r.cursor_start, to: r.cursor_end, options: r.matches.slice(0, 200).map((m) => ({ label: m })) };
    } catch {
      return null;
    }
  }, []);

  // Command-mode keys (Jupyter): A/B insert, DD delete, M/Y/R type, Enter edit, ↑/↓ move, Shift+Enter run.
  const onCommandKey = (e: React.KeyboardEvent) => {
    if (editing || !nb) return;
    const cell = nb.cells[sel];
    const k = e.key;
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === "s") {
      handled();
      void save();
      return;
    }
    if (k === "ArrowUp" || k === "k") {
      handled();
      setSel((s) => Math.max(0, s - 1));
    } else if (k === "ArrowDown" || k === "j") {
      handled();
      setSel((s) => Math.min(nb.cells.length - 1, s + 1));
    } else if (k === "Enter" && !e.shiftKey) {
      handled();
      setEditing(true);
    } else if (k === "Enter" && e.shiftKey && cell) {
      handled();
      onKey(sel, "runNext");
    } else if (k === "a") {
      handled();
      insert(sel);
    } else if (k === "b") {
      handled();
      insert(sel + 1);
    } else if (k === "d") {
      handled();
      if (Date.now() - pendingD.current < 600 && nb.cells.length > 0) {
        mutate((n) => ({ ...n, cells: n.cells.filter((_, j) => j !== sel) }));
        setSel((s) => Math.max(0, Math.min(s, nb.cells.length - 2)));
        pendingD.current = 0;
      } else pendingD.current = Date.now();
    } else if ((k === "m" || k === "y" || k === "r") && cell) {
      handled();
      const t: CellType = k === "m" ? "markdown" : k === "y" ? "code" : "raw";
      mutate((n) => ({ ...n, cells: n.cells.map((c, j) => (j === sel ? { ...c, cell_type: t, outputs: t === "code" ? c.outputs : [], execution_count: t === "code" ? c.execution_count : null } : c)) }));
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      setQuery: () => {},
      findNext: () => {},
      findPrevious: () => {},
      clearQuery: () => {},
      focus: () => root.current?.focus(),
      getSelection: () => null,
      getPath: () => path,
      reload: () => {
        if (dirty) return false;
        void load();
        return true;
      },
      gotoLine: () => {},
      undo: () => {},
      redo: () => {},
      openFindReplace: () => {},
      toggleBlame: () => {},
      save,
    }),
    [dirty, load, path, save],
  );

  const runAll = (from = 0, to?: number) => {
    for (const c of (nbRef.current?.cells ?? []).slice(from, to)) runCell(c.id);
  };
  const interrupt = () => {
    generation.current++;
    void kernel.current?.interrupt().catch(() => {});
  };
  const restart = async (thenRunAll = false) => {
    generation.current++;
    setRunning({});
    if (!kernel.current || kernel.current.status === "dead") await startKernel();
    else await kernel.current.restart().catch((e) => toast.error(String(e)));
    if (thenRunAll) runAll();
  };
  const clearOutputs = () => mutate((n) => ({ ...n, cells: n.cells.map((c) => ({ ...c, outputs: [], execution_count: null })) }));
  const moveCell = (dirn: -1 | 1) =>
    mutate((n) => {
      const j = sel + dirn;
      if (j < 0 || j >= n.cells.length) return n;
      const cells = [...n.cells];
      [cells[sel], cells[j]] = [cells[j], cells[sel]];
      setSel(j);
      return { ...n, cells };
    });

  const onSelect = useCallback((i: number, edit: boolean) => {
    setSel(i);
    setEditing(edit);
  }, []);
  const onChange = useCallback((i: number, source: string) => mutate((n) => ({ ...n, cells: n.cells.map((c, j) => (j === i ? { ...c, source } : c)) })), [mutate]);
  const onCollapse = useCallback((i: number) => mutate((n) => ({ ...n, cells: n.cells.map((c, j) => (j === i ? { ...c, metadata: { ...c.metadata, collapsed: !(c.metadata.collapsed === true) } } : c)) })), [mutate]);

  if (error) return <div className="flex h-full items-center justify-center p-6 text-[12px] text-destructive">{error}</div>;
  if (!nb) return <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">Loading notebook…</div>;
  const language = String((nb.metadata.kernelspec as { language?: string } | undefined)?.language ?? (nb.metadata.language_info as { name?: string } | undefined)?.name ?? "python");
  const btn = "rounded px-1.5 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-40";
  const dot = status === "idle" ? "bg-green-500" : status === "busy" ? "bg-amber-500 animate-pulse" : status === "starting" ? "bg-sky-500 animate-pulse" : status === "dead" ? "bg-red-500" : "bg-muted-foreground/40";
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border/60 px-2">
        <button type="button" className={btn} onClick={() => void save()} title="Save (Ctrl+S)">
          💾{dirty ? " •" : ""}
        </button>
        <span className="mx-1 h-4 w-px bg-border" />
        <button type="button" className={btn} onClick={() => insert(sel + 1)} title="Insert code cell below (B)">
          + Code
        </button>
        <button type="button" className={btn} onClick={() => insert(sel + 1, "markdown")} title="Insert Markdown cell below">
          + Markdown
        </button>
        <button type="button" className={btn} onClick={() => moveCell(-1)} title="Move cell up">
          ↑
        </button>
        <button type="button" className={btn} onClick={() => moveCell(1)} title="Move cell down">
          ↓
        </button>
        <span className="mx-1 h-4 w-px bg-border" />
        <button type="button" className={cn(btn, "text-green-600 dark:text-green-400")} onClick={() => nb.cells[sel] && onKey(sel, "run")} title="Run cell (Ctrl+Enter)">
          ▶ Run
        </button>
        <button type="button" className={btn} onClick={() => runAll()} title="Run all cells">
          ⏩ All
        </button>
        <button type="button" className={btn} onClick={() => runAll(0, sel)} title="Run all cells above">
          Above
        </button>
        <button type="button" className={btn} onClick={interrupt} disabled={status !== "busy"} title="Interrupt the kernel">
          ■
        </button>
        <button type="button" className={btn} onClick={() => void restart()} title="Restart the kernel">
          ⟲
        </button>
        <button type="button" className={btn} onClick={() => void restart(true)} title="Restart and run all">
          ⟲⏩
        </button>
        <button type="button" className={btn} onClick={clearOutputs} title="Clear all outputs">
          ⌫ Outputs
        </button>
        <div className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className={cn("size-2 rounded-full", dot)} />
          {Object.keys(specs).length > 1 ? (
            <select className="rounded border bg-background px-1 py-0.5 text-[11px]" value={kernelName ?? ""} onChange={(e) => void startKernel(e.target.value)}>
              {Object.entries(specs).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          ) : (
            <button type="button" className="hover:underline" onClick={() => void (status === "none" || status === "dead" ? startKernel() : undefined)} title={status === "none" ? "Start the kernel" : status}>
              {kernelName ? (specs[kernelName] ?? kernelName) : String((nb.metadata.kernelspec as { display_name?: string } | undefined)?.display_name ?? "Python 3")}
              {status === "none" ? " · not started" : status === "dead" ? " · dead (click to start)" : ` · ${status}`}
            </button>
          )}
        </div>
      </div>
      <div ref={root} tabIndex={0} onKeyDown={onCommandKey} className="min-h-0 flex-1 overflow-auto py-2 outline-none">
        <div className="mx-auto flex max-w-[1100px] flex-col gap-1 pr-4">
          {nb.cells.map((c, i) => (
            <CellView key={c.id} cell={c} index={i} selected={i === sel} editing={i === sel && editing} running={running[c.id] ?? null} language={language} themeExt={themeExt} onSelect={onSelect} onChange={onChange} onKey={onKey} complete={complete} onCollapse={onCollapse} />
          ))}
          <div className="flex justify-center gap-2 py-3 opacity-60 hover:opacity-100">
            <button type="button" className={btn} onClick={() => insert(nb.cells.length)}>
              + Code
            </button>
            <button type="button" className={btn} onClick={() => insert(nb.cells.length, "markdown")}>
              + Markdown
            </button>
          </div>
        </div>
      </div>
      <style>{`
        .nb-md h1{font-size:1.6em;font-weight:700;margin:.4em 0}.nb-md h2{font-size:1.35em;font-weight:700;margin:.4em 0}.nb-md h3{font-size:1.15em;font-weight:600;margin:.4em 0}
        .nb-md p{margin:.35em 0}.nb-md ul{list-style:disc;padding-left:1.4em}.nb-md ol{list-style:decimal;padding-left:1.4em}.nb-md code{font-family:var(--font-mono,monospace);background:color-mix(in srgb,currentColor 8%,transparent);padding:0 .25em;border-radius:3px}
        .nb-md pre{background:color-mix(in srgb,currentColor 6%,transparent);padding:.5em;border-radius:4px;overflow:auto}.nb-md a{color:var(--color-primary,#3b82f6);text-decoration:underline}.nb-md blockquote{border-left:3px solid color-mix(in srgb,currentColor 25%,transparent);padding-left:.7em;opacity:.85}
        .nb-md table,.nb-html table{border-collapse:collapse;margin:.3em 0}.nb-md th,.nb-md td,.nb-html th,.nb-html td{border:1px solid color-mix(in srgb,currentColor 18%,transparent);padding:2px 8px;text-align:right}.nb-html thead th{background:color-mix(in srgb,currentColor 6%,transparent)}
        .nb-html tbody tr:nth-child(odd){background:color-mix(in srgb,currentColor 3%,transparent)}
      `}</style>
    </div>
  );
});
