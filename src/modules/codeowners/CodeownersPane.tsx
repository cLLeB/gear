// gear-codeowners://: the workspace's CODEOWNERS file explained — how much
// of the repository it covers, which rules never apply, who owns what, who
// has to review this branch, and which owners do not exist on GitHub.

import { invoke } from "@tauri-apps/api/core";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { quoteShellArg } from "@/lib/shellQuote";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { copyToClipboard, toolPaneHandle } from "@/modules/tools/paneHandle";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { analyze, LOCATIONS, ownersOf, parseCodeowners, reviewersFor, unownedFolders, type Analysis, type Parsed } from "./model";

const PATH = "gear-codeowners://CODEOWNERS";
const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";

export function openCodeowners(): void {
  app().openFile(PATH);
}

type Tab = "overview" | "owners" | "test" | "branch";

interface Loaded {
  root: string;
  file: string | null;
  parsed: Parsed;
  files: string[];
  truncated: boolean;
  analysis: Analysis;
}

const join = (root: string, rel: string) => `${root.replace(/[\\/]+$/, "")}/${rel}`;

async function git(root: string, cmd: string): Promise<string | null> {
  const r = await native.runCommand(cmd, root, 60).catch(() => null);
  return r && r.exit_code === 0 ? r.stdout : null;
}

/** A starting CODEOWNERS from git history: each top-level folder's most frequent recent author. */
async function draftFromHistory(root: string, files: string[]): Promise<string> {
  const top = [...new Set(files.filter((f) => f.includes("/")).map((f) => f.split("/")[0]))].slice(0, 25);
  const lines = ["# Drafted from the last year of git history: each folder's most active author.", "# Replace emails with @users or @org/teams before committing.", ""];
  for (const dir of top) {
    const out = await git(root, `git shortlog -sne --since=1.year HEAD -- ${quoteShellArg(dir)}`);
    const first = out?.split(/\r?\n/).find((l) => l.trim());
    const email = first ? /<([^>]+)>/.exec(first)?.[1] : null;
    lines.push(email ? `/${dir}/ ${email}` : `# /${dir}/  (no commits in the last year)`);
  }
  return lines.join("\n");
}

export const CodeownersPane = forwardRef<EditorPaneHandle, { path: string }>(function CodeownersPane({ path }, ref) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [probe, setProbe] = useState("");
  const [owner, setOwner] = useState<string | null>(null);
  const [branch, setBranch] = useState<{ base: string; changed: string[] } | null>(null);
  const [exists, setExists] = useState<Map<string, boolean | null> | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const root = app().workspaceRoot();
      if (!root) throw new Error("Open a folder first.");
      let file: string | null = null;
      let text = "";
      for (const loc of LOCATIONS) {
        const r = await native.readFile(join(root, loc)).catch(() => null);
        if (r && r.kind === "text") {
          file = loc;
          text = r.content;
          break;
        }
      }
      const listed = await invoke<{ files: string[]; truncated?: boolean }>("fs_list_files", { root, limit: 10000, maxDepth: 16, workspace: currentWorkspaceEnv() });
      const files = listed.files.map((f) => f.replace(/\\/g, "/"));
      const parsed = parseCodeowners(text);
      setData({ root, file, parsed, files, truncated: !!listed.truncated || files.length >= 10000, analysis: analyze(files, parsed) });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);
  useEffect(() => void load(), [load]);
  useImperativeHandle(ref, () => toolPaneHandle(path, { reload: () => (void load(), true) }), [path, load]);

  const loadBranch = useCallback(async () => {
    if (!data) return;
    setBusy(true);
    const head = (await git(data.root, "git symbolic-ref --short refs/remotes/origin/HEAD"))?.trim().replace(/^origin\//, "");
    const base = head || ((await git(data.root, "git rev-parse --verify --quiet main")) !== null ? "main" : "master");
    const changed = new Set<string>();
    for (const cmd of [`git diff --name-only ${base}...HEAD`, "git diff --name-only HEAD", "git ls-files --others --exclude-standard"]) (await git(data.root, cmd))?.split(/\r?\n/).forEach((f) => f.trim() && changed.add(f.trim()));
    setBranch({ base, changed: [...changed].sort() });
    setBusy(false);
  }, [data]);
  useEffect(() => {
    if (tab === "branch" && !branch) void loadBranch();
  }, [tab, branch, loadBranch]);

  const checkOwners = async () => {
    if (!data) return;
    setChecking(true);
    const owners = [...new Set(data.parsed.rules.flatMap((r) => r.owners))].filter((o) => o.startsWith("@"));
    const m = new Map<string, boolean | null>();
    for (const o of owners) {
      const [org, team] = o.slice(1).split("/");
      const r = await native.runCommand(team ? `gh api ${quoteShellArg(`orgs/${org}/teams/${team}`)} --silent` : `gh api ${quoteShellArg(`users/${org}`)} --silent`, data.root, 30).catch(() => null);
      if (!r || (r.exit_code !== 0 && /not recognized|not found: gh|command not found|auth login/i.test(r.stderr))) {
        toast.error("Checking owners needs the GitHub CLI (gh), signed in.");
        setChecking(false);
        return;
      }
      m.set(o, r.exit_code === 0 ? true : /HTTP 404/.test(r.stderr) ? false : null);
      setExists(new Map(m));
    }
    setChecking(false);
  };

  const probeResult = useMemo(() => (data && probe.trim() ? ownersOf(probe.trim().replace(/^\//, ""), data.parsed.rules) : null), [data, probe]);
  const ownerFiles = useMemo(() => (data && owner ? data.files.filter((f) => ownersOf(f, data.parsed.rules).owners.includes(owner)) : []), [data, owner]);
  const review = useMemo(() => (data && branch ? reviewersFor(branch.changed, data.parsed.rules) : null), [data, branch]);

  if (error) return <div className="p-6 text-[12.5px] text-red-500">{error}</div>;
  if (!data) return <div className="p-6 text-[12.5px] text-muted-foreground">Reading CODEOWNERS…</div>;

  const openRule = (line: number) => data.file && app().openFile(join(data.root, data.file), line, 1);
  const openFile = (f: string) => app().openFile(join(data.root, f));
  const a = data.analysis;
  const pct = a.files ? Math.round((a.owned / a.files) * 1000) / 10 : 0;

  if (!data.file)
    return (
      <div className="space-y-3 p-6 text-[12.5px]" data-codeowners-missing>
        <div>
          This workspace has no CODEOWNERS file (looked in {LOCATIONS.join(", ")}). Without one, nobody is asked to review changes automatically.
        </div>
        <button
          type="button"
          className={btn}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void draftFromHistory(data.root, data.files)
              .then((d) => copyToClipboard(d))
              .then(() => toast.success("A draft CODEOWNERS is on the clipboard; paste it into .github/CODEOWNERS"))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Reading history…" : "Draft one from git history"}
        </button>
      </div>
    );

  const tabBtn = (t: Tab, label: string) => (
    <button key={t} type="button" data-codeowners-tab={t} className={cn("px-2 py-0.5 text-[11.5px]", tab === t ? "bg-primary/15 text-primary" : "hover:bg-muted")} onClick={() => setTab(t)}>
      {label}
    </button>
  );
  const ownerChip = (o: string) => {
    const e = exists?.get(o);
    return (
      <button key={o} type="button" className={cn("mr-1 rounded px-1 font-mono text-[11px]", e === false ? "bg-red-500/15 text-red-600 line-through" : "bg-muted")} title={e === false ? "Not found on GitHub" : undefined} onClick={() => {
          setOwner(o);
          setTab("owners");
        }}>
        {o}
      </button>
    );
  };

  return (
    <div className="flex h-full flex-col text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-2">
        <button type="button" className="font-mono text-[12px] hover:underline" onClick={() => openRule(1)}>
          {data.file}
        </button>
        <span className="text-muted-foreground" data-codeowners-summary>
          {data.parsed.rules.length} rules · {pct}% of {a.files.toLocaleString()} files owned{data.truncated ? " (first 10,000 files)" : ""}
        </span>
        <div className="flex rounded border border-border/60">
          {tabBtn("overview", "Overview")}
          {tabBtn("owners", "Owners")}
          {tabBtn("test", "Test a path")}
          {tabBtn("branch", "This branch")}
        </div>
        <span className="flex-1" />
        <button type="button" className={btn} disabled={checking} onClick={() => void checkOwners()} data-codeowners-check>
          {checking ? "Checking…" : "Check owners exist on GitHub"}
        </button>
        <button type="button" className={btn} onClick={() => void load()}>
          Reload
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {tab === "overview" && (
          <div className="space-y-4" data-codeowners-overview>
            <div className="h-2 w-full max-w-md rounded bg-red-500/30">
              <div className="h-2 rounded bg-emerald-500" style={{ width: `${pct}%` }} />
            </div>
            {exists && [...exists].some(([, v]) => v === false) && (
              <section className="text-red-600">
                Not found on GitHub (reviews requested from them silently go nowhere): {[...exists].filter(([, v]) => v === false).map(([o]) => o).join(", ")}
              </section>
            )}
            {data.parsed.problems.length > 0 && (
              <section>
                <div className="mb-1 font-medium">Problems</div>
                {data.parsed.problems.map((p, i) => (
                  <button key={i} type="button" className="block text-left hover:underline" onClick={() => openRule(p.line)} data-codeowners-problem>
                    <span className="font-mono text-[11.5px] text-muted-foreground">line {p.line}</span> <span className={p.severity === "error" ? "text-red-600" : "text-amber-700"}>{p.message}</span>
                  </button>
                ))}
              </section>
            )}
            <section>
              <div className="mb-1 font-medium">Rules that match no file ({a.dead.length})</div>
              {a.dead.length === 0 && <div className="text-muted-foreground">Every rule matches something.</div>}
              {a.dead.map((r) => (
                <button key={r.line} type="button" className="block text-left hover:underline" onClick={() => openRule(r.line)} data-codeowners-dead={r.pattern}>
                  <span className="font-mono text-[11.5px] text-muted-foreground">line {r.line}</span> <span className="font-mono">{r.pattern}</span>
                </button>
              ))}
            </section>
            <section>
              <div className="mb-1 font-medium">Rules a later rule always overrides ({a.shadowed.length})</div>
              {a.shadowed.length === 0 && <div className="text-muted-foreground">None: every matching rule decides some file.</div>}
              {a.shadowed.map(({ rule, by }) => (
                <div key={rule.line} data-codeowners-shadowed={rule.pattern}>
                  <button type="button" className="hover:underline" onClick={() => openRule(rule.line)}>
                    <span className="font-mono text-[11.5px] text-muted-foreground">line {rule.line}</span> <span className="font-mono">{rule.pattern}</span>
                  </button>
                  <span className="text-muted-foreground"> — overridden by {by.map((b) => `line ${b.line} (${b.pattern})`).join(", ")}. Last match wins, so put broad rules first.</span>
                </div>
              ))}
            </section>
            <section>
              <div className="mb-1 font-medium">Unowned files ({a.unowned.length.toLocaleString()})</div>
              {unownedFolders(a.unowned)
                .slice(0, 15)
                .map((u) => (
                  <div key={u.folder} className="flex gap-2" data-codeowners-unowned={u.folder}>
                    <span className="w-14 text-right tabular-nums text-muted-foreground">{u.files}</span>
                    <span className="font-mono">{u.folder}</span>
                  </div>
                ))}
            </section>
          </div>
        )}
        {tab === "owners" && (
          <div className="flex gap-4">
            <div className="w-72 shrink-0">
              {[...a.byOwner].map(([o, n]) => (
                <button key={o} type="button" data-codeowners-owner={o} className={cn("flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left hover:bg-muted/50", owner === o && "bg-primary/10")} onClick={() => setOwner(o)}>
                  <span className={cn("min-w-0 flex-1 truncate font-mono text-[12px]", exists?.get(o) === false && "text-red-600 line-through")}>{o}</span>
                  <span className="tabular-nums text-muted-foreground">{n.toLocaleString()}</span>
                </button>
              ))}
            </div>
            <div className="min-w-0 flex-1">
              {owner ? (
                <>
                  <div className="mb-1 font-medium">
                    {owner} owns {ownerFiles.length.toLocaleString()} files
                  </div>
                  {ownerFiles.slice(0, 500).map((f) => (
                    <button key={f} type="button" className="block truncate font-mono text-[11.5px] hover:underline" onClick={() => openFile(f)}>
                      {f}
                    </button>
                  ))}
                </>
              ) : (
                <div className="text-muted-foreground">Pick an owner to see their files.</div>
              )}
            </div>
          </div>
        )}
        {tab === "test" && (
          <div className="space-y-2">
            <input autoFocus className="w-full max-w-xl rounded border border-border/60 bg-transparent px-2 py-1 font-mono text-[12px]" placeholder="A path, e.g. src/components/Button.tsx" value={probe} onChange={(e) => setProbe(e.target.value)} data-codeowners-probe />
            {probeResult && (
              <div data-codeowners-probe-result>
                <div className="mb-1">{probeResult.owners.length ? <>Owned by {probeResult.owners.map(ownerChip)}</> : <span className="text-amber-700">Nobody owns this path.</span>}</div>
                {probeResult.matches.length === 0 && <div className="text-muted-foreground">No rule matches.</div>}
                {probeResult.matches.map((r) => (
                  <button key={r.line} type="button" className={cn("block text-left hover:underline", !probeResult.decided.includes(r) && "text-muted-foreground line-through")} onClick={() => openRule(r.line)}>
                    <span className="font-mono text-[11.5px]">line {r.line}</span> <span className="font-mono">{r.pattern}</span> {r.owners.join(" ") || "(no owners)"}
                    {r.section && <span className="text-muted-foreground"> [{r.section}]</span>}
                    {probeResult.decided.includes(r) && <span className="ml-1 text-emerald-600">decides</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {tab === "branch" && (
          <div className="space-y-2" data-codeowners-branch>
            {!review ? (
              <div className="text-muted-foreground">Reading the changes on this branch…</div>
            ) : (
              <>
                <div className="text-muted-foreground">
                  {branch?.changed.length} file{branch?.changed.length === 1 ? "" : "s"} changed against {branch?.base} (including uncommitted).
                  <button type="button" className="ml-2 underline" onClick={() => (setBranch(null), void loadBranch())}>
                    refresh
                  </button>
                </div>
                {review.reviewers.length === 0 && review.unowned.length === 0 && <div>No changes.</div>}
                {review.reviewers.map((r) => (
                  <div key={r.owner} data-codeowners-reviewer={r.owner}>
                    {ownerChip(r.owner)}
                    <span className="text-muted-foreground">
                      {r.files.length} file{r.files.length === 1 ? "" : "s"}: {r.files.slice(0, 4).join(", ")}
                      {r.files.length > 4 ? ` +${r.files.length - 4}` : ""}
                    </span>
                  </div>
                ))}
                {review.unowned.length > 0 && <div className="text-amber-700">No owner, so no required review: {review.unowned.slice(0, 8).join(", ")}{review.unowned.length > 8 ? ` +${review.unowned.length - 8}` : ""}</div>}
                {review.reviewers.length > 0 && (
                  <button type="button" className={btn} onClick={() => void copyToClipboard(review.reviewers.map((r) => r.owner).join(" ")).then(() => toast.success("Reviewers copied"))}>
                    Copy reviewers
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

export const CODEOWNERS_ACTIONS = [
  { id: "codeowners.open", label: "CODEOWNERS: Coverage, unowned files, dead rules and reviewers for this branch", keywords: ["codeowners", "owners", "review", "reviewers", "ownership", "github", "gitlab", "unowned"], run: openCodeowners },
];
