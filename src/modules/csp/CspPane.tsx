// gear-csp://: a Content-Security-Policy pasted in or fetched from a site —
// graded, with the weaknesses that let script injection through, the
// effective sources of every directive, and a tester for whether a given
// script, style, image or connection would load.

import { appCacheDir } from "@tauri-apps/api/path";
import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { IS_WINDOWS } from "@/lib/platform";
import { quoteShellArg } from "@/lib/shellQuote";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { base64ToBytes, copyToClipboard, toolPaneHandle, toolsNative } from "@/modules/tools/paneHandle";
import { allows, effective, evaluate, FALLBACK, grade, parsePolicies, strictTemplate, type Policy, type ResourceKind, type Severity } from "./model";

const PATH = "gear-csp://Content-Security-Policy";
const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";
const field = "rounded border border-border/60 bg-transparent px-2 py-0.5 text-[12px]";
const SEV_STYLE: Record<Severity, string> = { high: "bg-red-500/15 text-red-600", medium: "bg-amber-500/15 text-amber-700 dark:text-amber-400", low: "bg-sky-500/15 text-sky-600", info: "bg-muted text-muted-foreground" };
const GRADE_STYLE: Record<string, string> = { A: "bg-emerald-500 text-white", B: "bg-lime-500 text-white", C: "bg-amber-500 text-white", D: "bg-orange-600 text-white", F: "bg-red-600 text-white" };
const KINDS: { kind: ResourceKind; label: string; needsUrl: boolean }[] = [
  { kind: "script", label: "<script src>", needsUrl: true },
  { kind: "inline-script", label: "inline <script>", needsUrl: false },
  { kind: "event-handler", label: "onclick= handler", needsUrl: false },
  { kind: "eval", label: "eval()", needsUrl: false },
  { kind: "style", label: "stylesheet", needsUrl: true },
  { kind: "inline-style", label: "inline <style>", needsUrl: false },
  { kind: "img", label: "image", needsUrl: true },
  { kind: "font", label: "font", needsUrl: true },
  { kind: "connect", label: "fetch / XHR / WebSocket", needsUrl: true },
  { kind: "frame", label: "iframe", needsUrl: true },
  { kind: "worker", label: "worker", needsUrl: true },
  { kind: "media", label: "audio / video", needsUrl: true },
  { kind: "object", label: "<object> / <embed>", needsUrl: true },
  { kind: "form-action", label: "form submission to", needsUrl: true },
  { kind: "frame-ancestor", label: "being framed by", needsUrl: true },
];

export function openCsp(): void {
  app().openFile(PATH);
}

interface Source {
  label: string;
  policies: Policy[];
}

/** Fetches `url` and returns its enforced and report-only policies from headers and <meta>. */
async function fetchPolicies(url: string): Promise<{ sources: Source[]; status: number; finalUrl: string }> {
  const dir = `${(await appCacheDir()).replace(/\\/g, "/").replace(/\/+$/, "")}/csp`;
  await native.createDir(dir).catch(() => {});
  const curl = IS_WINDOWS ? "curl.exe" : "curl";
  const args = ["-sS", "-L", "--max-redirs", "8", "-m", "20", "--compressed", "-A", "Mozilla/5.0 (Gear CSP check)", "-D", `${dir}/headers.txt`, "-o", `${dir}/body.html`, "-w", "%{http_code} %{url_effective}", url];
  const r = await native.runCommand(`${curl} ${args.map((a) => quoteShellArg(a)).join(" ")}`, null, 30);
  if (r.exit_code !== 0) throw new Error((r.stderr || "curl failed").trim());
  const [code, finalUrl] = r.stdout.trim().split(" ");
  const read = async (p: string) => new TextDecoder().decode(base64ToBytes((await toolsNative.readBytes(p, 4 * 1024 * 1024)).data));
  const headerText = await read(`${dir}/headers.txt`);
  // With redirects, curl writes every response's headers; the last block is the page's.
  const blocks = headerText.split(/\r?\n\r?\n/).filter((b) => /^HTTP\//.test(b.trim()));
  const last = blocks[blocks.length - 1] ?? "";
  const sources: Source[] = [];
  for (const line of last.split(/\r?\n/)) {
    const m = /^(content-security-policy(-report-only)?):\s*(.*)$/i.exec(line);
    if (m && m[3].trim()) sources.push({ label: m[2] ? "Content-Security-Policy-Report-Only header" : "Content-Security-Policy header", policies: parsePolicies(m[3], !!m[2]) });
  }
  const body = await read(`${dir}/body.html`).catch(() => "");
  for (const m of body.matchAll(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi)) {
    const c = /content=(["'])([\s\S]*?)\1/i.exec(m[0]);
    if (c) sources.push({ label: "<meta> tag (frame-ancestors, report-uri and sandbox are ignored here)", policies: parsePolicies(c[2].replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&")) });
  }
  return { sources, status: Number(code), finalUrl: finalUrl ?? url };
}

export const CspPane = forwardRef<EditorPaneHandle, { path: string }>(function CspPane({ path }, ref) {
  const [mode, setMode] = useState<"paste" | "url">("url");
  const [text, setText] = useState("default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src * data:");
  const [url, setUrl] = useState("https://");
  const [fetched, setFetched] = useState<{ sources: Source[]; status: number; finalUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [which, setWhich] = useState(0);
  const [kind, setKind] = useState<ResourceKind>("script");
  const [resUrl, setResUrl] = useState("https://cdn.example.com/app.js");
  const [nonce, setNonce] = useState("");
  const [hash, setHash] = useState("");
  const [trusted, setTrusted] = useState(false);
  const [page, setPage] = useState("https://example.com/");

  useImperativeHandle(ref, () => toolPaneHandle(path), [path]);

  const sources: Source[] = useMemo(() => (mode === "paste" ? (text.trim() ? [{ label: "Pasted policy", policies: parsePolicies(text.replace(/^content-security-policy(-report-only)?:\s*/i, ""), /^content-security-policy-report-only:/i.test(text)) }] : []) : (fetched?.sources ?? [])), [mode, text, fetched]);
  const current = sources[Math.min(which, sources.length - 1)] ?? null;
  const policy = current?.policies[0] ?? null;
  const findings = useMemo(() => (current ? current.policies.flatMap((p) => evaluate(p)) : []), [current]);

  const doFetch = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetchPolicies(url.trim());
      setFetched(r);
      setWhich(0);
      setPage(r.finalUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const needsUrl = KINDS.find((k) => k.kind === kind)?.needsUrl ?? true;
  const decisions = current ? current.policies.map((p) => allows(p, { kind, url: needsUrl ? resUrl : null, nonce: nonce || undefined, hash: hash ? hash.replace(/^'|'$/g, "") : undefined, loadedByTrustedScript: trusted }, page)) : [];
  const allowed = decisions.length > 0 && decisions.every((d) => d.allowed) && !current?.policies.every((p) => p.reportOnly);

  return (
    <div className="flex h-full flex-col overflow-auto p-3 text-[12.5px]">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex rounded border border-border/60">
          {(["url", "paste"] as const).map((m) => (
            <button key={m} type="button" data-csp-mode={m} className={cn("px-2 py-0.5 text-[11.5px]", mode === m ? "bg-primary/15 text-primary" : "hover:bg-muted")} onClick={() => setMode(m)}>
              {m === "url" ? "Fetch from a URL" : "Paste a policy"}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <button type="button" className={btn} onClick={() => void copyToClipboard(strictTemplate(null)).then(() => toast.success("Strict policy template copied; generate a fresh nonce per response"))}>
          Copy a strict starting policy
        </button>
      </div>
      {mode === "url" ? (
        <div className="mb-3 flex items-center gap-2">
          <input className={cn(field, "w-full max-w-xl font-mono")} value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void doFetch()} data-csp-url />
          <button type="button" className={btn} disabled={busy || !/^https?:\/\/./.test(url.trim())} onClick={() => void doFetch()} data-csp-fetch>
            {busy ? "Fetching…" : "Fetch"}
          </button>
          {fetched && (
            <span className="text-muted-foreground">
              {fetched.status} · {fetched.finalUrl}
            </span>
          )}
        </div>
      ) : (
        <textarea className={cn(field, "mb-3 h-24 w-full font-mono text-[11.5px]")} value={text} onChange={(e) => setText(e.target.value)} data-csp-text placeholder="default-src 'self'; script-src …" />
      )}
      {error && <div className="mb-2 text-red-500">{error}</div>}
      {mode === "url" && fetched && sources.length === 0 && <div className="mb-2 font-medium text-red-600" data-csp-none>This page sends no Content-Security-Policy, so nothing limits what injected script can do.</div>}
      {sources.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {sources.map((s, i) => (
            <button key={i} type="button" className={cn(btn, i === which && "bg-primary/10")} onClick={() => setWhich(i)}>
              {s.label}
            </button>
          ))}
        </div>
      )}
      {current && policy && (
        <div className="space-y-4">
          <div className="flex items-center gap-3" data-csp-summary>
            <span className={cn("flex h-9 w-9 items-center justify-center rounded text-lg font-bold", GRADE_STYLE[grade(findings)])}>{grade(findings)}</span>
            <div>
              <div className="font-medium">{current.label}</div>
              <div className="text-muted-foreground">
                {findings.filter((f) => f.severity === "high").length} high · {findings.filter((f) => f.severity === "medium").length} medium · {findings.filter((f) => f.severity === "low").length} low
                {current.policies.length > 1 && ` · ${current.policies.length} policies, all enforced`}
                {policy.reportOnly && " · report-only: nothing is blocked"}
              </div>
            </div>
          </div>
          <section>
            {findings.map((f, i) => (
              <div key={i} className="flex items-baseline gap-2 py-0.5" data-csp-finding={f.severity}>
                <span className={cn("w-14 shrink-0 rounded px-1 text-center text-[10.5px]", SEV_STYLE[f.severity])}>{f.severity}</span>
                {f.directive && <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground">{f.directive}</span>}
                <span>{f.message}</span>
              </div>
            ))}
          </section>
          <section>
            <div className="mb-1 font-medium">What each directive allows</div>
            <table className="text-[12px]" data-csp-table>
              <tbody>
                {[...Object.keys(FALLBACK), "base-uri", "form-action", "frame-ancestors"].map((d) => {
                  const e = d in FALLBACK ? effective(policy, d) : { from: policy.directives.has(d) ? d : null, sources: policy.directives.get(d) ?? null };
                  return (
                    <tr key={d} className="align-top">
                      <td className="py-0.5 pr-3 font-mono">{d}</td>
                      <td className={cn("pr-3 font-mono text-[11.5px]", !e.sources && "text-amber-700 dark:text-amber-400")}>{e.sources ? e.sources.join(" ") || "(empty: nothing)" : "anything (not restricted)"}</td>
                      <td className="text-[11px] text-muted-foreground">{e.from && e.from !== d ? `from ${e.from}` : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
          <section className="space-y-1.5" data-csp-tester>
            <div className="font-medium">Would this load?</div>
            <div className="flex flex-wrap items-center gap-2">
              <select className={field} value={kind} onChange={(e) => setKind(e.target.value as ResourceKind)} data-csp-kind>
                {KINDS.map((k) => (
                  <option key={k.kind} value={k.kind}>
                    {k.label}
                  </option>
                ))}
              </select>
              {needsUrl && <input className={cn(field, "w-80 font-mono")} value={resUrl} onChange={(e) => setResUrl(e.target.value)} data-csp-res />}
              <label className="flex items-center gap-1">
                on page
                <input className={cn(field, "w-64 font-mono")} value={page} onChange={(e) => setPage(e.target.value)} data-csp-page />
              </label>
            </div>
            {(kind === "script" || kind === "inline-script" || kind === "style" || kind === "inline-style" || kind === "event-handler") && (
              <div className="flex flex-wrap items-center gap-2">
                <input className={cn(field, "w-40 font-mono")} placeholder="nonce attribute" value={nonce} onChange={(e) => setNonce(e.target.value)} />
                <input className={cn(field, "w-64 font-mono")} placeholder="sha256-… of the inline content" value={hash} onChange={(e) => setHash(e.target.value)} />
                {kind === "script" && (
                  <label className="flex items-center gap-1 text-[11.5px]">
                    <input type="checkbox" checked={trusted} onChange={(e) => setTrusted(e.target.checked)} /> added by a trusted script
                  </label>
                )}
              </div>
            )}
            <div className={cn("font-medium", allowed ? "text-emerald-600" : "text-red-600")} data-csp-verdict={allowed ? "allowed" : "blocked"}>
              {current.policies.every((p) => p.reportOnly) ? (decisions.every((d) => d.allowed) ? "Allowed" : "Would be blocked, but this policy is report-only, so it only reports") : allowed ? "Allowed" : "Blocked"}
            </div>
            {decisions.map((d, i) => (
              <div key={i} className="text-muted-foreground">
                {current.policies.length > 1 && `Policy ${i + 1}: `}
                {d.directive ? `${d.directive}: ` : ""}
                {d.reason}
              </div>
            ))}
          </section>
        </div>
      )}
    </div>
  );
});

export const CSP_ACTIONS = [
  { id: "csp.open", label: "Security: Analyze a Content-Security-Policy (grade, weaknesses, would this load?)", keywords: ["csp", "content security policy", "xss", "security headers", "nonce", "strict-dynamic", "unsafe-inline", "headers"], run: openCsp },
];
