// gear-apidiff://<spec>: what changed in an OpenAPI / Swagger description
// since a git ref (main, the last tag…) or another file, each change marked
// breaking, worth checking or compatible, with the version bump it calls
// for and release notes to copy.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { toast } from "sonner";
import { app, frontFilePath } from "@/app/appBridge";
import { quoteShellArg } from "@/lib/shellQuote";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { parseYaml } from "@/modules/editor/lib/textTools/yaml";
import { inputBox } from "@/modules/quick-pick";
import { base64ToBytes, copyToClipboard, toolPaneHandle, toolsNative } from "@/modules/tools/paneHandle";
import { diffSpecs, toMarkdown, type ApiChange, type Severity } from "./model";

const SCHEME = "gear-apidiff://";
const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";
const SEV_STYLE: Record<Severity, string> = {
  breaking: "bg-red-500/15 text-red-600",
  risky: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  safe: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
};
const SEV_LABEL: Record<Severity, string> = { breaking: "Breaking", risky: "Check", safe: "Compatible" };

export function openApiDiffFor(file: string): void {
  app().openFile(`${SCHEME}${file}`);
}

export async function openApiDiff(): Promise<void> {
  const current = frontFilePath() ?? getActiveEditor()?.path ?? "";
  const file = /\.(ya?ml|json)$/i.test(current) && !current.includes("://") ? current : (await inputBox({ title: "Check an OpenAPI spec for breaking changes", placeholder: "Path to openapi.yaml / swagger.json" }))?.trim();
  if (file) openApiDiffFor(file);
}

function parseSpec(text: string, name: string): unknown {
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  try {
    return /^\s*[{[]/.test(t) ? JSON.parse(t) : parseYaml(t);
  } catch (err) {
    throw new Error(`Could not read ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, "");
const nameOf = (p: string) => p.split(/[\\/]/).pop() ?? p;

async function readSpec(path: string): Promise<unknown> {
  const r = await toolsNative.readBytes(path, 32 * 1024 * 1024);
  return parseSpec(new TextDecoder().decode(base64ToBytes(r.data)), nameOf(path));
}

/** The file as it was at `ref`, through git. */
async function readAtRef(path: string, ref: string): Promise<unknown> {
  const r = await native.runCommand(`git show ${quoteShellArg(`${ref}:./${nameOf(path)}`)}`, dirOf(path), 60);
  if (r.exit_code !== 0) {
    const msg = (r.stderr || r.stdout).trim();
    if (/exists on disk, but not in|does not exist in/.test(msg)) throw new Error(`${nameOf(path)} did not exist at ${ref}. Compare with a later branch, tag or commit.`);
    if (/invalid object name|unknown revision|bad revision|not a valid object name/i.test(msg)) throw new Error(`${ref} is not a branch, tag or commit in this repository.`);
    if (/not a git repository/i.test(msg)) throw new Error("This file is not in a git repository; compare with another file instead.");
    throw new Error(msg || `git show failed for ${ref}.`);
  }
  if (r.truncated) throw new Error("The spec at that ref is larger than 256 KB, more than git output can carry here. Save it to a file (git show ref:path > old.yaml) and compare with that file.");
  return parseSpec(r.stdout, `${nameOf(path)} at ${ref}`);
}

/**
 * The ref most worth comparing with, among those where the file exists: the
 * default branch when on another branch, HEAD when the file has uncommitted
 * changes, else the last tag, else HEAD.
 */
async function defaultRef(file: string): Promise<string> {
  const dir = dirOf(file);
  const run = async (cmd: string) => {
    const r = await native.runCommand(cmd, dir, 20).catch(() => null);
    return r && r.exit_code === 0 ? r.stdout.trim() || "ok" : "";
  };
  const branch = await run("git rev-parse --abbrev-ref HEAD");
  const head = (await run("git symbolic-ref --short refs/remotes/origin/HEAD")).replace(/^origin\//, "");
  const main = head && head !== "ok" ? head : (await run("git rev-parse --verify --quiet main")) ? "main" : (await run("git rev-parse --verify --quiet master")) ? "master" : "";
  const changed = !(await run(`git diff --quiet HEAD -- ${quoteShellArg(nameOf(file))}`));
  const tag = await run("git describe --tags --abbrev=0");
  const candidates = [main && branch && branch !== main ? main : "", changed ? "HEAD" : "", tag && tag !== "ok" ? tag : "", "HEAD"].filter(Boolean);
  for (const ref of candidates) if (await run(`git cat-file -e ${quoteShellArg(`${ref}:./${nameOf(file)}`)}`)) return ref;
  return "HEAD";
}

function bump(changes: ApiChange[]): { level: "major" | "minor" | "patch" | "none"; why: string } {
  if (changes.some((c) => c.severity === "breaking")) return { level: "major", why: "breaking changes" };
  if (changes.some((c) => c.severity === "safe" && /^New (operation|optional|property|.* response)/.test(c.message))) return { level: "minor", why: "new, compatible features" };
  if (changes.length) return { level: "patch", why: "only changes that keep compatibility" };
  return { level: "none", why: "no changes" };
}

type Base = { kind: "ref"; ref: string } | { kind: "file"; path: string };

export const ApiDiffPane = forwardRef<EditorPaneHandle, { path: string }>(function ApiDiffPane({ path }, ref) {
  const file = path.startsWith(SCHEME) ? path.slice(SCHEME.length) : path;
  const [base, setBase] = useState<Base | null>(null);
  const [refText, setRefText] = useState("");
  const [changes, setChanges] = useState<ApiChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [hidden, setHidden] = useState<Set<Severity>>(new Set());

  const run = useCallback(
    async (b: Base | null) => {
      setBusy(true);
      setError(null);
      try {
        const chosen = b ?? { kind: "ref" as const, ref: await defaultRef(file) };
        if (!b) {
          setBase(chosen);
          if (chosen.kind === "ref") setRefText(chosen.ref);
        }
        const [before, after] = await Promise.all([chosen.kind === "ref" ? readAtRef(file, chosen.ref) : readSpec(chosen.path), readSpec(file)]);
        setChanges(diffSpecs(before, after));
      } catch (err) {
        setChanges(null);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [file],
  );
  useEffect(() => void run(null), [run]);
  const rerun = () => void run(base);
  useImperativeHandle(ref, () => toolPaneHandle(path, { setQuery: setText, clearQuery: () => setText(""), reload: () => (void run(base), true) }), [path, run, base]);

  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase();
    return (changes ?? []).filter((c) => !hidden.has(c.severity) && (!q || `${c.operation} ${c.where} ${c.message}`.toLowerCase().includes(q)));
  }, [changes, text, hidden]);
  const byOp = useMemo(() => {
    const m = new Map<string, ApiChange[]>();
    for (const c of filtered) m.set(c.operation, [...(m.get(c.operation) ?? []), c]);
    return [...m];
  }, [filtered]);

  const label = base ? (base.kind === "ref" ? `since ${base.ref}` : `since ${nameOf(base.path)}`) : "";
  const chooseFile = async () => {
    const p = (await inputBox({ title: "Compare with another version of the spec", value: `${dirOf(file)}/`, placeholder: "Path to the earlier openapi.yaml / swagger.json" }))?.trim();
    if (!p) return;
    const b: Base = { kind: "file", path: p };
    setBase(b);
    void run(b);
  };
  const compareRef = () => {
    const r = refText.trim();
    if (!r) return;
    const b: Base = { kind: "ref", ref: r };
    setBase(b);
    void run(b);
  };

  const counts = (s: Severity) => (changes ?? []).filter((c) => c.severity === s).length;
  const b = changes ? bump(changes) : null;

  return (
    <div className="flex h-full flex-col text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-2">
        <span className="font-medium">{nameOf(file)}</span>
        <span className="text-muted-foreground">compared with</span>
        <input
          className="w-36 rounded border border-border/60 bg-transparent px-2 py-0.5 font-mono text-[12px]"
          value={refText}
          placeholder="git ref"
          data-apidiff-ref
          onChange={(e) => setRefText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && compareRef()}
          title="A branch, tag or commit; Enter to compare"
        />
        <button type="button" className={btn} disabled={busy} onClick={compareRef}>
          Compare
        </button>
        <button type="button" className={btn} disabled={busy} onClick={() => void chooseFile()}>
          Another file…
        </button>
        <span className="flex-1" />
        <input className="w-44 rounded border border-border/60 bg-transparent px-2 py-0.5 text-[12px]" placeholder="Filter…" value={text} onChange={(e) => setText(e.target.value)} />
        <button type="button" className={btn} disabled={!changes} onClick={() => changes && void copyToClipboard(toMarkdown(changes, label)).then(() => toast.success("Release notes copied as Markdown"))}>
          Copy release notes
        </button>
        <button type="button" className={btn} disabled={busy} onClick={rerun}>
          {busy ? "Comparing…" : "Reload"}
        </button>
      </div>
      {error && (
        <pre className="whitespace-pre-wrap border-b border-border/60 bg-red-500/10 px-3 py-1.5 text-red-500" data-apidiff-error>
          {error}
        </pre>
      )}
      {changes && b && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 px-2 py-1.5" data-apidiff-summary>
          <span className={cn("mr-2 rounded px-1.5 py-0.5 font-medium", b.level === "major" ? "bg-red-500/15 text-red-600" : b.level === "minor" ? "bg-sky-500/15 text-sky-600" : "bg-muted")}>
            {b.level === "none" ? "No API changes" : `${b.level[0].toUpperCase()}${b.level.slice(1)} version bump`}
          </span>
          {b.level !== "none" && <span className="mr-2 text-muted-foreground">({b.why} {label})</span>}
          {(["breaking", "risky", "safe"] as Severity[]).map((s) => (
            <button key={s} type="button" data-apidiff-sev={s} className={cn("rounded px-1.5 py-0.5 text-[11.5px]", SEV_STYLE[s], hidden.has(s) && "opacity-40 line-through")} onClick={() => setHidden((h) => (h.has(s) ? new Set([...h].filter((x) => x !== s)) : new Set([...h, s])))}>
              {SEV_LABEL[s]} {counts(s)}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {!changes && !error && <div className="p-2 text-muted-foreground">Comparing…</div>}
        {changes && filtered.length === 0 && <div className="p-2 text-emerald-600">{changes.length ? "Everything is hidden by the filters." : `No differences in the API ${label}.`}</div>}
        {byOp.map(([op, list]) => (
          <div key={op} className="mb-2" data-apidiff-op={op}>
            <div className="font-mono text-[12px] font-medium">{op}</div>
            {list.map((c, i) => (
              <div key={i} className="flex items-baseline gap-2 py-0.5 pl-3">
                <span className={cn("w-20 shrink-0 rounded px-1 text-center text-[10.5px]", SEV_STYLE[c.severity])}>{SEV_LABEL[c.severity]}</span>
                {c.where && <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground">{c.where}</span>}
                <span className="min-w-0">{c.message}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
});

export const APIDIFF_ACTIONS = [
  { id: "apidiff.open", label: "OpenAPI: Check a spec for breaking changes (vs a branch, tag or file)…", keywords: ["openapi", "swagger", "breaking changes", "api diff", "compatibility", "semver", "release notes", "contract"], run: () => void openApiDiff() },
];
