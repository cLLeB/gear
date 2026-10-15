// gear-tfplan://<file>: a Terraform / OpenTofu plan to review before apply —
// every resource change with its attribute diff, what forces replacement,
// the changes worth a second look, drift and outputs. Takes the JSON from
// `terraform show -json`, a saved binary plan (converted with the CLI), or
// runs `plan` in a folder.

import { invoke } from "@tauri-apps/api/core";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { toast } from "sonner";
import { app, frontFilePath } from "@/app/appBridge";
import { quoteShellArg } from "@/lib/shellQuote";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { inputBox, quickPick } from "@/modules/quick-pick";
import { base64ToBytes, copyToClipboard, formatBytes, toolPaneHandle, toolsNative } from "@/modules/tools/paneHandle";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { ACTION_SYMBOL, parsePlan, summaryLine, toMarkdown, UNKNOWN, SENSITIVE, type Action, type Change, type Plan } from "./model";

const SCHEME = "gear-tfplan://";
const READ_CAP = 256 * 1024 * 1024;
const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";
const ACTION_STYLE: Record<Action, string> = {
  create: "text-emerald-600",
  update: "text-amber-600",
  delete: "text-red-600",
  replace: "text-fuchsia-600",
  read: "text-sky-600",
  "no-op": "text-muted-foreground",
  forget: "text-muted-foreground",
};
const ACTION_LABEL: Record<Action, string> = { create: "create", update: "update", delete: "destroy", replace: "replace", read: "read", "no-op": "no change", forget: "forget" };

export function openPlanFor(file: string): void {
  app().openFile(`${SCHEME}${file}`);
}

/** Asks for a plan: the current file, a plan file in the workspace, or a folder to run `plan` in. */
export async function openPlanReviewer(): Promise<void> {
  const current = frontFilePath() ?? getActiveEditor()?.path ?? "";
  const root = app().workspaceRoot();
  const items: { label: string; description?: string; value: string }[] = [];
  if (/\.(tfplan|plan|json)$/i.test(current)) items.push({ label: current.split(/[\\/]/).pop() ?? current, description: "Current file", value: current });
  if (root) {
    const listed = await invoke<{ files: string[] }>("fs_list_files", { root, limit: 30000, maxDepth: 10, workspace: currentWorkspaceEnv() }).catch(() => ({ files: [] as string[] }));
    const files = listed.files.map((f) => f.replace(/\\/g, "/")).filter((f) => !/(^|\/)\.terraform\//.test(f));
    for (const f of files) if (/\.tfplan$|(^|\/)(tf)?plan(\.out)?$|plan\.json$/i.test(f)) items.push({ label: f, description: "plan", value: `${root.replace(/[\\/]+$/, "")}/${f}` });
    const dirs = [...new Set(files.filter((f) => /\.tf$/.test(f)).map((f) => (f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : ".")))];
    for (const d of dirs.slice(0, 40)) items.push({ label: d === "." ? "(workspace root)" : d, description: "run plan here", value: `run:${root.replace(/[\\/]+$/, "")}${d === "." ? "" : `/${d}`}` });
  }
  items.push({ label: "Other file…", value: "" });
  const pick = await quickPick(items, { title: "Review a Terraform / OpenTofu plan", placeholder: "A saved plan, its JSON, or a folder to run plan in" });
  if (pick === undefined) return;
  if (pick.startsWith("run:")) return void app().openFile(`${SCHEME}${pick}`);
  const file = pick || (await inputBox({ title: "Open a plan", placeholder: "terraform plan -out=plan.tfplan, or terraform show -json plan.tfplan > plan.json" }))?.trim();
  if (file) openPlanFor(file);
}

function decode(bytes: Uint8Array): string {
  // Windows PowerShell 5.1 writes redirected output as UTF-16.
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  return new TextDecoder().decode(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes);
}

async function readText(path: string): Promise<string> {
  const r = await toolsNative.readBytes(path, READ_CAP);
  if (r.truncated) throw new Error(`${path.split(/[\\/]/).pop()} is ${formatBytes(r.size)}, too large to open.`);
  return decode(base64ToBytes(r.data));
}

/** `terraform`, else `tofu`. */
async function findCli(cwd: string): Promise<string> {
  for (const cli of ["terraform", "tofu"]) {
    const r = await native.runCommand(`${cli} version`, cwd, 30).catch(() => null);
    if (r && r.exit_code === 0) return cli;
  }
  throw new Error("Neither terraform nor tofu was found on PATH.");
}

const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, "");
const nameOf = (p: string) => p.split(/[\\/]/).pop() ?? p;

export const PlanPane = forwardRef<EditorPaneHandle, { path: string }>(function PlanPane({ path }, ref) {
  const target = path.startsWith(SCHEME) ? path.slice(SCHEME.length) : path;
  const runDir = target.startsWith("run:") ? target.slice(4) : null;
  const [plan, setPlan] = useState<Plan | null>(null);
  const [source, setSource] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [hideNoop, setHideNoop] = useState(true);
  const [only, setOnly] = useState<Action | "risky" | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const convert = useCallback(async (planFile: string): Promise<string> => {
    const cwd = dirOf(planFile);
    const cli = await findCli(cwd);
    const out = `${planFile}.json`;
    setBusy(`Converting with ${cli} show -json…`);
    const r = await native.runCommand(`${cli} show -no-color -json ${quoteShellArg(nameOf(planFile))} > ${quoteShellArg(out)}`, cwd, 300);
    if (r.exit_code !== 0) throw new Error(`${cli} show failed: ${(r.stderr || r.stdout).trim().slice(0, 2000)}`);
    toast.info(`Saved the plan as JSON: ${nameOf(out)}`);
    return readText(out);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      if (runDir) {
        const cli = await findCli(runDir);
        setBusy(`Running ${cli} plan in ${nameOf(runDir)}… (this can take a few minutes)`);
        const r = await native.runCommand(`${cli} plan -no-color -input=false -lock=false -out=gear.tfplan`, runDir, 300);
        if (r.timed_out) throw new Error(`${cli} plan took longer than 5 minutes. Run it in a terminal with -out=plan.tfplan and open the file here.`);
        if (r.exit_code !== 0) throw new Error(`${cli} plan failed:\n${(r.stderr || r.stdout).trim().slice(-4000)}`);
        setPlan(parsePlan(await convert(`${runDir}/gear.tfplan`)));
        setSource(`${runDir}/gear.tfplan`);
      } else {
        const raw = await readText(target).catch(() => {
          throw new Error(`Could not read ${target}.`);
        });
        const isJson = /^\s*\{/.test(raw);
        setPlan(parsePlan(isJson ? raw : await convert(target)));
        setSource(target);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, [target, runDir, convert]);
  useEffect(() => void load(), [load]);
  useImperativeHandle(ref, () => toolPaneHandle(path, { setQuery: setText, clearQuery: () => setText(""), reload: () => (void load(), true) }), [path, load]);

  const shown = useMemo(() => {
    if (!plan) return [];
    const q = text.trim().toLowerCase();
    return plan.changes.filter(
      (c) =>
        (!hideNoop || (c.action !== "no-op" && c.action !== "read") || c.movedFrom) &&
        (only === null || (only === "risky" ? c.risks.length > 0 : c.action === only)) &&
        (!q || `${c.address} ${c.type} ${c.diffs.map((d) => d.path).join(" ")}`.toLowerCase().includes(q)),
    );
  }, [plan, text, hideNoop, only]);
  const byModule = useMemo(() => {
    const m = new Map<string, Change[]>();
    for (const c of shown) m.set(c.module || "(root module)", [...(m.get(c.module || "(root module)") ?? []), c]);
    return [...m];
  }, [shown]);

  if (error)
    return (
      <div className="space-y-2 p-6 text-[12.5px]">
        <pre className="whitespace-pre-wrap text-red-500" data-tfplan-error>
          {error}
        </pre>
        <button type="button" className={btn} onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  if (!plan) return <div className="p-6 text-[12.5px] text-muted-foreground">{busy ?? "Reading the plan…"}</div>;

  const risky = plan.changes.filter((c) => c.risks.length);
  const dangers = risky.flatMap((c) => c.risks.filter((r) => r.level === "danger"));
  const toggle = (a: string) => setOpen((s) => (s.has(a) ? new Set([...s].filter((x) => x !== a)) : new Set([...s, a])));
  const chip = (a: Action | "risky", n: number, label: string, style: string) =>
    n > 0 && (
      <button key={a} type="button" data-tfplan-filter={a} className={cn("rounded px-1.5 py-0.5 text-[11.5px]", style, only === a ? "bg-primary/15 ring-1 ring-primary/40" : "bg-muted/60 hover:bg-muted")} onClick={() => setOnly(only === a ? null : a)}>
        {label} {n}
      </button>
    );

  return (
    <div className="flex h-full flex-col text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-2">
        <span className="font-medium" data-tfplan-summary>
          {summaryLine(plan)}
        </span>
        <span className="text-[11px] text-muted-foreground" title={source}>
          {nameOf(source)}
          {plan.version && ` · Terraform ${plan.version}`}
          {plan.errored && " · the plan errored and may be incomplete"}
        </span>
        <span className="flex-1" />
        <input className="w-48 rounded border border-border/60 bg-transparent px-2 py-0.5 text-[12px]" placeholder="Filter address, type, attribute…" value={text} onChange={(e) => setText(e.target.value)} />
        <button type="button" className={btn} onClick={() => setOpen(open.size ? new Set() : new Set(shown.map((c) => c.address)))}>
          {open.size ? "Collapse all" : "Expand all"}
        </button>
        <button type="button" className={btn} onClick={() => void copyToClipboard(toMarkdown(plan)).then(() => toast.success("Plan copied as a pull request comment"))}>
          Copy as PR comment
        </button>
        <button type="button" className={btn} disabled={!!busy} onClick={() => void load()}>
          {busy ? "Working…" : runDir ? "Plan again" : "Reload"}
        </button>
      </div>
      {risky.length > 0 && (
        <div className={cn("border-b border-border/60 px-3 py-1.5", dangers.length ? "bg-red-500/10" : "bg-amber-500/10")} data-tfplan-risks>
          <div className={cn("font-medium", dangers.length ? "text-red-600" : "text-amber-700 dark:text-amber-400")}>
            {risky.length} change{risky.length === 1 ? "" : "s"} worth a second look{dangers.length ? `, ${dangers.length} dangerous` : ""}
          </div>
          {risky.slice(0, 6).map((c) => (
            <button key={c.address} type="button" className="block w-full truncate text-left hover:underline" onClick={() => setOpen((s) => new Set([...s, c.address]))}>
              <span className="font-mono text-[11.5px]">{c.address}</span>: {c.risks.map((r) => r.message).join(" ")}
            </button>
          ))}
          {risky.length > 6 && <div className="text-muted-foreground">…and {risky.length - 6} more (filter: “needs a look”)</div>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 px-2 py-1.5">
        {chip("create", plan.counts.create, "+ create", ACTION_STYLE.create)}
        {chip("update", plan.counts.update, "~ update", ACTION_STYLE.update)}
        {chip("replace", plan.counts.replace, "-/+ replace", ACTION_STYLE.replace)}
        {chip("delete", plan.counts.delete, "- destroy", ACTION_STYLE.delete)}
        {chip("risky", risky.length, "needs a look", "text-red-600")}
        <label className="ml-2 flex items-center gap-1 text-[11.5px] text-muted-foreground">
          <input type="checkbox" checked={hideNoop} onChange={(e) => setHideNoop(e.target.checked)} /> Hide unchanged ({plan.changes.filter((c) => c.action === "no-op" || c.action === "read").length})
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {shown.length === 0 && <div className="p-2 text-muted-foreground">{plan.changes.length ? "Nothing matches the filters." : "This plan changes nothing."}</div>}
        {byModule.map(([mod, list]) => (
          <div key={mod} className="mb-2">
            {byModule.length > 1 && <div className="mb-0.5 font-mono text-[11.5px] text-muted-foreground">{mod}</div>}
            {list.map((c) => (
              <ResourceRow key={c.address} c={c} expanded={open.has(c.address)} onToggle={() => toggle(c.address)} />
            ))}
          </div>
        ))}
        {plan.drift.length > 0 && (
          <div className="mt-3" data-tfplan-drift>
            <div className="mb-1 font-medium">Changed outside Terraform since the last apply ({plan.drift.length})</div>
            {plan.drift.map((c) => (
              <ResourceRow key={`drift-${c.address}`} c={c} expanded={open.has(`drift-${c.address}`)} onToggle={() => toggle(`drift-${c.address}`)} />
            ))}
          </div>
        )}
        {plan.outputs.filter((o) => o.action !== "no-op").length > 0 && (
          <div className="mt-3">
            <div className="mb-1 font-medium">Outputs</div>
            {plan.outputs
              .filter((o) => o.action !== "no-op")
              .map((o) => (
                <div key={o.name} className="flex items-baseline gap-2 font-mono text-[11.5px]">
                  <span className={cn("w-8 shrink-0", ACTION_STYLE[o.action])}>{ACTION_SYMBOL[o.action]}</span>
                  <span>{o.name}</span>
                  <Val v={o.before} />
                  {o.action === "update" && <span className="text-muted-foreground">→</span>}
                  {o.action !== "delete" && <Val v={o.after} />}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
});

function Val({ v }: { v: string | null }) {
  if (v === null) return <span className="text-muted-foreground">null</span>;
  if (v === UNKNOWN || v === SENSITIVE) return <span className="italic text-muted-foreground">{v}</span>;
  return <span className="break-all">{v.length > 400 ? `${v.slice(0, 400)}…` : v}</span>;
}

function ResourceRow({ c, expanded, onToggle }: { c: Change; expanded: boolean; onToggle: () => void }) {
  const danger = c.risks.some((r) => r.level === "danger");
  return (
    <div className={cn("rounded", expanded && "bg-muted/20")} data-tfplan-resource={c.address}>
      <button type="button" className="flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left hover:bg-muted/50" onClick={onToggle}>
        <span className={cn("w-8 shrink-0 font-mono font-semibold", ACTION_STYLE[c.action])}>{ACTION_SYMBOL[c.action]}</span>
        <span className="min-w-0 truncate font-mono text-[12px]">{c.address}</span>
        <span className={cn("shrink-0 text-[11px]", ACTION_STYLE[c.action])}>{ACTION_LABEL[c.action]}</span>
        {c.movedFrom && <span className="shrink-0 rounded bg-sky-500/15 px-1 text-[10.5px] text-sky-600">moved from {c.movedFrom}</span>}
        {c.imported && <span className="shrink-0 rounded bg-sky-500/15 px-1 text-[10.5px] text-sky-600">import</span>}
        {c.risks.length > 0 && <span className={cn("shrink-0 rounded px-1 text-[10.5px]", danger ? "bg-red-500/15 text-red-600" : "bg-amber-500/15 text-amber-700")}>{danger ? "danger" : "look"}</span>}
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{c.diffs.length ? `${c.diffs.length} attribute${c.diffs.length === 1 ? "" : "s"}` : ""}</span>
      </button>
      {expanded && (
        <div className="pb-2 pl-11 pr-2">
          {c.risks.map((r, i) => (
            <div key={i} className={r.level === "danger" ? "text-red-600" : "text-amber-700 dark:text-amber-400"}>
              {r.message}
            </div>
          ))}
          {c.reason && <div className="text-[11.5px] text-muted-foreground">Reason: {c.reason.replace(/_/g, " ")}</div>}
          <div className="text-[11px] text-muted-foreground">
            {c.type} · {c.provider}
          </div>
          {c.diffs.length > 0 && (
            <table className="mt-1 w-full font-mono text-[11.5px]">
              <tbody>
                {c.diffs.map((d) => (
                  <tr key={d.path} className="align-top" data-tfplan-attr={d.path}>
                    <td className={cn("w-4 pr-1", d.kind === "added" ? "text-emerald-600" : d.kind === "removed" ? "text-red-600" : "text-amber-600")}>{d.kind === "added" ? "+" : d.kind === "removed" ? "-" : "~"}</td>
                    <td className="pr-3 whitespace-nowrap">
                      {d.path}
                      {d.forcesReplace && <span className="ml-1 rounded bg-fuchsia-500/15 px-1 font-sans text-[10px] text-fuchsia-600">forces replacement</span>}
                    </td>
                    <td className="w-full">
                      {d.kind !== "added" && <Val v={d.before} />}
                      {d.kind === "changed" && <span className="px-1 text-muted-foreground">→</span>}
                      {d.kind !== "removed" && <Val v={d.after} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

export const TFPLAN_ACTIONS = [
  { id: "tfplan.open", label: "Terraform: Review a plan before apply…", keywords: ["terraform", "opentofu", "tofu", "plan", "infrastructure", "iac", "hcl", "apply", "destroy", "drift"], run: () => void openPlanReviewer() },
];

