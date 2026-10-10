// gear-k8s:// tabs: a pod's live logs (shared log viewer) and `kubectl describe`.

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { ContainerLogs } from "@/modules/containers/DockerPane";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { execArgv, kubectl, logsArgv } from "./model";
import { kc, kindInfo, parseK8sPath } from "./store";
import { app } from "@/app/appBridge";
import { commandLine } from "@/modules/containers/model";
import { IS_WINDOWS } from "@/lib/platform";

function handle(path: string, reload: () => void): EditorPaneHandle {
  return {
    setQuery: () => {},
    findNext: () => {},
    findPrevious: () => {},
    clearQuery: () => {},
    focus: () => {},
    getSelection: () => null,
    getPath: () => path,
    reload: () => (reload(), true),
    gotoLine: () => {},
    undo: () => {},
    redo: () => {},
    openFindReplace: () => {},
    toggleBlame: () => {},
    save: async () => {},
  } as EditorPaneHandle;
}

const Describe = forwardRef<EditorPaneHandle, { path: string; text: () => Promise<string>; title: string }>(function Describe({ path, text, title }, ref) {
  const [out, setOut] = useState<string | null>(null);
  const [gen, setGen] = useState(0);
  useImperativeHandle(ref, () => handle(path, () => setGen((g) => g + 1)), [path]);
  useEffect(() => {
    setOut(null);
    text().then(setOut, (e) => setOut(String((e as Error).message ?? e)));
  }, [path, gen]);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5 text-[12px]">
        <span className="font-medium">{title}</span>
        <span className="flex-1" />
        <button type="button" className="rounded px-2 py-0.5 hover:bg-muted" onClick={() => setGen((g) => g + 1)}>
          Refresh
        </button>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[12px] leading-[1.5]">{out ?? "Loading…"}</pre>
    </div>
  );
});

export const K8sPane = forwardRef<EditorPaneHandle, { path: string }>(function K8sPane({ path }, ref) {
  const p = parseK8sPath(path);
  if (!p) return <div className="p-6 text-[12px] text-muted-foreground">Unknown view.</div>;
  if (p.view === "logs") {
    const container = p.b || null;
    return (
      <ContainerLogs
        ref={ref}
        path={path}
        id={`${p.a}/${p.b}`}
        name={`${p.a}${container ? ` · ${container}` : ""}${p.scope.namespace ? ` (${p.scope.namespace})` : ""}`}
        argv={logsArgv(p.scope, p.a, container)}
        onShell={() => app().openTerminal({ command: commandLine(execArgv(p.scope, p.a, container), IS_WINDOWS) })}
      />
    );
  }
  return <Describe ref={ref} path={path} title={`${p.a}/${p.b}`} text={() => kc(kubectl(p.scope, ["describe", p.a, p.b], { namespaced: kindInfo(p.a).namespaced }), 30)} />;
});
