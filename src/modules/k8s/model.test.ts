import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { age, decodeSecret, KINDS, kubectl, listArgv, logsArgv, parseConfigView, parseList, podStatus, summarize } from "./model";

const pod = (status: object, extra: object = {}) => ({ metadata: { name: "p", namespace: "ns", creationTimestamp: "2026-01-01T00:00:00Z" }, spec: { containers: [{ name: "app", ports: [{ containerPort: 8080 }] }, { name: "side" }] }, status, ...extra });

describe("summaries", () => {
  it("computes pod STATUS like kubectl", () => {
    expect(podStatus(pod({ phase: "Running", containerStatuses: [{ ready: true, state: { running: {} } }] }))).toBe("Running");
    expect(podStatus(pod({ phase: "Running", containerStatuses: [{ state: { waiting: { reason: "CrashLoopBackOff" } } }] }))).toBe("CrashLoopBackOff");
    expect(podStatus(pod({ phase: "Pending", initContainerStatuses: [{ state: { terminated: { exitCode: 0 } } }, { state: { running: {} } }] }))).toBe("Init:1/2");
    expect(podStatus(pod({ phase: "Pending", initContainerStatuses: [{ state: { waiting: { reason: "ImagePullBackOff" } } }] }))).toBe("Init:ImagePullBackOff");
    expect(podStatus(pod({ phase: "Failed", containerStatuses: [{ state: { terminated: { exitCode: 137 } } }] }))).toBe("ExitCode:137");
    expect(podStatus(pod({ phase: "Succeeded", containerStatuses: [{ state: { terminated: { reason: "Completed", exitCode: 0 } } }] }))).toBe("Completed");
    expect(podStatus(pod({ phase: "Running" }, { metadata: { name: "p", deletionTimestamp: "x" } }))).toBe("Terminating");
  });

  it("summarizes rows", () => {
    const now = Date.parse("2026-01-01T03:00:00Z");
    const r = summarize("pods", pod({ phase: "Running", podIP: "10.1.0.4", containerStatuses: [{ ready: true, restartCount: 2, state: { running: {} } }, { ready: false, restartCount: 1, state: { waiting: { reason: "CrashLoopBackOff" } } }] }), now);
    expect(r).toMatchObject({ status: "CrashLoopBackOff", health: "error", ready: "1/2", restarts: 3, age: "3h", containers: ["app", "side"], ports: [8080] });
    expect(age("2026-01-01T02:59:30Z", now)).toBe("30s");
    expect(age("2025-12-20T00:00:00Z", now)).toBe("12d");
    expect(summarize("deployments", { metadata: { name: "d" }, spec: { replicas: 3, template: { spec: { containers: [{ image: "nginx:1.27" }] } } }, status: { readyReplicas: 1 } })).toMatchObject({ status: "Progressing", health: "warn", ready: "1/3", detail: "nginx:1.27" });
    expect(decodeSecret({ data: { user: btoa("admin"), bin: btoa("\xff\xfe") } })).toEqual([["user", "admin"], ["bin", "(binary, 4 base64 chars)"]]);
    expect(parseConfigView(JSON.stringify({ "current-context": "a", contexts: [{ name: "a", context: { cluster: "c", user: "u", namespace: "dev" } }] }))).toEqual({ current: "a", contexts: [{ name: "a", cluster: "c", user: "u", namespace: "dev" }] });
  });

  it("builds kubectl arguments", () => {
    const pods = KINDS.find((k) => k.id === "pods")!;
    expect(listArgv({ context: "prod", namespace: null }, pods)).toEqual(["kubectl", "--context", "prod", "get", "pods", "-o", "json", "--all-namespaces"]);
    expect(listArgv({ context: null, namespace: "web" }, KINDS.find((k) => k.id === "nodes")!)).toEqual(["kubectl", "get", "nodes", "-o", "json"]);
    expect(logsArgv({ context: null, namespace: "web" }, "api-1", "app", { previous: true, tail: 200 })).toEqual(["kubectl", "-n", "web", "logs", "api-1", "-c", "app", "--timestamps", "--tail=200", "--previous"]);
    expect(kubectl({ context: "x", namespace: "y" }, ["version"], { namespaced: false })).toEqual(["kubectl", "--context", "x", "version"]);
  });
});

// GEAR_TEST_KUBE=<context> pnpm vitest run src/modules/k8s (a real API server is enough; no nodes needed).
const ctx = process.env.GEAR_TEST_KUBE;
describe.skipIf(!ctx)("against a real API server", () => {
  const k = (argv: string[], input?: string) => execFileSync(argv[0], argv.slice(1), { encoding: "utf8", input });
  const scope = { context: ctx!, namespace: `gear-e2e-${Date.now().toString(36)}` };
  const kind = (id: string) => KINDS.find((x) => x.id === id)!;

  it("lists, edits via replace, scales, restarts and reports conflicts", () => {
    k(kubectl(scope, ["create", "namespace", scope.namespace!], { namespaced: false }));
    try {
      k(kubectl(scope, ["create", "deployment", "web", "--image=nginx:1.27", "--replicas=2", "--port=80"]));
      k(kubectl(scope, ["create", "configmap", "cfg", "--from-literal=a=1", "--from-literal=b=2"]));
      k(kubectl(scope, ["create", "secret", "generic", "creds", "--from-literal=user=admin"]));
      k(kubectl(scope, ["expose", "deployment", "web", "--port=8080", "--target-port=80"]));
      k(kubectl(scope, ["run", "lonely", "--image=busybox", "--restart=Never", "--", "sleep", "1"]));

      const deps = parseList("deployments", k(listArgv(scope, kind("deployments"))));
      expect(deps).toMatchObject([{ name: "web", ready: "0/2", detail: "nginx:1.27", health: "warn" }]);
      expect(parseList("configmaps", k(listArgv(scope, kind("configmaps")))).find((r) => r.name === "cfg")?.detail).toBe("2 keys");
      const secret = parseList("secrets", k(listArgv(scope, kind("secrets")))).find((r) => r.name === "creds")!;
      expect(decodeSecret(secret.raw)).toEqual([["user", "admin"]]);
      expect(parseList("services", k(listArgv(scope, kind("services"))))[0]).toMatchObject({ name: "web", status: "ClusterIP", ports: [8080] });
      // No scheduler on this API server: the pod stays Pending.
      expect(parseList("pods", k(listArgv(scope, kind("pods"))))[0]).toMatchObject({ name: "lonely", status: "Pending", ready: "0/1", health: "warn" });
      // All namespaces includes ours.
      expect(parseList("deployments", k(listArgv({ ...scope, namespace: null }, kind("deployments")))).some((r) => r.namespace === scope.namespace && r.name === "web")).toBe(true);

      // Edit flow: get YAML, change it, replace.
      const yaml = k(kubectl(scope, ["get", "configmap", "cfg", "-o", "yaml"]));
      const dir = mkdtempSync(join(tmpdir(), "gear-k8s-"));
      writeFileSync(join(dir, "cfg.yaml"), yaml.replace(/^(\s+)a: "1"$/m, '$1a: "changed"'));
      expect(k(kubectl(scope, ["replace", "-f", join(dir, "cfg.yaml")]))).toMatch(/configmap\/cfg replaced/);
      expect(JSON.parse(k(kubectl(scope, ["get", "configmap", "cfg", "-o", "json"]))).data.a).toBe("changed");
      // The same stale file again: resourceVersion conflict.
      expect(() => k(kubectl(scope, ["replace", "-f", join(dir, "cfg.yaml")]))).toThrow(/the object has been modified/);

      k(kubectl(scope, ["scale", "deployment/web", "--replicas=0"]));
      expect(parseList("deployments", k(listArgv(scope, kind("deployments"))))[0]).toMatchObject({ ready: "0/0", status: "Scaled to 0", health: "idle" });
      expect(k(kubectl(scope, ["rollout", "restart", "deployment/web"]))).toMatch(/restarted/);
      expect(JSON.parse(k(kubectl(scope, ["get", "deployment", "web", "-o", "json"]))).spec.template.metadata.annotations["kubectl.kubernetes.io/restartedAt"]).toBeTruthy();
      expect(k(kubectl(scope, ["describe", "configmap", "cfg"]))).toMatch(/Name:\s+cfg/);
      // Events list parses (may be empty without controllers).
      expect(Array.isArray(parseList("events", k(listArgv(scope, kind("events")))))).toBe(true);
    } finally {
      k(kubectl(scope, ["delete", "namespace", scope.namespace!, "--wait=false"], { namespaced: false }));
    }
  }, 60_000);
});
