// A .http editor with its response panel underneath (drag the divider to resize).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { native } from "@/modules/ai/lib/native";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { ResponsePanel } from "./ResponsePanel";
import { useHttpStore } from "./store";

const KEY = "gear-http-panel-height";

export function HttpSplit({ path, children }: { path: string; children: ReactNode }) {
  const norm = path.replace(/\\/g, "/");
  const hasResponse = useHttpStore((s) => Boolean(s.history[norm]?.length) || Boolean(s.running[norm]));
  const [open, setOpen] = useState(false);
  const [height, setHeight] = useState(() => Number(localStorage.getItem(KEY)) || 300);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (hasResponse) setOpen(true);
  }, [hasResponse]);
  useEffect(() => {
    const onOpen = (e: Event) => {
      if ((e as CustomEvent<{ path: string }>).detail.path === norm) setOpen(true);
    };
    window.addEventListener("gear:http-panel", onOpen);
    return () => window.removeEventListener("gear:http-panel", onOpen);
  }, [norm]);
  const drag = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const start = height;
    const total = box.current?.clientHeight ?? 800;
    const move = (ev: PointerEvent) => setHeight(Math.min(total - 80, Math.max(80, start - (ev.clientY - startY))));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setHeight((h) => (localStorage.setItem(KEY, String(h)), h));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const getText = () => {
    const ed = getActiveEditor();
    return ed && ed.path?.replace(/\\/g, "/") === norm ? ed.view.state.doc.toString() : "";
  };
  return (
    <div ref={box} className="flex h-full flex-col">
      <div className="min-h-0 flex-1">{children}</div>
      {open ? (
        <>
          <div className="h-1 shrink-0 cursor-row-resize border-t border-border/60 hover:bg-primary/30" onPointerDown={drag} onDoubleClick={() => setOpen(false)} title="Drag to resize · double-click to hide" />
          <div style={{ height }} className="shrink-0">
            <ResponsePanel path={norm} getText={getText} />
          </div>
        </>
      ) : (
        <button type="button" className="shrink-0 border-t border-border/60 px-3 py-0.5 text-left text-[11px] text-muted-foreground hover:bg-muted" onClick={() => setOpen(true)}>
          ▴ Response
        </button>
      )}
    </div>
  );
}

/** The text of an .http file: the open editor's if it's active, else the file on disk. */
export async function httpText(path: string): Promise<string> {
  const ed = getActiveEditor();
  if (ed && ed.path?.replace(/\\/g, "/") === path) return ed.view.state.doc.toString();
  const r = await native.readFile(path);
  return r.kind === "text" ? r.content : "";
}
