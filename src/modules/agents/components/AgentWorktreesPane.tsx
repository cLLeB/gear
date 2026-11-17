// gear-agents://: the agents working in isolated worktrees, side by side —
// what each one changed against the branch it started from, whether it is
// still working, and one click to look at the diff, open a terminal there,
// merge the work back or throw it away.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import { openTextViewer } from "@/modules/compare/CompareDialog";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { git } from "@/modules/git-actions/gitCli";
import { confirmPick, quickPick } from "@/modules/quick-pick";
import { leafIds } from "@/modules/terminal/lib/panes";
import { useAgentActivityStore, type AgentPhase } from "@/modules/terminal/lib/agentActivity";
import { leafCwd, ptyIdForLeaf } from "@/modules/terminal/lib/useTerminalSession";
import { toolPaneHandle } from "@/modules/tools/paneHandle";
import { agentDiff, type AgentWorktree, discardAgentWorktree, listAgentWorktrees, mainCheckout, mergeAgentWorktree } from "../lib/worktrees";

export const AGENT_WORKTREES_PATH = "gear-agents://Agent worktrees";

const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";
const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

const PHASE: Record<AgentPhase | "none", { label: string; dot: string }> = {
  working: { label: "working", dot: "bg-sky-500 animate-pulse" },
  attention: { label: "needs you", dot: "bg-amber-500" },
  finished: { label: "finished", dot: "bg-emerald-500" },
  idle: { label: "idle", dot: "bg-muted-foreground/50" },
  none: { label: "no terminal open", dot: "bg-transparent border border-muted-foreground/40" },
};

/** Live agent state of the terminal pane running in this worktree, if any. */
function usePhaseFor(path: string): AgentPhase | "none" {
  const phases = useAgentActivityStore((s) => s.phases);
  for (const t of app().tabs()) {
    if (t.kind !== "terminal") continue;
    for (const leaf of leafIds(t.paneTree)) {
      const cwd = leafCwd(leaf);
      if (!cwd || !norm(cwd).startsWith(norm(path))) continue;
      const pty = ptyIdForLeaf(leaf);
      return (pty !== null && phases[pty]) || "idle";
    }
  }
  return "none";
}

function openAgentWorktrees(): void {
  app().openFile(AGENT_WORKTREES_PATH);
}

function Row({ wt, root, onChanged }: { wt: AgentWorktree; root: string; onChanged: () => void }) {
  const phase = usePhaseFor(wt.path);
  const [busy, setBusy] = useState(false);
  const name = wt.branch.replace(/^agent\//, "");
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
      onChanged();
    }
  };
  return (
    <tr className="border-b border-border/40 align-middle hover:bg-muted/40" data-branch={wt.branch}>
      <td className="py-1.5 pr-2">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 shrink-0 rounded-full", PHASE[phase].dot)} title={PHASE[phase].label} />
          <span className="font-mono">{name}</span>
        </div>
        <div className="pl-4 text-[10.5px] text-muted-foreground">{PHASE[phase].label} · from {wt.base}</div>
      </td>
      <td className="text-right tabular-nums">{wt.files}</td>
      <td className="text-right tabular-nums text-emerald-500">+{wt.insertions}</td>
      <td className="text-right tabular-nums text-red-500">−{wt.deletions}</td>
      <td className="text-right tabular-nums">{wt.ahead}</td>
      <td className="text-right tabular-nums">{wt.dirty ? <span className="text-amber-500">{wt.dirty}</span> : "–"}</td>
      <td className="py-1.5 pl-3">
        <div className="flex flex-wrap justify-end gap-1">
          <button type="button" className={btn} disabled={busy} onClick={() => void run(async () => openTextViewer(`${name} vs ${wt.base}`, (await agentDiff(wt)) || "No changes yet.", "diff"))}>
            Diff
          </button>
          <button type="button" className={btn} onClick={() => app().openTerminal({ cwd: wt.path })}>
            Terminal
          </button>
          <button
            type="button"
            className={cn(btn, "border-emerald-500/40")}
            disabled={busy || (wt.files === 0 && wt.ahead === 0)}
            onClick={() =>
              void run(async () => {
                const sure = await confirmPick(`Merge ${name} into ${wt.base}?`, "Merge", wt.dirty ? `Its ${wt.dirty} uncommitted change(s) are committed on the agent branch first.` : `${wt.ahead} commit(s), ${wt.files} file(s).`);
                if (!sure) return;
                const r = await mergeAgentWorktree(root, wt);
                if (!r.ok) {
                  toast.error("Merge did not finish", { description: r.error.slice(0, 500) });
                  return;
                }
                toast.success(r.message);
                // The work is in the base branch now; offer to tidy up the agent's folder and branch.
                if (await confirmPick(`Remove ${name}'s worktree and branch?`, "Remove", "Its work is merged; the folder is no longer needed.")) {
                  const d = await discardAgentWorktree(root, { ...wt, dirty: 0 });
                  if (!d.ok) toast.error("Could not remove the worktree", { description: d.error.slice(0, 400) });
                }
              })
            }
          >
            Merge
          </button>
          <button
            type="button"
            className={cn(btn, "border-red-500/40")}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const sure = await confirmPick(`Discard ${name}?`, "Discard", "Deletes its folder and branch, including uncommitted work. This can't be undone.");
                if (!sure) return;
                const r = await discardAgentWorktree(root, wt);
                if (r.ok) toast.success(r.message);
                else toast.error("Could not discard", { description: r.error.slice(0, 400) });
              })
            }
          >
            Discard
          </button>
        </div>
      </td>
    </tr>
  );
}

export const AgentWorktreesPane = forwardRef<EditorPaneHandle, { path: string }>(function AgentWorktreesPane({ path }, ref) {
  const [root, setRoot] = useState<string | null>(null);
  const [rows, setRows] = useState<AgentWorktree[] | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const ws = app().workspaceRoot();
      const r = ws ? await mainCheckout(ws) : null;
      setRoot(r);
      setRows(r ? await listAgentWorktrees(r) : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useImperativeHandle(ref, () => toolPaneHandle(path, { reload: () => (void refresh(), true) }), [path, refresh]);
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 15000);
    return () => clearInterval(t);
  }, [refresh]);

  const compare = async () => {
    if (!root || !rows || rows.length < 2) return;
    const items = rows.map((r) => ({ label: r.branch.replace(/^agent\//, ""), value: r }));
    const a = await quickPick(items, { title: "Compare which agent…" });
    if (!a) return;
    const b = await quickPick(items.filter((i) => i.value !== a), { title: `…with which agent?` });
    if (!b) return;
    const d = await git(root, ["diff", a.branch, b.branch], 60);
    openTextViewer(`${a.branch} vs ${b.branch}`, d.stdout || "The two branches have the same committed content. (Uncommitted changes aren't compared.)", "diff");
  };

  const totals = useMemo(() => (rows ?? []).reduce((n, r) => n + r.files, 0), [rows]);

  return (
    <div className="flex h-full flex-col overflow-auto text-[12.5px]">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 p-2">
        <span className="font-medium">Agent worktrees</span>
        {root && <span className="text-muted-foreground">· {root}</span>}
        <span className="flex-1" />
        <button type="button" className={btn} disabled={!rows || rows.length < 2} onClick={() => void compare()}>
          Compare two
        </button>
        <button type="button" className={btn} disabled={loading} onClick={() => void refresh()}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {!root && rows !== null ? (
        <div className="max-w-[640px] p-6 text-muted-foreground">Open a folder inside a git repository to see its agent worktrees.</div>
      ) : rows && rows.length === 0 ? (
        <div className="max-w-[640px] space-y-2 p-6 text-muted-foreground">
          <p>No agents are working in worktrees here.</p>
          <p>
            Launch agents from the new-tab menu with “Isolate each agent in a git worktree” on: each gets its own branch and folder made from your last commit, so several agents can work on the same project at once. Their work shows up here to compare, merge or discard.
          </p>
        </div>
      ) : (
        <div className="p-3">
          <table className="w-full">
            <thead className="text-[11px] text-muted-foreground">
              <tr className="border-b border-border/60">
                <th className="pb-1 text-left font-normal">agent</th>
                <th className="pb-1 text-right font-normal">files</th>
                <th className="pb-1 text-right font-normal">added</th>
                <th className="pb-1 text-right font-normal">removed</th>
                <th className="pb-1 text-right font-normal">commits</th>
                <th className="pb-1 text-right font-normal">uncommitted</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((wt) => (
                <Row key={wt.branch} wt={wt} root={root as string} onChanged={() => void refresh()} />
              ))}
            </tbody>
          </table>
          {rows && rows.length > 0 && (
            <p className="mt-3 text-[11px] text-muted-foreground">
              {rows.length} agent(s), {totals} changed file(s) in total. Merge brings an agent's branch into the branch it started from with a merge commit; resolve any conflicts in a terminal.
            </p>
          )}
        </div>
      )}
    </div>
  );
});

export const AGENT_WORKTREE_ACTIONS = [
  {
    id: "agents.worktrees",
    label: "Agents: Worktrees (compare, merge or discard isolated agents)",
    keywords: ["agents", "worktree", "parallel", "isolate", "claude", "codex", "merge", "branch", "compare"],
    run: openAgentWorktrees,
  },
];
