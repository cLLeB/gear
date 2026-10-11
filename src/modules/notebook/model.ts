// Jupyter notebooks (nbformat 4): parse and serialize .ipynb files the way
// Jupyter writes them, apply kernel messages to cell outputs (stream merging,
// carriage returns, clear_output), and turn ANSI tracebacks into HTML.

export type CellType = "code" | "markdown" | "raw";

export type Output =
  | { output_type: "stream"; name: "stdout" | "stderr"; text: string }
  | { output_type: "display_data"; data: Record<string, unknown>; metadata: Record<string, unknown>; transient?: { display_id?: string } }
  | { output_type: "execute_result"; data: Record<string, unknown>; metadata: Record<string, unknown>; execution_count: number | null }
  | { output_type: "error"; ename: string; evalue: string; traceback: string[] };

export interface Cell {
  id: string;
  cell_type: CellType;
  source: string;
  metadata: Record<string, unknown>;
  outputs: Output[];
  execution_count: number | null;
  attachments?: Record<string, unknown>;
}

export interface Notebook {
  cells: Cell[];
  metadata: Record<string, unknown>;
  nbformat: number;
  nbformat_minor: number;
}

const joinSource = (s: unknown): string => (Array.isArray(s) ? s.join("") : typeof s === "string" ? s : "");

/** Split text into Jupyter's line list (each line keeps its "\n"). */
export function splitSource(text: string): string[] {
  if (!text) return [];
  const parts = text.split(/(?<=\n)/);
  return parts;
}

let idCounter = 0;
export function newCellId(): string {
  idCounter++;
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36).slice(-4)}${rnd}${idCounter}`.slice(0, 12);
}

function normalizeOutput(o: Record<string, unknown>): Output | null {
  switch (o.output_type) {
    case "stream":
      return { output_type: "stream", name: o.name === "stderr" ? "stderr" : "stdout", text: joinSource(o.text) };
    case "display_data":
    case "execute_result": {
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries((o.data as Record<string, unknown>) ?? {})) data[k] = Array.isArray(v) && typeof v[0] === "string" && !k.includes("json") ? (v as string[]).join("") : v;
      return o.output_type === "display_data"
        ? { output_type: "display_data", data, metadata: (o.metadata as Record<string, unknown>) ?? {} }
        : { output_type: "execute_result", data, metadata: (o.metadata as Record<string, unknown>) ?? {}, execution_count: (o.execution_count as number) ?? null };
    }
    case "error":
      return { output_type: "error", ename: String(o.ename ?? ""), evalue: String(o.evalue ?? ""), traceback: (o.traceback as string[]) ?? [] };
    default:
      return null;
  }
}

export function parseNotebook(text: string): Notebook {
  const raw = text.trim() ? (JSON.parse(text) as Record<string, unknown>) : { cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 };
  const nbformat = Number(raw.nbformat ?? 4);
  if (nbformat < 4) throw new Error(`nbformat ${nbformat} notebooks aren't supported (open and re-save it in Jupyter first)`);
  const cells = ((raw.cells as Record<string, unknown>[]) ?? []).map((c) => ({
    id: typeof c.id === "string" ? c.id : newCellId(),
    cell_type: (c.cell_type === "markdown" || c.cell_type === "raw" ? c.cell_type : "code") as CellType,
    source: joinSource(c.source),
    metadata: (c.metadata as Record<string, unknown>) ?? {},
    outputs: c.cell_type === "code" ? ((c.outputs as Record<string, unknown>[]) ?? []).map(normalizeOutput).filter((o): o is Output => !!o) : [],
    execution_count: c.cell_type === "code" ? ((c.execution_count as number) ?? null) : null,
    ...(c.attachments ? { attachments: c.attachments as Record<string, unknown> } : {}),
  }));
  return { cells, metadata: (raw.metadata as Record<string, unknown>) ?? {}, nbformat, nbformat_minor: Number(raw.nbformat_minor ?? 5) };
}

function serializeOutput(o: Output): Record<string, unknown> {
  switch (o.output_type) {
    case "stream":
      return { name: o.name, output_type: "stream", text: splitSource(o.text) };
    case "error":
      return { ename: o.ename, evalue: o.evalue, output_type: "error", traceback: o.traceback };
    default: {
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(o.data)) data[k] = typeof v === "string" && (k.startsWith("text/") || k === "image/svg+xml") ? splitSource(v) : v;
      return o.output_type === "execute_result" ? { data, execution_count: o.execution_count, metadata: o.metadata, output_type: "execute_result" } : { data, metadata: o.metadata, output_type: "display_data" };
    }
  }
}

/** Serialize like Jupyter: 1-space indent, sorted cell keys, trailing newline. */
export function serializeNotebook(nb: Notebook): string {
  const minor = Math.max(nb.nbformat_minor, 5);
  const cells = nb.cells.map((c) => {
    const base: Record<string, unknown> = { cell_type: c.cell_type };
    if (c.cell_type === "code") base.execution_count = c.execution_count;
    base.id = c.id;
    if (c.attachments && c.cell_type !== "code") base.attachments = c.attachments;
    base.metadata = c.metadata;
    if (c.cell_type === "code") base.outputs = c.outputs.map(serializeOutput);
    base.source = splitSource(c.source);
    return Object.fromEntries(Object.entries(base).sort(([a], [b]) => a.localeCompare(b)));
  });
  return `${JSON.stringify({ cells, metadata: nb.metadata, nbformat: 4, nbformat_minor: minor }, null, 1)}\n`;
}

export function emptyNotebook(kernel = "python3", display = "Python 3", language = "python"): Notebook {
  return {
    cells: [{ id: newCellId(), cell_type: "code", source: "", metadata: {}, outputs: [], execution_count: null }],
    metadata: { kernelspec: { name: kernel, display_name: display, language }, language_info: { name: language } },
    nbformat: 4,
    nbformat_minor: 5,
  };
}

// ── kernel messages → outputs ─────────────────────────────────────────────

/** Apply terminal-style \r (overwrite the current line) and \b to stream text. */
export function applyCarriageReturns(text: string): string {
  if (!/[\r\b]/.test(text)) return text;
  return text
    .split("\n")
    .map((line) => {
      if (line.includes("\b")) {
        let out = "";
        for (const ch of line) out = ch === "\b" ? out.slice(0, -1) : out + ch;
        line = out;
      }
      if (!line.includes("\r")) return line;
      const segs = line.split("\r");
      let cur = "";
      for (const s of segs) cur = s + cur.slice(s.length);
      return cur;
    })
    .join("\n");
}

export interface OutputState {
  outputs: Output[];
  /** clear_output(wait=True): clear on the next output. */
  clearPending: boolean;
}

/** Fold one iopub message into a cell's outputs. Returns the new state, or null if the message isn't an output. */
export function applyIopub(state: OutputState, msgType: string, content: Record<string, unknown>): OutputState | null {
  let outputs = state.clearPending && ["stream", "display_data", "execute_result", "error"].includes(msgType) ? [] : state.outputs;
  const clearPending = state.clearPending && outputs === state.outputs;
  switch (msgType) {
    case "stream": {
      const name = content.name === "stderr" ? "stderr" : "stdout";
      const last = outputs[outputs.length - 1];
      if (last?.output_type === "stream" && last.name === name) {
        outputs = [...outputs.slice(0, -1), { ...last, text: applyCarriageReturns(last.text + String(content.text ?? "")) }];
      } else outputs = [...outputs, { output_type: "stream", name, text: applyCarriageReturns(String(content.text ?? "")) }];
      return { outputs, clearPending: false };
    }
    case "display_data":
      return { outputs: [...outputs, { output_type: "display_data", data: (content.data as Record<string, unknown>) ?? {}, metadata: (content.metadata as Record<string, unknown>) ?? {}, transient: content.transient as { display_id?: string } }], clearPending: false };
    case "update_display_data": {
      const id = (content.transient as { display_id?: string } | undefined)?.display_id;
      if (!id) return null;
      return { outputs: outputs.map((o) => (o.output_type === "display_data" && o.transient?.display_id === id ? { ...o, data: (content.data as Record<string, unknown>) ?? {} } : o)), clearPending };
    }
    case "execute_result":
      return { outputs: [...outputs, { output_type: "execute_result", data: (content.data as Record<string, unknown>) ?? {}, metadata: (content.metadata as Record<string, unknown>) ?? {}, execution_count: (content.execution_count as number) ?? null }], clearPending: false };
    case "error":
      return { outputs: [...outputs, { output_type: "error", ename: String(content.ename ?? ""), evalue: String(content.evalue ?? ""), traceback: (content.traceback as string[]) ?? [] }], clearPending: false };
    case "clear_output":
      return content.wait ? { outputs: state.outputs, clearPending: true } : { outputs: [], clearPending: false };
    default:
      return null;
  }
}

/** The richest MIME type we can render, in Jupyter's preference order. */
export function pickMime(data: Record<string, unknown>): string | null {
  const order = ["application/vnd.jupyter.widget-view+json", "text/html", "image/svg+xml", "image/png", "image/jpeg", "image/gif", "text/markdown", "text/latex", "application/json", "text/plain"];
  for (const m of order) if (m in data && m !== "application/vnd.jupyter.widget-view+json") return m;
  return Object.keys(data)[0] ?? null;
}

// ── ANSI → HTML ───────────────────────────────────────────────────────────

const COLORS = ["#2e3436", "#cc0000", "#4e9a06", "#c4a000", "#3465a4", "#75507b", "#06989a", "#d3d7cf"];
const BRIGHT = ["#555753", "#ef2929", "#8ae234", "#fce94f", "#729fcf", "#ad7fa8", "#34e2e2", "#eeeeec"];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Convert SGR-coloured text (tracebacks, colourful logs) to safe HTML spans. */
export function ansiToHtml(text: string): string {
  let out = "";
  let fg: string | null = null;
  let bg: string | null = null;
  let bold = false;
  const parts = text.split(/(\x1b\[[0-9;]*m)/);
  for (const p of parts) {
    const m = /^\x1b\[([0-9;]*)m$/.exec(p);
    if (!m) {
      if (!p) continue;
      const style = [fg ? `color:${fg}` : "", bg ? `background:${bg}` : "", bold ? "font-weight:bold" : ""].filter(Boolean).join(";");
      out += style ? `<span style="${style}">${esc(p)}</span>` : esc(p);
      continue;
    }
    const codes = (m[1] || "0").split(";").map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) [fg, bg, bold] = [null, null, false];
      else if (c === 1) bold = true;
      else if (c === 22) bold = false;
      else if (c >= 30 && c <= 37) fg = COLORS[c - 30];
      else if (c >= 90 && c <= 97) fg = BRIGHT[c - 90];
      else if (c === 39) fg = null;
      else if (c >= 40 && c <= 47) bg = COLORS[c - 40];
      else if (c === 49) bg = null;
      else if ((c === 38 || c === 48) && codes[i + 1] === 5) {
        const n = codes[i + 2];
        const col = n < 8 ? COLORS[n] : n < 16 ? BRIGHT[n - 8] : n >= 232 ? `rgb(${8 + (n - 232) * 10},${8 + (n - 232) * 10},${8 + (n - 232) * 10})` : (() => {
          const k = n - 16;
          const v = (x: number) => (x ? 55 + x * 40 : 0);
          return `rgb(${v(Math.floor(k / 36))},${v(Math.floor(k / 6) % 6)},${v(k % 6)})`;
        })();
        if (c === 38) fg = col;
        else bg = col;
        i += 2;
      } else if ((c === 38 || c === 48) && codes[i + 1] === 2) {
        const col = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`;
        if (c === 38) fg = col;
        else bg = col;
        i += 4;
      }
    }
  }
  return out;
}
