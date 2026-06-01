import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import { shortcutDisplay } from "@/modules/shortcuts/shortcuts";
import type { SearchAddon } from "@xterm/addon-search";
import { TerminalPane, type TerminalPaneHandle } from "./TerminalPane";
import { useTerminalDropStore } from "./lib/dropStore";
import type { PaneNode } from "./lib/panes";

type LeafBundle = {
  setRef: (h: TerminalPaneHandle | null) => void;
  onSearch: (addon: SearchAddon) => void;
  onCwd: (cwd: string) => void;
  onExit: (code: number) => void;
};

type Props = {
  node: PaneNode;
  tabVisible: boolean;
  activeLeafId: number;
  showLabel?: boolean;
  onFocusLeaf: (leafId: number) => void;
  onRenameLeaf?: (leafId: number, name: string) => void;
  getBundle: (leafId: number) => LeafBundle;
};

export function PaneTreeView({
  node,
  tabVisible,
  activeLeafId,
  showLabel = false,
  onFocusLeaf,
  onRenameLeaf,
  getBundle,
}: Props) {
  if (node.kind === "leaf") {
    const focused = node.id === activeLeafId;
    const b = getBundle(node.id);
    const cwdBasename = node.cwd
      ? node.cwd.split(/[\\/]/).filter(Boolean).pop() ?? node.cwd
      : undefined;
    const label = node.name ?? cwdBasename ?? "";
    return (
      <PaneLeaf
        leafId={node.id}
        tabVisible={tabVisible}
        focused={focused}
        initialCwd={node.cwd}
        label={label}
        showLabel={showLabel}
        bundle={b}
        onFocusLeaf={onFocusLeaf}
        onRenameLeaf={onRenameLeaf}
      />
    );
  }

  return (
    <ResizablePanelGroup
      orientation={node.dir === "row" ? "horizontal" : "vertical"}
    >
      {node.children.map((child, i) => (
        <Fragment key={child.id}>
          {i > 0 && <ResizableHandle />}
          <ResizablePanel id={`pane-${child.id}`} minSize="10%">
            <PaneTreeView
              node={child}
              tabVisible={tabVisible}
              activeLeafId={activeLeafId}
              showLabel
              onFocusLeaf={onFocusLeaf}
              onRenameLeaf={onRenameLeaf}
              getBundle={getBundle}
            />
          </ResizablePanel>
        </Fragment>
      ))}
    </ResizablePanelGroup>
  );
}

type PaneLeafProps = {
  leafId: number;
  tabVisible: boolean;
  focused: boolean;
  initialCwd?: string;
  label: string;
  showLabel: boolean;
  bundle: LeafBundle;
  onFocusLeaf: (leafId: number) => void;
  onRenameLeaf?: (leafId: number, name: string) => void;
};

function PaneLeaf({
  leafId,
  tabVisible,
  focused,
  initialCwd,
  label,
  showLabel,
  bundle,
  onFocusLeaf,
  onRenameLeaf,
}: PaneLeafProps) {
  const termRef = useRef<TerminalPaneHandle | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(
    null,
  );
  const menuRef = useRef<HTMLDivElement>(null);

  const setRef = useCallback(
    (h: TerminalPaneHandle | null) => {
      termRef.current = h;
      bundle.setRef(h);
    },
    [bundle],
  );

  useEffect(() => {
    if (!ctxMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ctxMenu]);

  const menuItemCls =
    "flex w-full items-center px-3 py-1.5 text-left text-[12px] hover:bg-accent hover:text-foreground";

  return (
    <div
      className="relative flex h-full flex-col"
      data-pane-leaf={leafId}
      onContextMenu={(e) => {
        e.preventDefault();
        setCtxMenu({ x: e.clientX, y: e.clientY });
      }}
      onMouseDown={() => onFocusLeaf(leafId)}
    >
      {showLabel && (
        <PaneLabel
          label={label}
          focused={focused}
          onCommit={(name) => onRenameLeaf?.(leafId, name)}
        />
      )}
      <TerminalPane
        ref={setRef}
        leafId={leafId}
        visible={tabVisible}
        focused={focused}
        initialCwd={initialCwd}
        onSearchReady={(_id, addon) => bundle.onSearch(addon)}
        onCwd={(_id, cwd) => bundle.onCwd(cwd)}
        onExit={(_id, code) => bundle.onExit(code)}
      />
      <DropOverlay leafId={leafId} />
      {ctxMenu && (
        <div
          ref={menuRef}
          style={{ position: "fixed", left: ctxMenu.x, top: ctxMenu.y, zIndex: 9999 }}
          className="min-w-40 rounded-md border border-border bg-popover py-1 shadow-lg"
        >
          <button
            type="button"
            className={menuItemCls}
            onClick={() => {
              const sel = termRef.current?.getSelection() ?? "";
              if (sel) void navigator.clipboard.writeText(sel);
              setCtxMenu(null);
            }}
          >
            Copy
          </button>
          <button
            type="button"
            className={menuItemCls}
            onClick={() => {
              void navigator.clipboard.readText().then((text) => {
                if (text) termRef.current?.write(text);
              });
              setCtxMenu(null);
            }}
          >
            Paste
          </button>
          <button
            type="button"
            className={menuItemCls}
            onClick={() => {
              termRef.current?.write("\x0c");
              setCtxMenu(null);
            }}
          >
            Clear
          </button>
          <div className="my-1 h-px bg-border/60" />
          <button
            type="button"
            className={menuItemCls}
            onClick={() => {
              const sel = termRef.current?.getSelection() ?? "";
              if (sel) {
                window.dispatchEvent(
                  new CustomEvent("Gear:ask-selection", { detail: sel }),
                );
              }
              setCtxMenu(null);
            }}
          >
            <span className="flex-1">Ask AI</span>
            {shortcutDisplay("ai.askSelection") && (
              <span className="ml-4 text-[11px] text-muted-foreground/70">
                {shortcutDisplay("ai.askSelection")}
              </span>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

function DropOverlay({ leafId }: { leafId: number }) {
  const active = useTerminalDropStore((s) => s.targetLeafId === leafId);
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-2 grid place-items-center rounded-lg border border-primary/45 bg-background/70 text-xs font-medium text-foreground shadow-lg backdrop-blur-sm">
      Drop file path here
    </div>
  );
}

function PaneLabel({
  label,
  focused,
  onCommit,
}: {
  label: string;
  focused: boolean;
  onCommit: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setDraft(label);
    setEditing(true);
    window.setTimeout(() => {
      inputRef.current?.select();
    }, 0);
  };

  const commit = () => {
    setEditing(false);
    onCommit(draft);
  };

  const cancel = () => setEditing(false);

  return (
    <div
      className={cn(
        "flex h-5 shrink-0 items-center border-b border-border/40 px-2",
        focused ? "bg-accent/30" : "bg-background/30",
      )}
    >
      {editing ? (
        <input
          ref={inputRef}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") cancel();
          }}
          className="w-full bg-transparent text-[11px] outline-none"
        />
      ) : (
        <span
          onDoubleClick={startEdit}
          title="Double-click to rename"
          className={cn(
            "truncate text-[11px] leading-none",
            focused ? "text-foreground/80" : "text-muted-foreground/60",
          )}
        >
          {label || <span className="opacity-40">pane</span>}
        </span>
      )}
    </div>
  );
}
