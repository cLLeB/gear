// gear-ext://log/<id>: an extension's console output and host messages.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { restart, useExtStore } from "./store";

const LEVEL: Record<string, string> = { error: "text-red-500", warn: "text-amber-500", debug: "text-muted-foreground" };

export const ExtLogPane = forwardRef<EditorPaneHandle, { path: string }>(function ExtLogPane({ path }, ref) {
  const id = path.replace(/^gear-ext:\/\/log\//, "");
  const logs = useExtStore((s) => s.logs[id]) ?? [];
  const state = useExtStore((s) => s.state[id] ?? "stopped");
  const [filter, setFilter] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useImperativeHandle(
    ref,
    () =>
      ({
        setQuery: setFilter,
        findNext: () => {},
        findPrevious: () => {},
        clearQuery: () => setFilter(""),
        focus: () => {},
        getSelection: () => null,
        getPath: () => path,
        reload: () => true,
        gotoLine: () => {},
        undo: () => {},
        redo: () => {},
        openFindReplace: () => {},
        toggleBlame: () => {},
        save: async () => {},
      }) as EditorPaneHandle,
    [path],
  );
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [logs.length]);
  const shown = filter ? logs.filter((l) => l.text.toLowerCase().includes(filter.toLowerCase())) : logs;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5 text-[12px]">
        <span className="font-medium">{id}</span>
        <span className="text-[11px] text-muted-foreground">{state}</span>
        <input className="ml-2 w-48 rounded border border-border/60 bg-background px-2 py-0.5" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="flex-1" />
        <button type="button" className="rounded px-2 py-0.5 hover:bg-muted" onClick={() => useExtStore.setState((s) => ({ logs: { ...s.logs, [id]: [] } }))}>
          Clear
        </button>
        <button type="button" className="rounded px-2 py-0.5 hover:bg-muted" onClick={() => void restart(id)}>
          Reload extension
        </button>
      </div>
      <div ref={box} className="min-h-0 flex-1 overflow-auto p-2 font-mono text-[12px] leading-[1.5]">
        {shown.map((l, i) => (
          <div key={i} className={cn("whitespace-pre-wrap break-all", LEVEL[l.level])}>
            <span className="mr-2 select-none text-muted-foreground/60">{new Date(l.at).toLocaleTimeString([], { hour12: false })}</span>
            {l.text}
          </div>
        ))}
        {!shown.length && <div className="text-muted-foreground">No output.</div>}
      </div>
    </div>
  );
});
