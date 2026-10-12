// gear-loadtest://: fire N requests at a local server, a fixed number at a
// time, and see throughput, percentiles, a latency histogram and a timeline.

import { forwardRef, useImperativeHandle, useMemo } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import { app } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { benchNative, formatBytes, toolPaneHandle, type BenchSample } from "@/modules/tools/paneHandle";
import { formatMs, histogram, parseHeaders, report, settingsProblem, summarize, timeline, type Settings } from "./model";

export const LOADTEST_PATH = "gear-loadtest://Load test";
const KEY = "gear.loadtest";

interface State extends Settings {
  headers: string;
  body: string;
  running: boolean;
  error: string | null;
  samples: BenchSample[];
  elapsedMs: number;
  cancelled: boolean;
  /** The settings the shown results were produced with. */
  ran: Settings | null;
}

function initial(): State {
  const base: State = { url: "http://localhost:3000/", method: "GET", total: 200, concurrency: 10, timeoutMs: 10000, headers: "", body: "", running: false, error: null, samples: [], elapsedMs: 0, cancelled: false, ran: null };
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<State> | null;
    if (v && typeof v.url === "string") return { ...base, url: v.url, method: String(v.method ?? "GET"), total: Number(v.total) || 200, concurrency: Number(v.concurrency) || 10, timeoutMs: Number(v.timeoutMs) || 10000, headers: String(v.headers ?? ""), body: String(v.body ?? "") };
  } catch {
    // Defaults.
  }
  return base;
}

export const useLoadTest = create<State>(initial);

function set(patch: Partial<State>): void {
  useLoadTest.setState(patch);
  const { url, method, total, concurrency, timeoutMs, headers, body } = useLoadTest.getState();
  try {
    localStorage.setItem(KEY, JSON.stringify({ url, method, total, concurrency, timeoutMs, headers, body }));
  } catch {
    // Settings then last for this session only.
  }
}

export async function runLoadTest(): Promise<void> {
  const s = useLoadTest.getState();
  if (s.running) return;
  const settings: Settings = { url: s.url.trim(), method: s.method, total: s.total, concurrency: s.concurrency, timeoutMs: s.timeoutMs };
  const problem = settingsProblem(settings);
  if (problem) return void useLoadTest.setState({ error: problem });
  useLoadTest.setState({ running: true, error: null });
  try {
    const r = await benchNative.run({ ...settings, headers: parseHeaders(s.headers), body: s.body && s.method !== "GET" && s.method !== "HEAD" ? s.body : null });
    useLoadTest.setState({ running: false, samples: r.samples, elapsedMs: r.elapsed_ms, cancelled: r.cancelled, ran: settings });
  } catch (err) {
    useLoadTest.setState({ running: false, error: String(err) });
  }
}

export function openLoadTest(): void {
  app().openFile(LOADTEST_PATH);
}

const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";
const field = "rounded border border-border/60 bg-background px-1.5 py-0.5 font-mono text-[12px] outline-none focus:border-ring";

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className={cn("text-[19px] font-semibold tabular-nums", tone)} data-stat={label}>
        {value}
      </div>
      <div className="text-muted-foreground">{label}</div>
    </div>
  );
}

export const LoadTestPane = forwardRef<EditorPaneHandle, { path: string }>(function LoadTestPane({ path }, ref) {
  const s = useLoadTest();
  useImperativeHandle(ref, () => toolPaneHandle(path, { reload: () => (void runLoadTest(), true) }), [path]);

  const sum = useMemo(() => summarize(s.samples, s.elapsedMs), [s.samples, s.elapsedMs]);
  const hist = useMemo(() => histogram(s.samples), [s.samples]);
  const line = useMemo(() => timeline(s.samples), [s.samples]);
  const histMax = Math.max(1, ...hist.map((b) => b.count));
  const lineMax = Math.max(1, ...line.map((b) => b.count));
  const num = (v: string) => Number(v.replace(/[^\d]/g, "")) || 0;

  return (
    <div className="flex h-full flex-col overflow-auto text-[12.5px]">
      <div className="space-y-1.5 border-b border-border/60 p-2">
        <div className="flex items-center gap-1.5">
          <select className={field} value={s.method} onChange={(e) => set({ method: e.target.value })}>
            {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <input className={cn(field, "min-w-0 flex-1")} data-loadtest-url value={s.url} spellCheck={false} placeholder="http://localhost:3000/health" onChange={(e) => set({ url: e.target.value })} onKeyDown={(e) => e.key === "Enter" && void runLoadTest()} />
          {s.running ? (
            <button type="button" className={btn} onClick={() => void benchNative.cancel()}>
              Stop
            </button>
          ) : (
            <button type="button" className={cn(btn, "bg-primary/10")} onClick={() => void runLoadTest()}>
              Run
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground">Requests</span>
          <input className={cn(field, "w-[68px]")} data-loadtest-total value={String(s.total)} onChange={(e) => set({ total: num(e.target.value) })} />
          <span className="text-muted-foreground">at a time</span>
          <input className={cn(field, "w-[48px]")} data-loadtest-concurrency value={String(s.concurrency)} onChange={(e) => set({ concurrency: num(e.target.value) })} />
          <span className="text-muted-foreground">timeout (ms)</span>
          <input className={cn(field, "w-[68px]")} value={String(s.timeoutMs)} onChange={(e) => set({ timeoutMs: num(e.target.value) })} />
          <span className="flex-1" />
          <span className="text-muted-foreground">Only servers on this machine or a private network can be tested.</span>
        </div>
        <div className="flex gap-1.5">
          <textarea className={cn(field, "h-[42px] min-w-0 flex-1 resize-y")} spellCheck={false} value={s.headers} placeholder="Headers, one per line — Authorization: Bearer …" onChange={(e) => set({ headers: e.target.value })} />
          {s.method !== "GET" && s.method !== "HEAD" && <textarea className={cn(field, "h-[42px] min-w-0 flex-1 resize-y")} spellCheck={false} value={s.body} placeholder="Request body" onChange={(e) => set({ body: e.target.value })} />}
        </div>
      </div>
      {s.error && (
        <div className="border-b border-border/60 bg-red-500/10 px-3 py-1.5 text-red-500" data-loadtest-error>
          {s.error}
        </div>
      )}
      {s.running ? (
        <div className="p-6 text-muted-foreground">
          Sending {s.total.toLocaleString()} requests, {s.concurrency} at a time…
        </div>
      ) : !s.ran ? (
        <div className="max-w-[640px] p-6 text-muted-foreground">Start your server, enter its address and press Run. Each request is timed from sending it to receiving the last byte of the answer.</div>
      ) : (
        <div className="space-y-3 p-3">
          {s.cancelled && <div className="rounded bg-amber-500/10 px-2 py-1 text-amber-600">Stopped early — the numbers cover the {sum.requests.toLocaleString()} requests that finished.</div>}
          <div className="flex flex-wrap gap-6">
            <Stat label="requests per second" value={sum.rps.toFixed(1)} />
            <Stat label="median (p50)" value={formatMs(sum.p50)} />
            <Stat label="p95" value={formatMs(sum.p95)} />
            <Stat label="p99" value={formatMs(sum.p99)} />
            <Stat label="slowest" value={formatMs(sum.max)} />
            <Stat label="failed" value={`${sum.failed} of ${sum.requests}`} tone={sum.failed ? "text-red-500" : "text-emerald-600"} />
            <Stat label="received" value={formatBytes(sum.bytes)} />
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="min-w-[320px] flex-1 rounded-md border border-border/60 p-2">
              <div className="mb-1 font-medium">Latency</div>
              <div className="flex h-[110px] items-end gap-px" data-loadtest-histogram>
                {hist.map((b, i) => (
                  <div key={i} className="min-w-0 flex-1 rounded-t bg-primary/60" style={{ height: `${(b.count / histMax) * 100}%`, minHeight: b.count ? 2 : 0 }} title={`${formatMs(b.from)} – ${formatMs(b.to)}: ${b.count}`} />
                ))}
              </div>
              <div className="mt-0.5 flex justify-between text-[10.5px] text-muted-foreground">
                <span>{formatMs(sum.min)}</span>
                <span>mean {formatMs(sum.mean)} · ± {formatMs(sum.stdev)}</span>
                <span>{formatMs(sum.max)}</span>
              </div>
            </div>
            <div className="min-w-[320px] flex-1 rounded-md border border-border/60 p-2">
              <div className="mb-1 font-medium">Completed per second</div>
              <div className="flex h-[110px] items-end gap-px">
                {line.map((b) => (
                  <div key={b.second} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`second ${b.second + 1}: ${b.count} done, ${b.failed} failed, mean ${formatMs(b.mean)}`}>
                    {b.failed > 0 && <div className="bg-red-500/80" style={{ height: `${(b.failed / lineMax) * 100}%`, minHeight: 2 }} />}
                    <div className="rounded-t bg-emerald-500/60" style={{ height: `${((b.count - b.failed) / lineMax) * 100}%`, minHeight: b.count - b.failed ? 2 : 0 }} />
                  </div>
                ))}
              </div>
              <div className="mt-0.5 flex justify-between text-[10.5px] text-muted-foreground">
                <span>0 s</span>
                <span>{(s.elapsedMs / 1000).toFixed(2)} s</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="min-w-[220px] rounded-md border border-border/60">
              <div className="border-b border-border/60 px-2 py-1 font-medium">Status codes</div>
              {sum.statuses.map(([code, n]) => (
                <div key={code} className="flex justify-between gap-6 px-2 py-0.5" data-status={code}>
                  <span className={cn("font-mono", code === 0 || code >= 500 ? "text-red-500" : code >= 400 ? "text-amber-600" : "")}>{code || "no response"}</span>
                  <span className="tabular-nums">{n.toLocaleString()}</span>
                </div>
              ))}
            </div>
            {sum.errors.length > 0 && (
              <div className="min-w-[260px] flex-1 rounded-md border border-border/60">
                <div className="border-b border-border/60 px-2 py-1 font-medium">Errors</div>
                {sum.errors.slice(0, 8).map(([e, n]) => (
                  <div key={e} className="flex justify-between gap-6 px-2 py-0.5">
                    <span className="min-w-0 truncate text-red-500" title={e}>
                      {e}
                    </span>
                    <span className="tabular-nums">{n.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button type="button" className={btn} onClick={() => s.ran && void navigator.clipboard.writeText(report(sum, s.ran, s.elapsedMs)).then(() => toast.success("Report copied"))}>
            Copy report
          </button>
        </div>
      )}
    </div>
  );
});
