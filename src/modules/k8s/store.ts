// Kubernetes explorer state and actions, all through the user's kubectl:
// contexts / namespaces, resource lists, logs, shells, describe, YAML edit
// (saved with `kubectl replace`, so a concurrent change is a conflict, not an
// overwrite), scale, rollout restart, delete, port-forwards, apply / diff.

import { appCacheDir } from "@tauri-apps/api/path";
import { toast } from "sonner";
import { create } from "zustand";
import { app } from "@/app/appBridge";
import { IS_WINDOWS } from "@/lib/platform";
import { native } from "@/modules/ai/lib/native";
import { commandLine } from "@/modules/containers/model";
import { confirmPick, inputBox, quickPick } from "@/modules/quick-pick";
import { execArgv, KINDS, kubectl, listArgv, parseConfigView, parseList, portForwardArgv, rowScope, yamlMirrorName, type KindInfo, type KubeContext, type Row, type Scope } from "./model";

export interface PortForward {
  key: string;
  label: string;
  local: number;
  handle: number;
  status: "starting" | "up" | "failed";
  error?: string;
}

interface K8sStore {
  available: boolean | null;
  error: string | null;
  contexts: KubeContext[];
  context: string | null;
  namespace: string | null;
  namespaces: string[];
  kind: string;
  rows: Row[];
  loading: boolean;
  listError: string | null;
  forwards: PortForward[];
  /** local YAML mirror → what it edits */
  mirrors: Record<string, { scope: Scope; kind: string; name: string }>;
}

const PREF = "gear-k8s-scope";
const pref = (() => {
  try {
    return JSON.parse(localStorage.getItem(PREF) ?? "{}") as { context?: string; namespace?: string | null; kind?: string };
  } catch {
    return {};
  }
})();

export const useK8sStore = create<K8sStore>(() => ({ available: null, error: null, contexts: [], context: pref.context ?? null, namespace: pref.namespace === undefined ? "default" : pref.namespace, namespaces: [], kind: pref.kind ?? "pods", rows: [], loading: false, listError: null, forwards: [], mirrors: {} }));

function persist(): void {
  const { context, namespace, kind } = useK8sStore.getState();
  try {
    localStorage.setItem(PREF, JSON.stringify({ context, namespace, kind }));
  } catch {
    /* ignore */
  }
}

export const scope = (): Scope => ({ context: useK8sStore.getState().context, namespace: useK8sStore.getState().namespace });
const line = (argv: string[]) => commandLine(argv, IS_WINDOWS);
export const kindInfo = (id: string): KindInfo => KINDS.find((k) => k.id === id) ?? KINDS[0];

export async function kc(argv: string[], timeoutSecs = 30): Promise<string> {
  const r = await native.runCommand(line(argv), null, timeoutSecs);
  if (r.timed_out) throw new Error("kubectl timed out");
  if (r.exit_code !== 0) throw new Error((r.stderr || r.stdout || `kubectl exited with ${r.exit_code}`).trim());
  return r.stdout;
}

export async function init(): Promise<void> {
  try {
    const { contexts, current } = parseConfigView(await kc(["kubectl", "config", "view", "-o", "json"], 15));
    const st = useK8sStore.getState();
    const context = st.context && contexts.some((c) => c.name === st.context) ? st.context : current;
    useK8sStore.setState({ available: true, error: null, contexts, context });
    if (!contexts.length) return void useK8sStore.setState({ error: "No contexts in your kubeconfig" });
    await Promise.all([loadNamespaces(), refresh()]);
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    useK8sStore.setState({ available: false, error: /not (found|recognized)|No such file/i.test(msg) ? "kubectl isn't installed or isn't on PATH" : msg });
  }
}

export async function loadNamespaces(): Promise<void> {
  try {
    const rows = parseList("namespaces", await kc(kubectl(scope(), ["get", "namespaces", "-o", "json"], { namespaced: false })));
    useK8sStore.setState({ namespaces: rows.map((r) => r.name) });
  } catch {
    useK8sStore.setState({ namespaces: [] });
  }
}

let seq = 0;
export async function refresh(): Promise<void> {
  const { kind } = useK8sStore.getState();
  const my = ++seq;
  useK8sStore.setState({ loading: true });
  try {
    const rows = parseList(kind, await kc(listArgv(scope(), kindInfo(kind)), 40));
    if (my === seq) useK8sStore.setState({ rows, loading: false, listError: null });
  } catch (e) {
    if (my === seq) useK8sStore.setState({ rows: [], loading: false, listError: String((e as Error).message ?? e) });
  }
}

export function setScope(patch: Partial<Pick<K8sStore, "context" | "namespace" | "kind">>): void {
  useK8sStore.setState({ ...patch, rows: patch.kind !== undefined || patch.context !== undefined || patch.namespace !== undefined ? [] : useK8sStore.getState().rows });
  persist();
  if (patch.context !== undefined) void loadNamespaces();
  void refresh();
}

// ── actions on a row ──────────────────────────────────────────────────────

export const k8sLogsPath = (s: Scope, pod: string, container: string | null) => `gear-k8s://logs/${encodeURIComponent(s.context ?? "")}/${encodeURIComponent(s.namespace ?? "")}/${encodeURIComponent(pod)}/${encodeURIComponent(container ?? "")}`;
export const k8sDescribePath = (s: Scope, kind: string, name: string) => `gear-k8s://describe/${encodeURIComponent(s.context ?? "")}/${encodeURIComponent(s.namespace ?? "")}/${encodeURIComponent(kind)}/${encodeURIComponent(name)}`;

export function parseK8sPath(p: string): { view: "logs" | "describe"; scope: Scope; a: string; b: string } | null {
  const m = /^gear-k8s:\/\/(logs|describe)\/([^/]*)\/([^/]*)\/([^/]*)\/([^/]*)$/.exec(p);
  if (!m) return null;
  const d = decodeURIComponent;
  return { view: m[1] as "logs" | "describe", scope: { context: d(m[2]) || null, namespace: d(m[3]) || null }, a: d(m[4]), b: d(m[5]) };
}

async function pickContainer(row: Row, title: string): Promise<string | null | undefined> {
  if (row.containers.length <= 1) return row.containers[0] ?? null;
  return quickPick(row.containers.map((c) => ({ label: c, value: c })), { title });
}

export async function openLogs(row: Row): Promise<void> {
  const c = await pickContainer(row, `Logs of ${row.name}`);
  if (c === undefined) return;
  app().openFile(k8sLogsPath(rowScope(scope(), row), row.name, c));
}

export async function openShell(row: Row, s: Scope = rowScope(scope(), row)): Promise<void> {
  const c = await pickContainer(row, `Shell in ${row.name}`);
  if (c === undefined) return;
  app().openTerminal({ command: line(execArgv(s, row.name, c)) });
}

export function describe(kind: string, row: Row): void {
  app().openFile(k8sDescribePath(rowScope(scope(), row), kind, row.name));
}

/** Open the resource as YAML; saving the file runs `kubectl replace`. */
export async function editYaml(kind: string, row: Row): Promise<void> {
  const s = rowScope(scope(), row);
  try {
    const yaml = await kc(kubectl(s, ["get", kind, row.name, "-o", "yaml"], { namespaced: kindInfo(kind).namespaced }));
    const path = `${(await appCacheDir()).replace(/\\/g, "/").replace(/\/+$/, "")}/k8s/${yamlMirrorName(s, kind, row)}`;
    await native.createDir(path.slice(0, path.lastIndexOf("/"))).catch(() => {});
    await native.writeFile(path, `# Saving this file applies it with kubectl replace (${s.context ?? "current context"}).\n${yaml}`, "user");
    useK8sStore.setState((st) => ({ mirrors: { ...st.mirrors, [path]: { scope: s, kind, name: row.name } } }));
    app().openFile(path);
  } catch (e) {
    toast.error("Couldn't load the YAML", { description: String((e as Error).message ?? e) });
  }
}

export async function replaceMirror(path: string): Promise<void> {
  const m = useK8sStore.getState().mirrors[path];
  if (!m) return;
  try {
    const out = await kc(kubectl(m.scope, ["replace", "-f", path], { namespaced: false }), 60);
    toast.success(out.trim() || `${m.kind}/${m.name} replaced`);
    void refresh();
    // Reload so the next save carries the new resourceVersion.
    const fresh = await kc(kubectl(m.scope, ["get", m.kind, m.name, "-o", "yaml"], { namespaced: kindInfo(m.kind).namespaced }));
    await native.writeFile(path, `# Saving this file applies it with kubectl replace (${m.scope.context ?? "current context"}).\n${fresh}`, "user");
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    toast.error(/has been modified/.test(msg) ? `${m.name} changed in the cluster since you opened it` : "kubectl replace failed", {
      description: /has been modified/.test(msg) ? "Reopen it to get the latest version, then reapply your change." : msg,
      action: /has been modified/.test(msg) ? { label: "Reopen", onClick: () => void editYaml(m.kind, { name: m.name, namespace: m.scope.namespace } as Row) } : undefined,
    });
  }
}

export function installSaveHook(): () => void {
  const onSave = (e: Event) => {
    const p = (e as CustomEvent<{ path: string }>).detail.path.replace(/\\/g, "/");
    if (useK8sStore.getState().mirrors[p]) void replaceMirror(p);
  };
  window.addEventListener("gear:file-saved", onSave);
  return () => window.removeEventListener("gear:file-saved", onSave);
}

export async function scale(kind: string, row: Row): Promise<void> {
  const current = row.ready.split("/")[1] ?? "1";
  const v = await inputBox({ title: `Scale ${kind}/${row.name}`, value: current, placeholder: "replicas" });
  if (v === undefined || !/^\d+$/.test(v.trim())) return;
  await run(kubectl(rowScope(scope(), row), ["scale", `${kind}/${row.name}`, `--replicas=${v.trim()}`]), `Scaled ${row.name} to ${v.trim()}`);
}

export async function restart(kind: string, row: Row): Promise<void> {
  await run(kubectl(rowScope(scope(), row), ["rollout", "restart", `${kind}/${row.name}`]), `Restarting ${row.name}`);
}

export async function remove(kind: string, row: Row): Promise<void> {
  if (!(await confirmPick(`Delete ${kind}/${row.name}${row.namespace ? ` in ${row.namespace}` : ""}?`, "Delete", useK8sStore.getState().context ?? undefined))) return;
  await run(kubectl(rowScope(scope(), row), ["delete", kind, row.name, "--wait=false"], { namespaced: kindInfo(kind).namespaced }), `Deleted ${row.name}`);
}

export async function triggerCronJob(row: Row): Promise<void> {
  await run(kubectl(rowScope(scope(), row), ["create", "job", `${row.name}-manual-${Date.now().toString(36)}`, `--from=cronjob/${row.name}`]), `Started a job from ${row.name}`);
}

async function run(argv: string[], ok: string): Promise<void> {
  try {
    await kc(argv, 60);
    toast.success(ok);
  } catch (e) {
    toast.error("kubectl failed", { description: String((e as Error).message ?? e) });
  }
  await refresh();
}

export async function portForward(kind: string, row: Row): Promise<void> {
  const ports = row.ports.length ? row.ports : [];
  const remote = ports.length === 1 ? ports[0] : await quickPick([...ports.map((p) => ({ label: String(p), value: p })), { label: "Another port…", value: -1 }], { title: `Forward a port of ${row.name}` }).then(async (p) => (p === -1 ? Number(await inputBox({ title: "Remote port" })) : p));
  if (!remote) return;
  const local = Number((await inputBox({ title: `Local port for ${row.name}:${remote}`, value: String(remote < 1024 ? remote + 8000 : remote) })) ?? 0);
  if (!local) return;
  const target = `${kind === "pods" ? "pod" : kind === "services" ? "svc" : kind.replace(/s$/, "")}/${row.name}`;
  const key = `${useK8sStore.getState().context}:${row.namespace}:${target}:${local}`;
  const handle = await native.shellBgSpawn(line(portForwardArgv(rowScope(scope(), row), target, local, remote)), null);
  const f: PortForward = { key, label: `${target}:${remote}`, local, handle, status: "starting" };
  useK8sStore.setState((s) => ({ forwards: [...s.forwards.filter((x) => x.key !== key), f] }));
  const update = (patch: Partial<PortForward>) => useK8sStore.setState((s) => ({ forwards: s.forwards.map((x) => (x.key === key ? { ...x, ...patch } : x)) }));
  // kubectl prints "Forwarding from 127.0.0.1:…" once listening.
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const logs = await native.shellBgLogs(handle).catch(() => null);
    if (logs?.exited) {
      update({ status: "failed", error: logs.bytes.trim().split("\n").pop() });
      return void toast.error("Port-forward failed", { description: logs.bytes.trim() });
    }
    if (logs && /Forwarding from/.test(logs.bytes)) {
      update({ status: "up" });
      return void toast.success(`localhost:${local} → ${target}:${remote}`, { action: { label: "Open", onClick: () => app().openPreview(`http://localhost:${local}`) } });
    }
  }
  update({ status: "up" });
}

export async function stopForward(key: string): Promise<void> {
  const f = useK8sStore.getState().forwards.find((x) => x.key === key);
  if (f) await native.shellBgKill(f.handle).catch(() => {});
  useK8sStore.setState((s) => ({ forwards: s.forwards.filter((x) => x.key !== key) }));
}

/** kubectl diff / apply for the active YAML file. */
export async function applyFile(path: string, mode: "apply" | "diff" | "delete"): Promise<void> {
  const s = scope();
  if (mode === "diff") {
    // kubectl diff exits 1 when there are differences.
    const r = await native.runCommand(line(kubectl(s, ["diff", "-f", path])), null, 60);
    const out = r.stdout.trim();
    if (r.exit_code !== 0 && r.exit_code !== 1) return void toast.error("kubectl diff failed", { description: r.stderr });
    if (!out) return void toast.success("No differences with the cluster");
    const dir = `${(await appCacheDir()).replace(/\\/g, "/").replace(/\/+$/, "")}/k8s`;
    await native.createDir(dir).catch(() => {});
    const diffPath = `${dir}/${path.split("/").pop()}.diff`;
    await native.writeFile(diffPath, `${out}\n`, "user");
    app().openFile(diffPath);
    return;
  }
  if (!(await confirmPick(`kubectl ${mode} -f ${path.split("/").pop()}`, mode === "apply" ? "Apply" : "Delete", `Context: ${s.context ?? "current"}`))) return;
  try {
    toast.success((await kc(kubectl(s, [mode, "-f", path]), 120)).trim() || "Done");
    void refresh();
  } catch (e) {
    toast.error(`kubectl ${mode} failed`, { description: String((e as Error).message ?? e) });
  }
}
