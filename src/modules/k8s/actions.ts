// Palette commands for the Kubernetes explorer.

import { toast } from "sonner";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { quickPick } from "@/modules/quick-pick";
import { applyFile, init, setScope, useK8sStore } from "./store";

function showView(): void {
  window.dispatchEvent(new CustomEvent("gear:show-k8s-panel"));
}

function activeYaml(): string | null {
  const p = getActiveEditor()?.path?.replace(/\\/g, "/");
  if (!p || !/\.ya?ml$/i.test(p)) {
    toast.info("Open a Kubernetes YAML file first");
    return null;
  }
  return p;
}

async function switchContext(): Promise<void> {
  await init();
  const { contexts, context } = useK8sStore.getState();
  const pick = await quickPick(contexts.map((c) => ({ label: c.name, description: c.name === context ? "current" : c.namespace ?? "", detail: `${c.cluster} · ${c.user}`, value: c.name })), { title: "Kubernetes context" });
  if (pick) {
    setScope({ context: pick });
    showView();
  }
}

export const K8S_ACTIONS = [
  { id: "k8s.show", label: "Kubernetes: Show cluster", keywords: ["kubernetes", "k8s", "kubectl", "pods", "cluster"], run: showView },
  { id: "k8s.context", label: "Kubernetes: Switch context…", keywords: ["kubernetes", "k8s", "context", "cluster"], run: () => void switchContext() },
  { id: "k8s.apply", label: "Kubernetes: Apply current file", keywords: ["kubernetes", "k8s", "apply", "yaml", "manifest"], run: () => { const p = activeYaml(); if (p) void applyFile(p, "apply"); } },
  { id: "k8s.diff", label: "Kubernetes: Diff current file with the cluster", keywords: ["kubernetes", "k8s", "diff", "yaml", "manifest"], run: () => { const p = activeYaml(); if (p) void applyFile(p, "diff"); } },
  { id: "k8s.delete", label: "Kubernetes: Delete resources in current file", keywords: ["kubernetes", "k8s", "delete", "yaml"], run: () => { const p = activeYaml(); if (p) void applyFile(p, "delete"); } },
];
