// gear-tls://: connect to a server and show its TLS certificate chain —
// who issued it, what it covers, when it expires, the key, and what a
// browser would object to. Also reads .pem / .crt files.

import { invoke } from "@tauri-apps/api/core";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { toast } from "sonner";
import { app, frontFilePath } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { copyToClipboard, base64ToBytes, toolPaneHandle, toolsNative } from "@/modules/tools/paneHandle";
import { checkChain, daysLeft, derToPem, explainTrustError, fingerprint, parseCertificate, pemToDer, type Certificate, type Finding } from "./model";

export const TLS_PATH = "gear-tls://Certificates";
const KEY = "gear.tls.recent";
let seed: { host?: string; file?: string } | null = null;
let deliver: ((s: { host?: string; file?: string }) => void) | null = null;

function handOver(s: { host?: string; file?: string }) {
  if (deliver) deliver(s);
  else seed = s;
  app().openFile(TLS_PATH);
}

export function openTls(): void {
  // A URL or host under the cursor is taken over.
  const view = getActiveEditor()?.view;
  const sel = view ? view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to).trim() : "";
  if (sel && sel.length < 200 && /^(https?:\/\/|wss?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}/i.test(sel)) handOver({ host: sel });
  else app().openFile(TLS_PATH);
}

export function inspectCertificateFile(): void {
  const f = frontFilePath();
  if (f && /\.(pem|crt|cer|der|cert)$/i.test(f)) handOver({ file: f });
  else toast.info("Open a .pem, .crt, .cer or .der file first.");
}

interface Report {
  address: string;
  protocol: string;
  cipher: string;
  alpn: string | null;
  chain: number[][];
  trusted: boolean;
  trust_error: string | null;
  connect_ms: number;
  handshake_ms: number;
}

const btn = "rounded border border-border/60 px-2 py-0.5 text-[11.5px] hover:bg-muted disabled:opacity-50";
const SEVERITY: Record<Finding["severity"], string> = {
  error: "bg-red-500/10 text-red-600",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  info: "bg-muted/50 text-muted-foreground",
  ok: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
};

function recent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}

function remember(host: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify([host, ...recent().filter((h) => h !== host)].slice(0, 8)));
  } catch {
    // Not remembered, then.
  }
}

const hostOnly = (t: string) => t.trim().replace(/^[a-z]+:\/\//i, "").replace(/[/?#].*$/, "").replace(/^.*@/, "").replace(/^\[([^\]]+)\](:\d+)?$/, "$1").replace(/:\d+$/, "");

function CertCard({ cert, index, total }: { cert: Certificate; index: number; total: number }) {
  const [fp, setFp] = useState("");
  const [open, setOpen] = useState(index === 0);
  useEffect(() => void fingerprint(cert.der).then(setFp), [cert]);
  const left = daysLeft(cert);
  const role = index === 0 ? "Server certificate" : cert.selfSigned ? "Root" : index === total - 1 ? "Intermediate (top of the chain sent)" : "Intermediate";
  const rows: [string, string][] = [
    ["Subject", cert.subject.text],
    ["Issuer", cert.issuer.text],
    ["Valid from", cert.notBefore.toUTCString()],
    ["Valid until", `${cert.notAfter.toUTCString()} (${left < 0 ? `expired ${-left} days ago` : `${left} days left`})`],
    ["Key", `${cert.key.type} ${cert.key.bits ? `${cert.key.bits} bits` : ""}${cert.key.curve ? ` (${cert.key.curve})` : ""}`],
    ["Signature", cert.signatureAlgorithm],
    ["Serial", cert.serial],
    ["SHA-256", fp],
  ];
  if (cert.sans.dns.length || cert.sans.ip.length) rows.push(["Covers", [...cert.sans.dns, ...cert.sans.ip].join(", ")]);
  if (cert.sans.email.length) rows.push(["Email", cert.sans.email.join(", ")]);
  if (cert.isCa) rows.push(["CA", `yes${cert.pathLength !== null ? `, at most ${cert.pathLength} more below it` : ""}`]);
  if (cert.keyUsage.length) rows.push(["Key usage", cert.keyUsage.join(", ")]);
  if (cert.extendedKeyUsage.length) rows.push(["Purpose", cert.extendedKeyUsage.join(", ")]);
  if (cert.policies.length) rows.push(["Policies", cert.policies.join(", ")]);
  if (cert.ocsp.length) rows.push(["OCSP", cert.ocsp.join(", ")]);
  if (cert.caIssuers.length) rows.push(["Issuer certificate", cert.caIssuers.join(", ")]);
  if (cert.crl.length) rows.push(["CRL", cert.crl.join(", ")]);
  if (index === 0 && !cert.selfSigned) rows.push(["Transparency", cert.hasSct ? "timestamps embedded" : "none embedded"]);
  return (
    <div className="rounded border border-border/60" data-tls-cert={index}>
      <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/40" onClick={() => setOpen(!open)}>
        <span className="text-muted-foreground">{open ? "▾" : "▸"}</span>
        <span className="font-medium">{cert.subject.cn ?? cert.subject.org ?? cert.subject.text}</span>
        <span className="text-muted-foreground">{role}</span>
        <span className="flex-1" />
        <span className={cn("tabular-nums", left < 0 ? "text-red-500" : left < 30 ? "text-amber-600" : "text-muted-foreground")}>{left < 0 ? "expired" : `${left} days`}</span>
      </button>
      {open && (
        <div className="border-t border-border/40 px-3 py-2">
          <table className="w-full text-[12px]">
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k} className="align-top">
                  <td className="w-36 py-0.5 pr-3 text-muted-foreground">{k}</td>
                  <td className="break-all py-0.5 font-mono text-[11.5px]">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex gap-1.5">
            <button type="button" className={btn} onClick={() => void copyToClipboard(derToPem(cert.der)).then(() => toast.success("PEM copied"))}>
              Copy PEM
            </button>
            {fp && (
              <button type="button" className={btn} onClick={() => void copyToClipboard(fp).then(() => toast.success("Fingerprint copied"))}>
                Copy fingerprint
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export const TlsPane = forwardRef<EditorPaneHandle, { path: string }>(function TlsPane({ path }, ref) {
  const [target, setTarget] = useState(() => seed?.host ?? "");
  const [sni, setSni] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [chain, setChain] = useState<Certificate[]>([]);
  const [source, setSource] = useState<{ kind: "host"; host: string } | { kind: "file"; file: string } | null>(null);
  const [history, setHistory] = useState(recent);
  const live = useRef(target);
  live.current = target;

  const inspect = async (t: string) => {
    const value = t.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      const r = await invoke<Report>("tls_inspect", { target: value, serverName: sni.trim() || null });
      setReport(r);
      setChain(r.chain.map((c) => parseCertificate(new Uint8Array(c))));
      setSource({ kind: "host", host: hostOnly(value) });
      remember(value);
      setHistory(recent());
    } catch (err) {
      setError(String(err));
      setReport(null);
      setChain([]);
    } finally {
      setBusy(false);
    }
  };

  const readFile = async (file: string) => {
    setError(null);
    try {
      const r = await toolsNative.readBytes(file, 2 * 1024 * 1024);
      const bytes = base64ToBytes(r.data);
      const asText = new TextDecoder().decode(bytes);
      const ders = asText.includes("-----BEGIN") ? pemToDer(asText) : [bytes];
      if (!ders.length) throw new Error("No certificate found in this file (a private key or CSR is not a certificate).");
      setChain(ders.map(parseCertificate));
      setReport(null);
      setSource({ kind: "file", file });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setChain([]);
    }
  };

  useEffect(() => {
    const first = seed;
    seed = null;
    if (first?.host) void inspect(first.host);
    else if (first?.file) void readFile(first.file);
    deliver = (s) => {
      if (s.host) {
        setTarget(s.host);
        void inspect(s.host);
      } else if (s.file) void readFile(s.file);
    };
    return () => {
      deliver = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => toolPaneHandle(path, { getSelection: () => live.current || null }), [path]);

  const findings = chain.length ? checkChain(chain, source?.kind === "host" ? sni.trim() || source.host : null) : [];

  return (
    <div className="flex h-full flex-col overflow-auto text-[12.5px]">
      <form
        className="flex flex-wrap items-center gap-2 border-b border-border/60 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void inspect(target);
        }}
      >
        <input className="w-[320px] rounded border border-border/60 bg-background px-2 py-1 font-mono outline-none focus:border-ring" data-tls-target value={target} placeholder="example.com, host:8443 or https://…" spellCheck={false} onChange={(e) => setTarget(e.target.value)} />
        <input className="w-[200px] rounded border border-border/60 bg-background px-2 py-1 font-mono outline-none focus:border-ring" value={sni} placeholder="Server name (optional, SNI)" title="Ask for the certificate of this name instead of the host — for IP addresses or load balancers" spellCheck={false} onChange={(e) => setSni(e.target.value)} />
        <button type="submit" className={btn} data-tls-go disabled={busy || !target.trim()}>
          {busy ? "Connecting…" : "Check certificate"}
        </button>
        <span className="flex-1" />
        {history.slice(0, 5).map((h) => (
          <button key={h} type="button" className="text-[11.5px] text-muted-foreground hover:text-foreground hover:underline" onClick={() => (setTarget(h), void inspect(h))}>
            {h}
          </button>
        ))}
      </form>
      <div className="space-y-3 p-3">
        {error && <div className="rounded bg-red-500/10 px-2 py-1 text-red-600" data-tls-error>{error}</div>}
        {!error && !chain.length && !busy && <div className="text-muted-foreground">Enter a host to see the certificate it presents. Nothing is sent after the TLS handshake. To read a certificate file, open it and run “Certificates: Inspect this certificate file”.</div>}
        {report && (
          <div className="flex flex-wrap gap-x-5 gap-y-1" data-tls-summary>
            <span className={cn("font-medium", report.trusted ? "text-emerald-600" : "text-red-500")} data-tls-trusted={report.trusted}>
              {report.trusted ? "✓ Trusted by browsers" : `✗ ${explainTrustError(report.trust_error ?? "Not trusted")}`}
            </span>
            <span className="text-muted-foreground">{report.address}</span>
            <span>{report.protocol}</span>
            <span className="font-mono text-[11.5px] text-muted-foreground">{report.cipher}</span>
            {report.alpn && <span className="text-muted-foreground">ALPN {report.alpn}</span>}
            <span className="text-muted-foreground">
              connect {Math.round(report.connect_ms)} ms · handshake {Math.round(report.handshake_ms)} ms
            </span>
          </div>
        )}
        {source?.kind === "file" && <div className="text-muted-foreground">From {source.file}</div>}
        {findings.length > 0 && (
          <div className="space-y-1" data-tls-findings>
            {findings.map((f, i) => (
              <div key={i} className={cn("rounded px-2 py-1", SEVERITY[f.severity])} data-severity={f.severity}>
                {f.message}
              </div>
            ))}
          </div>
        )}
        {chain.map((c, i) => (
          <CertCard key={`${source?.kind}-${i}-${c.serial}`} cert={c} index={i} total={chain.length} />
        ))}
        {chain.length > 0 && (
          <button type="button" className={btn} onClick={() => void copyToClipboard(chain.map((c) => derToPem(c.der)).join("")).then(() => toast.success("Chain copied as PEM"))}>
            Copy the whole chain as PEM
          </button>
        )}
      </div>
    </div>
  );
});

export const TLS_ACTIONS = [
  { id: "tls.open", label: "Certificates: Check a server's TLS certificate…", keywords: ["tls", "ssl", "https", "certificate", "cert", "expiry", "chain", "x509", "san", "letsencrypt"], run: openTls },
  { id: "tls.file", label: "Certificates: Inspect this certificate file (.pem / .crt)", keywords: ["certificate", "pem", "crt", "cer", "der", "x509", "decode"], run: inspectCertificateFile },
];
