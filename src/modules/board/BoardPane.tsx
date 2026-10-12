// gear-board://<file>: a Markdown file shown as a Kanban board. Every change is
// written straight back to the file, which stays ordinary Markdown.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { app, frontFilePath } from "@/app/appBridge";
import { cn, isMarkdownPath } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { inputBox } from "@/modules/quick-pick";
import { toolPaneHandle } from "@/modules/tools/paneHandle";
import { addCard, addColumn, columnTitle, deleteCard, editCard, moveCard, moveColumn, NEW_BOARD, overdue, parseBoard, renameColumn, serializeBoard, toggleCard, viewCard, type Board } from "./model";

const SCHEME = "gear-board://";

export function openBoardFor(file: string): void {
  app().openFile(`${SCHEME}${file}`);
}

export function openBoardForActive(): void {
  const file = frontFilePath() ?? getActiveEditor()?.path ?? null;
  if (!file || !isMarkdownPath(file)) return void toast.info("Open a Markdown file first — its ## headings become the columns.");
  openBoardFor(file);
}

export async function newBoard(): Promise<void> {
  const root = app().workspaceRoot();
  if (!root) return void toast.error("Open a folder first.");
  const name = (await inputBox({ title: "New board file", value: "TODO.md", placeholder: "File name" }))?.trim();
  if (!name) return;
  const file = `${root.replace(/[\\/]+$/, "")}/${/\.(md|markdown)$/i.test(name) ? name : `${name}.md`}`;
  const existing = await native.readFile(file).catch(() => null);
  if (!existing) {
    try {
      await native.writeFile(file, NEW_BOARD, "user");
    } catch (err) {
      return void toast.error(`Could not create ${name}: ${String(err)}`);
    }
  }
  openBoardFor(file);
}

const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";
const mini = "rounded px-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30";

interface Drag {
  col: number;
  index: number;
}

export const BoardPane = forwardRef<EditorPaneHandle, { path: string }>(function BoardPane({ path }, ref) {
  const file = path.slice(SCHEME.length);
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ col: number; index: number; text: string } | null>(null);
  const [adding, setAdding] = useState<{ col: number; text: string } | null>(null);
  const [drop, setDrop] = useState<{ col: number; index: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  const lastWritten = useRef<string | null>(null);

  const load = useCallback(async () => {
    const r = await native.readFile(file).catch((e) => ({ kind: "error" as const, message: String(e) }));
    if (r.kind !== "text") {
      setError(r.kind === "error" ? r.message : "This file is not text.");
      return;
    }
    setError(null);
    // Skip our own write coming back, so an edit in progress is not interrupted.
    if (r.content === lastWritten.current) return;
    lastWritten.current = r.content;
    setBoard(parseBoard(r.content));
  }, [file]);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  useImperativeHandle(ref, () => toolPaneHandle(path, { setQuery, clearQuery: () => setQuery(""), reload: () => (void load(), true) }), [path, load]);

  const apply = useCallback(
    (next: Board) => {
      if (next === board) return;
      setBoard(next);
      const text = serializeBoard(next);
      lastWritten.current = text;
      native.writeFile(file, text, "user").catch((err) => toast.error(`Could not save the board: ${String(err)}`));
    },
    [board, file],
  );

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const q = query.trim().toLowerCase();

  if (error) return <div className="p-6 text-[12.5px] text-red-500">{error}</div>;
  if (!board) return <div className="p-6 text-[12.5px] text-muted-foreground">Reading the board…</div>;

  const total = board.columns.reduce((a, c) => a + c.cards.length, 0);

  return (
    <div className="flex h-full flex-col text-[12.5px]">
      <div className="flex items-center gap-1.5 border-b border-border/60 p-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted-foreground" title={file}>
          {file}
        </span>
        <span className="text-muted-foreground">{total} cards</span>
        <input className="w-[180px] rounded border border-border/60 bg-background px-2 py-0.5 text-[12px] outline-none focus:border-ring" value={query} placeholder="Filter cards" onChange={(e) => setQuery(e.target.value)} />
        <button
          type="button"
          className={btn}
          onClick={() =>
            void inputBox({ title: "New column", placeholder: "Column title" }).then((t) => {
              if (t) apply(addColumn(board, t));
            })
          }
        >
          + Column
        </button>
        <button type="button" className={btn} title="Edit the Markdown file" onClick={() => app().openFile(file)}>
          Open as text
        </button>
      </div>
      {board.columns.length === 0 ? (
        <div className="p-6 text-muted-foreground">
          This file has no <code>## headings</code> yet. Each one becomes a column; the list items under it are the cards. Use “+ Column” to add the first.
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto p-2">
          {board.columns.map((c, ci) => (
            <div
              key={ci}
              data-column={columnTitle(c)}
              className={cn("flex w-[280px] shrink-0 flex-col rounded-md border border-border/60 bg-muted/20", drop?.col === ci && "border-ring")}
              onDragOver={(e) => {
                if (!drag.current) return;
                e.preventDefault();
                if (drop?.col !== ci) setDrop({ col: ci, index: c.cards.length });
              }}
              onDrop={(e) => {
                e.preventDefault();
                const d = drag.current;
                if (!d) return;
                let to = drop?.col === ci ? drop.index : c.cards.length;
                if (d.col === ci && d.index < to) to--;
                apply(moveCard(board, d.col, d.index, ci, to));
                drag.current = null;
                setDrop(null);
              }}
            >
              <div className="flex items-center gap-1 border-b border-border/60 px-2 py-1">
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left font-medium"
                  title="Rename"
                  onClick={() =>
                    void inputBox({ title: "Rename column", value: columnTitle(c) }).then((t) => {
                      if (t) apply(renameColumn(board, ci, t));
                    })
                  }
                >
                  {columnTitle(c)}
                </button>
                <span className="tabular-nums text-muted-foreground">{c.cards.length}</span>
                <button type="button" className={mini} disabled={ci === 0} title="Move column left" onClick={() => apply(moveColumn(board, ci, -1))}>
                  ◀
                </button>
                <button type="button" className={mini} disabled={ci === board.columns.length - 1} title="Move column right" onClick={() => apply(moveColumn(board, ci, 1))}>
                  ▶
                </button>
              </div>
              <div className="min-h-[40px] flex-1 space-y-1.5 overflow-y-auto p-1.5">
                {c.cards.map((card, i) => {
                  const v = viewCard(card);
                  if (q && !card.lines.join("\n").toLowerCase().includes(q)) return null;
                  const isEditing = editing?.col === ci && editing.index === i;
                  return (
                    <div key={i}>
                      {drop?.col === ci && drop.index === i && <div className="mb-1 h-0.5 rounded bg-ring" />}
                      <div
                        data-card={v.text}
                        draggable={!isEditing}
                        onDragStart={(e) => {
                          drag.current = { col: ci, index: i };
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", v.text);
                        }}
                        onDragEnd={() => {
                          drag.current = null;
                          setDrop(null);
                        }}
                        onDragOver={(e) => {
                          if (!drag.current) return;
                          e.preventDefault();
                          e.stopPropagation();
                          const r = e.currentTarget.getBoundingClientRect();
                          const index = e.clientY < r.top + r.height / 2 ? i : i + 1;
                          if (drop?.col !== ci || drop.index !== index) setDrop({ col: ci, index });
                        }}
                        className={cn("group rounded border border-border/60 bg-background p-1.5 shadow-sm", v.done && "opacity-60")}
                      >
                        {isEditing ? (
                          <textarea
                            autoFocus
                            className="w-full resize-none rounded border border-ring bg-background p-1 text-[12.5px] outline-none"
                            rows={2}
                            value={editing.text}
                            onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                            onBlur={() => (apply(editCard(board, ci, i, editing.text)), setEditing(null))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) (e.preventDefault(), apply(editCard(board, ci, i, editing.text)), setEditing(null));
                              if (e.key === "Escape") setEditing(null);
                            }}
                          />
                        ) : (
                          <div className="flex items-start gap-1.5">
                            {v.done !== null && <input type="checkbox" className="mt-0.5" checked={v.done} onChange={() => apply(toggleCard(board, ci, i))} />}
                            <button type="button" className={cn("min-w-0 flex-1 whitespace-pre-wrap break-words text-left", v.done && "line-through")} title="Click to edit" onClick={() => setEditing({ col: ci, index: i, text: v.text })}>
                              {v.text}
                            </button>
                          </div>
                        )}
                        {v.details.length > 0 && <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-[11.5px] text-muted-foreground">{v.details.join("\n")}</pre>}
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {v.tags.map((t) => (
                            <button key={t} type="button" className="rounded bg-sky-500/15 px-1 text-[10.5px] text-sky-600" onClick={() => setQuery(`#${t}`)}>
                              #{t}
                            </button>
                          ))}
                          {v.due && <span className={cn("rounded px-1 text-[10.5px]", overdue(v.due, today) && !v.done ? "bg-red-500/15 text-red-500" : "bg-muted text-muted-foreground")}>due {v.due}</span>}
                          <span className="flex-1" />
                          <span className="flex opacity-0 group-hover:opacity-100">
                            <button type="button" className={mini} disabled={ci === 0} title="Move to the column on the left" onClick={() => apply(moveCard(board, ci, i, ci - 1, board.columns[ci - 1].cards.length))}>
                              ←
                            </button>
                            <button type="button" className={mini} disabled={i === 0} title="Move up" onClick={() => apply(moveCard(board, ci, i, ci, i - 1))}>
                              ↑
                            </button>
                            <button type="button" className={mini} disabled={i === c.cards.length - 1} title="Move down" onClick={() => apply(moveCard(board, ci, i, ci, i + 1))}>
                              ↓
                            </button>
                            <button type="button" className={mini} disabled={ci === board.columns.length - 1} title="Move to the column on the right" onClick={() => apply(moveCard(board, ci, i, ci + 1, board.columns[ci + 1].cards.length))}>
                              →
                            </button>
                            <button type="button" className={mini} title="Delete card" onClick={() => apply(deleteCard(board, ci, i))}>
                              ✕
                            </button>
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {drop?.col === ci && drop.index >= c.cards.length && <div className="h-0.5 rounded bg-ring" />}
              </div>
              {adding?.col === ci ? (
                <textarea
                  autoFocus
                  className="m-1.5 resize-none rounded border border-ring bg-background p-1 text-[12.5px] outline-none"
                  rows={2}
                  placeholder="Card text — Enter to add, Esc to cancel"
                  value={adding.text}
                  onChange={(e) => setAdding({ col: ci, text: e.target.value })}
                  onBlur={() => (adding.text.trim() && apply(addCard(board, ci, adding.text)), setAdding(null))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (adding.text.trim()) apply(addCard(board, ci, adding.text));
                      setAdding({ col: ci, text: "" });
                    }
                    if (e.key === "Escape") setAdding(null);
                  }}
                />
              ) : (
                <button type="button" className="m-1.5 rounded border border-dashed border-border/60 py-1 text-muted-foreground hover:bg-muted" onClick={() => setAdding({ col: ci, text: "" })}>
                  + Add a card
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

export const BOARD_ACTIONS = [
  { id: "board.open", label: "Board: Show this Markdown file as a Kanban board", keywords: ["kanban", "board", "tasks", "todo", "cards", "columns", "trello"], run: openBoardForActive },
  { id: "board.new", label: "Board: New task board…", keywords: ["kanban", "board", "tasks", "todo", "new", "create"], run: () => void newBoard() },
];
