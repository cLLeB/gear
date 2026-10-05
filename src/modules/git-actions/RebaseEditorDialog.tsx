// Visual interactive rebase: drag commits to reorder, pick an action per
// commit (pick / reword / edit / squash / fixup / drop), edit reword messages
// inline, preview the resulting history, then run it in a terminal. Rewords
// are applied with exec steps so the rebase never stops for an editor.

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { app } from "@/app/appBridge";
import { native } from "@/modules/ai/lib/native";
import { LOG_FORMAT, parseLog } from "./extras";
import { autosquashPlan, planPreview, planTodo, planWarnings, validatePlan, type RebaseAction, type RebaseRow } from "./extras4";
import { git, requireRepo } from "./gitCli";

interface RebaseState {
  repoRoot: string;
  branch: string;
  /** Commits newest first, as loaded (up to 60). */
  history: { sha: string; short: string; subject: string; author: string; when: string; pushed: boolean }[];
  /** How many of the newest commits are being replanned. */
  count: number;
}

export const useRebaseStore = create<{ state: RebaseState | null }>(() => ({ state: null }));

export async function openRebaseEditor(): Promise<void> {
  const root = await requireRepo();
  if (!root) return;
  const branch = (await git(root, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
  const log = parseLog((await git(root, ["log", `--format=${LOG_FORMAT}`, "--first-parent", "-n", "61"])).stdout);
  if (log.length < 2) return void toast.info("Not enough commits to rebase");
  const upstream = await git(root, ["rev-list", "--count", "@{upstream}..HEAD"]);
  const pushedShas = new Set((await git(root, ["rev-list", "-n", "200", "@{upstream}"])).stdout.split("\n").filter(Boolean));
  const unpushed = upstream.ok ? Number(upstream.stdout.trim()) : 0;
  const history = log.slice(0, 60).map((c) => ({ sha: c.sha, short: c.short, subject: c.subject, author: c.author, when: c.when, pushed: pushedShas.has(c.sha) }));
  useRebaseStore.setState({ state: { repoRoot: root, branch, history, count: Math.min(history.length, unpushed >= 2 ? unpushed : 5) } });
}

const ACTIONS: { id: RebaseAction; label: string; hint: string; color: string }[] = [
  { id: "pick", label: "pick", hint: "keep the commit", color: "" },
  { id: "reword", label: "reword", hint: "keep, change the message", color: "text-sky-600 dark:text-sky-400" },
  { id: "edit", label: "edit", hint: "stop here to amend", color: "text-violet-600 dark:text-violet-400" },
  { id: "squash", label: "squash", hint: "meld into previous, keep both messages", color: "text-amber-600 dark:text-amber-400" },
  { id: "fixup", label: "fixup", hint: "meld into previous, discard this message", color: "text-amber-600 dark:text-amber-400" },
  { id: "drop", label: "drop", hint: "remove the commit", color: "text-red-600 dark:text-red-400 line-through" },
];

export function RebaseEditorDialog() {
  const state = useRebaseStore((s) => s.state);
  if (!state) return null;
  return <RebaseEditor key={`${state.repoRoot}|${state.count}|${state.history[0]?.sha}`} state={state} />;
}

function rowsFor(state: RebaseState): (RebaseRow & { short: string; author: string; when: string; pushed: boolean })[] {
  return state.history
    .slice(0, state.count)
    .reverse()
    .map((c) => ({ sha: c.short, subject: c.subject, action: "pick" as RebaseAction, short: c.short, author: c.author, when: c.when, pushed: c.pushed }));
}

function RebaseEditor({ state }: { state: RebaseState }) {
  const [rows, setRows] = useState(() => rowsFor(state));
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [dirtyTree, setDirtyTree] = useState(false);
  const problems = useMemo(() => validatePlan(rows), [rows]);
  const preview = useMemo(() => planPreview(rows), [rows]);
  const changed = rows.some((r, i) => r.action !== "pick" || r.sha !== rowsFor(state)[i]?.sha);
  const rewritesPushed = rows.some((r) => r.pushed) && changed;
  const base = state.history[state.count];

  useEffect(() => {
    void git(state.repoRoot, ["status", "--porcelain", "--untracked-files=no"]).then((r) => setDirtyTree(!!r.stdout.trim()));
  }, [state.repoRoot]);

  const close = () => useRebaseStore.setState({ state: null });
  const setCount = (count: number) => useRebaseStore.setState({ state: { ...state, count } });
  const update = (i: number, patch: Partial<RebaseRow>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= rows.length || from === to) return;
    setRows((rs) => {
      const next = [...rs];
      const [x] = next.splice(from, 1);
      next.splice(to, 0, x);
      return next;
    });
  };
  const autosquash = () => {
    const plan = autosquashPlan(rows.map((r) => ({ sha: r.sha, subject: r.subject })));
    setRows(plan.map((p) => ({ ...rows.find((r) => r.sha === p.sha)!, action: p.action })));
  };

  const run = async () => {
    if (!base) return void toast.error("Pick fewer commits — there's no base commit before them");
    let todo: string;
    try {
      todo = planTodo(rows);
    } catch (e) {
      return void toast.error(String(e instanceof Error ? e.message : e));
    }
    const gp = (await git(state.repoRoot, ["rev-parse", "--git-path", "gear-rebase-todo"])).stdout.trim();
    const todoPath = (/^([a-zA-Z]:)?[\\/]/.test(gp) ? gp : `${state.repoRoot}/${gp}`).replace(/\\/g, "/");
    await native.writeFile(todoPath, todo, "user");
    close();
    // git calls the sequence editor with the todo path; copying ours over it applies the plan.
    app().openTerminal({ cwd: state.repoRoot, command: `git -c "sequence.editor=cp '${todoPath}'" -c core.editor=true rebase -i --autostash ${base.short}` });
  };

  const btn = "rounded border border-border/60 px-2 py-0.5 text-[11px] hover:bg-muted disabled:opacity-50";
  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="flex h-[min(86vh,820px)] w-[min(1100px,calc(100vw-32px))] max-w-none flex-col gap-3 p-4 sm:max-w-none">
        <div className="flex items-center gap-3 pr-10">
          <DialogTitle className="text-sm">Interactive rebase · {state.branch}</DialogTitle>
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            last
            <select className="rounded border bg-background px-1 py-0.5 text-[11px]" value={state.count} onChange={(e) => setCount(Number(e.target.value))}>
              {Array.from({ length: Math.min(state.history.length - 1, 59) }, (_, i) => i + 2).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            commits onto <code className="font-mono">{base?.short ?? "?"}</code> <span className="max-w-60 truncate">{base?.subject}</span>
          </label>
          <div className="ml-auto flex gap-1">
            <button type="button" className={btn} onClick={autosquash} title="Fold fixup!/squash! commits into their targets">
              Autosquash
            </button>
            <button type="button" className={btn} onClick={() => setRows(rowsFor(state))}>
              Reset
            </button>
          </div>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-[1fr_280px] gap-3">
          <div className="flex min-h-0 flex-col overflow-hidden rounded-md border">
            <div className="border-b px-3 py-1.5 text-[11px] text-muted-foreground">Oldest first — applied top to bottom. Drag rows (or Alt+↑/↓) to reorder.</div>
            <div className="min-h-0 flex-1 overflow-auto">
              {rows.map((r, i) => {
                const a = ACTIONS.find((x) => x.id === r.action)!;
                return (
                  <div
                    key={r.sha}
                    draggable
                    tabIndex={0}
                    onDragStart={(e) => {
                      setDrag(i);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setOver(i);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (drag !== null) move(drag, i);
                      setDrag(null);
                      setOver(null);
                    }}
                    onDragEnd={() => {
                      setDrag(null);
                      setOver(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.altKey && e.key === "ArrowUp") {
                        e.preventDefault();
                        move(i, i - 1);
                      } else if (e.altKey && e.key === "ArrowDown") {
                        e.preventDefault();
                        move(i, i + 1);
                      }
                    }}
                    className={`group flex items-center gap-2 border-b border-border/40 px-2 py-1 text-[12px] outline-none focus:bg-muted/60 ${drag === i ? "opacity-40" : ""} ${over === i && drag !== null && drag !== i ? "border-t-2 border-t-primary" : ""} ${r.action === "squash" || r.action === "fixup" ? "pl-6" : ""}`}
                  >
                    <span className="cursor-grab select-none text-muted-foreground" title="Drag to reorder">
                      ⋮⋮
                    </span>
                    <select
                      className={`w-[76px] rounded border bg-background px-1 py-0.5 text-[11px] ${a.color.replace("line-through", "")}`}
                      value={r.action}
                      title={a.hint}
                      onChange={(e) => update(i, { action: e.target.value as RebaseAction, message: e.target.value === "reword" ? r.message ?? r.subject : r.message })}
                    >
                      {ACTIONS.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.label}
                        </option>
                      ))}
                    </select>
                    <code className="font-mono text-[11px] text-muted-foreground">{r.short}</code>
                    {r.action === "reword" ? (
                      <input
                        className="min-w-0 flex-1 rounded border bg-background px-1.5 py-0.5 text-[12px]"
                        value={r.message ?? ""}
                        autoFocus
                        onChange={(e) => update(i, { message: e.target.value })}
                      />
                    ) : (
                      <span className={`min-w-0 flex-1 truncate ${a.color}`} title={r.subject}>
                        {r.subject}
                      </span>
                    )}
                    {r.pushed ? (
                      <span className="rounded bg-amber-500/15 px-1 text-[10px] text-amber-700 dark:text-amber-300" title="Already on the upstream branch">
                        pushed
                      </span>
                    ) : null}
                    <span className="w-28 shrink-0 truncate text-right text-[10.5px] text-muted-foreground">
                      {r.author} · {r.when}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex min-h-0 flex-col gap-2">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border">
              <div className="border-b px-3 py-1.5 text-[11px] text-muted-foreground">Result — {preview.length} commit(s), newest first</div>
              <div className="min-h-0 flex-1 overflow-auto px-3 py-2 text-[12px]">
                {preview.map((s, i) => (
                  <div key={i} className="truncate py-0.5" title={s}>
                    ● {s}
                  </div>
                ))}
                <div className="truncate py-0.5 text-muted-foreground">○ {base?.subject} (base)</div>
              </div>
            </div>
            {[...problems, ...planWarnings(rows), ...(dirtyTree ? ["Uncommitted changes will be stashed and restored (--autostash)"] : []), ...(rewritesPushed ? ["This rewrites commits that are already pushed — you'll need a force push"] : [])].map((p) => (
              <div key={p} className={`rounded px-2 py-1 text-[11px] ${problems.includes(p) ? "bg-red-500/10 text-red-700 dark:text-red-300" : "bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>
                {p}
              </div>
            ))}
            <button type="button" className={`${btn} border-primary bg-primary py-1.5 text-primary-foreground hover:bg-primary/90`} disabled={!!problems.length || !changed} onClick={() => void run()}>
              {changed ? "Start rebase" : "No changes to apply"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
