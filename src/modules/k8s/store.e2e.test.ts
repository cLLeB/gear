// The k8s store against a real API server. GEAR_TEST_KUBE=<context> pnpm vitest run src/modules/k8s

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";

const ctx = process.env.GEAR_TEST_KUBE;
const cache = mkdtempSync(`${tmpdir()}/gear-k8s-cache-`);
const opened: string[] = [];
const toasts: string[] = [];
vi.mock("@tauri-apps/api/path", () => ({ appCacheDir: async () => cache }));
vi.mock("@/app/appBridge", () => ({ app: () => ({ openFile: (p: string) => opened.push(p), openTerminal: () => {}, openPreview: () => {} }) }));
vi.mock("sonner", () => ({ toast: { error: (m: string) => toasts.push(`error:${m}`), success: (m: string) => toasts.push(`ok:${m}`), info: () => {} } }));
vi.mock("@/modules/quick-pick", () => ({ quickPick: async () => undefined, inputBox: async () => "3", confirmPick: async () => true }));
vi.mock("@/modules/ai/lib/native", () => ({
  native: {
    runCommand: async (command: string) => {
      const r = spawnSync("sh", ["-c", command], { encoding: "utf8" });
      return { stdout: r.stdout, stderr: r.stderr, exit_code: r.status, timed_out: false, truncated: false };
    },
    readFile: async (p: string) => (existsSync(p) ? { kind: "text", content: readFileSync(p, "utf8"), size: 0 } : Promise.reject(new Error("missing"))),
    writeFile: async (p: string, c: string) => writeFileSync(p, c),
    createDir: async (p: string) => void mkdirSync(p, { recursive: true }),
  },
}));

describe.skipIf(!ctx)("k8s store", () => {
  it("lists, edits YAML with conflict detection, and scales", async () => {
    const ns = `gear-store-${Date.now().toString(36)}`;
    const k = (...a: string[]) => execFileSync("kubectl", ["--context", ctx!, ...a], { encoding: "utf8" });
    k("create", "namespace", ns);
    try {
      k("-n", ns, "create", "deployment", "api", "--image=nginx:1.27");
      k("-n", ns, "create", "configmap", "settings", "--from-literal=mode=a");
      const s = await import("./store");
      s.useK8sStore.setState({ context: ctx!, namespace: ns, kind: "deployments" });
      await s.init();
      expect(s.useK8sStore.getState().contexts.some((c) => c.name === ctx)).toBe(true);
      expect(s.useK8sStore.getState().namespaces).toContain(ns);
      expect(s.useK8sStore.getState().rows.map((r) => [r.name, r.ready])).toEqual([["api", "0/1"]]);

      await s.scale("deployments", s.useK8sStore.getState().rows[0]);
      expect(s.useK8sStore.getState().rows[0].ready).toBe("0/3");

      s.setScope({ kind: "configmaps" });
      await vi.waitFor(() => expect(s.useK8sStore.getState().rows.some((r) => r.name === "settings")).toBe(true));
      const row = s.useK8sStore.getState().rows.find((r) => r.name === "settings")!;
      await s.editYaml("configmaps", row);
      const path = opened[opened.length - 1];
      expect(readFileSync(path, "utf8")).toMatch(/^# Saving this file applies it/);
      writeFileSync(path, readFileSync(path, "utf8").replace("mode: a", "mode: b"));
      await s.replaceMirror(path);
      expect(JSON.parse(k("-n", ns, "get", "configmap", "settings", "-o", "json")).data.mode).toBe("b");
      // The mirror was refreshed, so a second edit applies too…
      writeFileSync(path, readFileSync(path, "utf8").replace("mode: b", "mode: c"));
      await s.replaceMirror(path);
      expect(JSON.parse(k("-n", ns, "get", "configmap", "settings", "-o", "json")).data.mode).toBe("c");
      // …but a change made elsewhere in between is a conflict, not an overwrite.
      k("-n", ns, "patch", "configmap", "settings", "-p", '{"data":{"mode":"other"}}');
      writeFileSync(path, readFileSync(path, "utf8").replace("mode: c", "mode: mine"));
      await s.replaceMirror(path);
      expect(toasts[toasts.length - 1]).toMatch(/changed in the cluster/);
      expect(JSON.parse(k("-n", ns, "get", "configmap", "settings", "-o", "json")).data.mode).toBe("other");
    } finally {
      k("delete", "namespace", ns, "--wait=false");
    }
  }, 60_000);
});
