// Kubernetes explorer model: kubeconfig contexts, the resource kinds the view
// lists, row summaries matching `kubectl get` (pod STATUS, READY, RESTARTS,
// AGE), events, and kubectl argument builders.

export interface KubeContext {
  name: string;
  cluster: string;
  user: string;
  namespace: string | null;
}

export function parseConfigView(json: string): { contexts: KubeContext[]; current: string | null } {
  const c = JSON.parse(json) as { contexts?: { name: string; context: { cluster: string; user: string; namespace?: string } }[]; "current-context"?: string };
  return {
    contexts: (c.contexts ?? []).map((x) => ({ name: x.name, cluster: x.context.cluster, user: x.context.user, namespace: x.context.namespace ?? null })),
    current: c["current-context"] || null,
  };
}

export interface KindInfo {
  id: string;
  label: string;
  namespaced: boolean;
  scalable?: boolean;
  restartable?: boolean;
}

export const KINDS: KindInfo[] = [
  { id: "pods", label: "Pods", namespaced: true },
  { id: "deployments", label: "Deployments", namespaced: true, scalable: true, restartable: true },
  { id: "statefulsets", label: "StatefulSets", namespaced: true, scalable: true, restartable: true },
  { id: "daemonsets", label: "DaemonSets", namespaced: true, restartable: true },
  { id: "jobs", label: "Jobs", namespaced: true },
  { id: "cronjobs", label: "CronJobs", namespaced: true },
  { id: "services", label: "Services", namespaced: true },
  { id: "ingresses", label: "Ingresses", namespaced: true },
  { id: "configmaps", label: "ConfigMaps", namespaced: true },
  { id: "secrets", label: "Secrets", namespaced: true },
  { id: "persistentvolumeclaims", label: "PVCs", namespaced: true },
  { id: "events", label: "Events", namespaced: true },
  { id: "nodes", label: "Nodes", namespaced: false },
  { id: "namespaces", label: "Namespaces", namespaced: false },
];

/** "5s", "12m", "3h", "4d", "2y" like kubectl. */
export function age(ts: string | undefined, now = Date.now()): string {
  if (!ts) return "";
  const s = Math.max(0, Math.floor((now - Date.parse(ts)) / 1000));
  if (s < 120) return `${s}s`;
  if (s < 7200) return `${Math.floor(s / 60)}m`;
  if (s < 172800) return `${Math.floor(s / 3600)}h`;
  if (s < 365 * 86400) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / (365 * 86400))}y`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Obj = any;

/** The STATUS column of `kubectl get pods`. */
export function podStatus(p: Obj): string {
  if (p.metadata?.deletionTimestamp) return "Terminating";
  let reason: string = p.status?.reason ?? p.status?.phase ?? "Unknown";
  const init: Obj[] = p.status?.initContainerStatuses ?? [];
  for (let i = 0; i < init.length; i++) {
    const s = init[i].state ?? {};
    if (s.terminated?.exitCode === 0) continue;
    if (s.terminated) return s.terminated.reason ? `Init:${s.terminated.reason}` : `Init:ExitCode:${s.terminated.exitCode}`;
    if (s.waiting?.reason && s.waiting.reason !== "PodInitializing") return `Init:${s.waiting.reason}`;
    return `Init:${i}/${init.length}`;
  }
  for (const c of [...(p.status?.containerStatuses ?? [])].reverse()) {
    const s = c.state ?? {};
    if (s.waiting?.reason) reason = s.waiting.reason;
    else if (s.terminated?.reason) reason = s.terminated.reason;
    else if (s.terminated) reason = s.terminated.signal ? `Signal:${s.terminated.signal}` : `ExitCode:${s.terminated.exitCode}`;
  }
  return reason;
}

export type Health = "ok" | "warn" | "error" | "idle";

export interface Row {
  name: string;
  namespace: string | null;
  status: string;
  health: Health;
  ready: string;
  restarts: number | null;
  age: string;
  detail: string;
  containers: string[];
  ports: number[];
  raw: Obj;
}

function healthOf(status: string): Health {
  if (/^(Running|Active|Bound|Ready|Complete|Completed|Succeeded|Normal)$/.test(status)) return /^(Completed|Succeeded|Complete)$/.test(status) ? "idle" : "ok";
  if (/^(Pending|ContainerCreating|PodInitializing|Terminating|Progressing|Init:\d+\/\d+|Warning|Suspended)$/.test(status)) return "warn";
  return "error";
}

const ns = (o: Obj) => o.metadata?.namespace ?? null;

export function summarize(kind: string, o: Obj, now = Date.now()): Row {
  const base = { name: o.metadata?.name ?? "", namespace: ns(o), age: age(o.metadata?.creationTimestamp, now), containers: [] as string[], ports: [] as number[], raw: o, restarts: null as number | null };
  switch (kind) {
    case "pods": {
      const cs: Obj[] = o.status?.containerStatuses ?? [];
      const specC: Obj[] = o.spec?.containers ?? [];
      const status = podStatus(o);
      return {
        ...base,
        status,
        health: healthOf(status),
        ready: `${cs.filter((c) => c.ready).length}/${specC.length}`,
        restarts: cs.reduce((n, c) => n + (c.restartCount ?? 0), 0),
        detail: [o.spec?.nodeName, o.status?.podIP].filter(Boolean).join(" · "),
        containers: specC.map((c) => c.name),
        ports: specC.flatMap((c) => (c.ports ?? []).map((p: Obj) => p.containerPort)),
      };
    }
    case "deployments":
    case "statefulsets": {
      const want = o.spec?.replicas ?? 1;
      const ready = o.status?.readyReplicas ?? 0;
      const status = want === 0 ? "Scaled to 0" : ready >= want ? "Ready" : "Progressing";
      return { ...base, status, health: want === 0 ? "idle" : ready >= want ? "ok" : "warn", ready: `${ready}/${want}`, detail: (o.spec?.template?.spec?.containers ?? []).map((c: Obj) => c.image).join(", "), containers: [] };
    }
    case "daemonsets": {
      const want = o.status?.desiredNumberScheduled ?? 0;
      const ready = o.status?.numberReady ?? 0;
      return { ...base, status: ready >= want ? "Ready" : "Progressing", health: ready >= want ? "ok" : "warn", ready: `${ready}/${want}`, detail: (o.spec?.template?.spec?.containers ?? []).map((c: Obj) => c.image).join(", ") };
    }
    case "jobs": {
      const done = o.status?.succeeded ?? 0;
      const want = o.spec?.completions ?? 1;
      const failed = (o.status?.conditions ?? []).some((c: Obj) => c.type === "Failed" && c.status === "True");
      const status = failed ? "Failed" : done >= want ? "Complete" : o.spec?.suspend ? "Suspended" : "Running";
      return { ...base, status, health: failed ? "error" : done >= want ? "idle" : "warn", ready: `${done}/${want}`, detail: "" };
    }
    case "cronjobs":
      return { ...base, status: o.spec?.suspend ? "Suspended" : "Active", health: o.spec?.suspend ? "warn" : "ok", ready: "", detail: `${o.spec?.schedule ?? ""}${o.status?.lastScheduleTime ? ` · last ${age(o.status.lastScheduleTime, now)} ago` : ""}` };
    case "services": {
      const ports: Obj[] = o.spec?.ports ?? [];
      return {
        ...base,
        status: o.spec?.type ?? "ClusterIP",
        health: "ok",
        ready: "",
        detail: [o.spec?.clusterIP, ports.map((p) => `${p.port}${p.nodePort ? `:${p.nodePort}` : ""}/${p.protocol ?? "TCP"}`).join(",")].filter(Boolean).join(" · "),
        ports: ports.map((p) => p.port),
      };
    }
    case "ingresses":
      return { ...base, status: "Ingress", health: "ok", ready: "", detail: (o.spec?.rules ?? []).map((r: Obj) => r.host ?? "*").join(", ") };
    case "configmaps":
      return { ...base, status: "", health: "ok", ready: "", detail: `${Object.keys(o.data ?? {}).length + Object.keys(o.binaryData ?? {}).length} keys` };
    case "secrets":
      return { ...base, status: o.type ?? "Opaque", health: "ok", ready: "", detail: `${Object.keys(o.data ?? {}).length} keys` };
    case "persistentvolumeclaims":
      return { ...base, status: o.status?.phase ?? "Pending", health: healthOf(o.status?.phase ?? "Pending"), ready: "", detail: [o.status?.capacity?.storage ?? o.spec?.resources?.requests?.storage, o.spec?.storageClassName].filter(Boolean).join(" · ") };
    case "events": {
      const type: string = o.type ?? "Normal";
      return { ...base, name: `${o.involvedObject?.kind ?? ""}/${o.involvedObject?.name ?? ""}`, status: o.reason ?? type, health: type === "Warning" ? "error" : "ok", ready: o.count > 1 ? `×${o.count}` : "", age: age(o.lastTimestamp ?? o.eventTime ?? o.metadata?.creationTimestamp, now), detail: o.message ?? "" };
    }
    case "nodes": {
      const ready = (o.status?.conditions ?? []).find((c: Obj) => c.type === "Ready");
      const status = ready?.status === "True" ? "Ready" : "NotReady";
      return { ...base, status: o.spec?.unschedulable ? `${status},SchedulingDisabled` : status, health: status === "Ready" ? "ok" : "error", ready: "", detail: [o.status?.nodeInfo?.kubeletVersion, o.status?.nodeInfo?.osImage].filter(Boolean).join(" · ") };
    }
    case "namespaces":
      return { ...base, status: o.status?.phase ?? "Active", health: healthOf(o.status?.phase ?? "Active"), ready: "", detail: "" };
    default:
      return { ...base, status: "", health: "ok", ready: "", detail: "" };
  }
}

/** Rows from `kubectl get <kind> -o json`; events newest first, others by name. */
export function parseList(kind: string, json: string, now = Date.now()): Row[] {
  const items: Obj[] = (JSON.parse(json) as { items?: Obj[] }).items ?? [];
  const rows = items.map((o) => summarize(kind, o, now));
  if (kind === "events") {
    const t = (r: Row) => Date.parse(r.raw.lastTimestamp ?? r.raw.eventTime ?? r.raw.metadata?.creationTimestamp ?? 0) || 0;
    return rows.sort((a, b) => t(b) - t(a));
  }
  return rows.sort((a, b) => (a.namespace ?? "").localeCompare(b.namespace ?? "") || a.name.localeCompare(b.name));
}

// ── kubectl arguments ─────────────────────────────────────────────────────

export interface Scope {
  context: string | null;
  /** null = all namespaces */
  namespace: string | null;
}

export function kubectl(scope: Scope, args: string[], opts: { namespaced?: boolean } = {}): string[] {
  const out = ["kubectl"];
  if (scope.context) out.push("--context", scope.context);
  if (opts.namespaced !== false) out.push(...(scope.namespace ? ["-n", scope.namespace] : []));
  return [...out, ...args];
}

export function listArgv(scope: Scope, kind: KindInfo): string[] {
  return kubectl(scope, ["get", kind.id, "-o", "json", ...(kind.namespaced && !scope.namespace ? ["--all-namespaces"] : [])], { namespaced: kind.namespaced });
}

/** Scope pinned to a row's own namespace (rows from "all namespaces" carry theirs). */
export function rowScope(scope: Scope, row: Row): Scope {
  return { context: scope.context, namespace: row.namespace ?? scope.namespace };
}

export function logsArgv(scope: Scope, pod: string, container: string | null, opts: { previous?: boolean; tail?: number } = {}): string[] {
  return kubectl(scope, ["logs", pod, ...(container ? ["-c", container] : []), "--timestamps", `--tail=${opts.tail ?? 1000}`, ...(opts.previous ? ["--previous"] : ["-f"])]);
}

export function execArgv(scope: Scope, pod: string, container: string | null): string[] {
  return kubectl(scope, ["exec", "-it", pod, ...(container ? ["-c", container] : []), "--", "/bin/sh", "-c", "if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi"]);
}

export function portForwardArgv(scope: Scope, target: string, local: number, remote: number): string[] {
  return kubectl(scope, ["port-forward", target, `${local}:${remote}`, "--address", "127.0.0.1"]);
}

/** Decode a Secret's data for viewing. */
export function decodeSecret(o: Obj): [string, string][] {
  return Object.entries((o.data ?? {}) as Record<string, string>).map(([k, v]) => {
    try {
      const bin = atob(v);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return [k, new TextDecoder("utf-8", { fatal: true }).decode(bytes)];
    } catch {
      return [k, `(binary, ${v.length} base64 chars)`];
    }
  });
}

/** Path of a resource's YAML mirror (edit, save → kubectl replace). */
export function yamlMirrorName(scope: Scope, kind: string, row: { name: string; namespace: string | null }): string {
  const safe = (s: string) => s.replace(/[^\w.-]/g, "_");
  return `${safe(scope.context ?? "current")}/${safe(row.namespace ?? "_cluster")}/${safe(kind)}-${safe(row.name)}.yaml`;
}
