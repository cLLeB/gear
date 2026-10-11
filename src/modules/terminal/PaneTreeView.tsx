import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { dragHasFsPaths, readFsPaths } from "@/lib/pathDrag";
import { cn } from "@/lib/utils";
import type { SearchAddon } from "@xterm/addon-search";
import { Fragment, useEffect, useRef, useState } from "react";
import { useGroupRef } from "react-resizable-panels";
import { equalSizes } from "./lib/paneLayout";
import { usePaneLockStore } from "./lib/paneLock";
import { useTerminalDropStore } from "./lib/dropStore";
import { firstLeafSlotId, type PaneNode } from "./lib/panes";
import { formatDroppedPaths } from "./lib/quoteShellPath";
import { pasteIntoLeaf } from "./lib/rendererPool";
import { TerminalPane, type TerminalPaneHandle } from "./TerminalPane";

type LeafBundle = {
  setRef: (h: TerminalPaneHandle | null) => void;
  onSearchReady: (leafId: number, addon: SearchAddon) => void;
  onCwd: (leafId: number, cwd: string) => void;
  onExit: (leafId: number, code: number) => void;
};

type Props = {
  node: PaneNode;
  tabVisible: boolean;
  activeLeafId: number;
  blocks: boolean;
  isPrivate: boolean;
  shellPath?: string;
  /** Show the per-pane label header (true for split panes). */
  showLabel?: boolean;
  onFocusLeaf: (leafId: number) => void;
  onRenameLeaf?: (leafId: number, name: string) => void;
  onCloseLeaf?: (leafId: number) => void;
  getBundle: (leafId: number) => LeafBundle;
  /** Bumped to re-balance every split to equal leaf sizes. */
  equalizeEpoch?: number;
  /** This pane is shown zoomed (tmux-style) over its siblings. */
  zoomed?: boolean;
};

export function PaneTreeView(props: Props) {
  const { node } = props;
  if (node.kind === "leaf") {
    const {
      tabVisible,
      activeLeafId,
      blocks,
      isPrivate,
      shellPath,
      showLabel = false,
      onFocusLeaf,
      onRenameLeaf,
      onCloseLeaf,
      getBundle,
    } = props;
    const focused = node.id === activeLeafId;
    const b = getBundle(node.id);
    const cwdBasename = node.cwd
      ? (node.cwd.split(/[\\/]/).filter(Boolean).pop() ?? node.cwd)
      : undefined;
    const label = node.name ?? cwdBasename ?? "";
    return (
      <div
        onMouseDownCapture={() => {
          if (!focused) onFocusLeaf(node.id);
        }}
        // Catches focus from Tab, programmatic focus, or any path that
        // skips mousedown — keeps activeLeafId in sync with DOM focus.
        onFocus={() => {
          if (!focused) onFocusLeaf(node.id);
        }}
        data-pane-leaf={node.id}
        className="relative flex h-full w-full flex-col"
        // In-app drag from the sidebar file explorer: paste the shell-quoted
        // path(s) into this pane. OS-level file drops are handled separately by
        // useTerminalFileDrop (Tauri onDragDropEvent).
        onDragOver={(e) => {
          if (!dragHasFsPaths(e.dataTransfer)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          useTerminalDropStore.getState().setTarget(node.id);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          const store = useTerminalDropStore.getState();
          if (store.targetLeafId === node.id) store.setTarget(null);
        }}
        onDrop={(e) => {
          if (!dragHasFsPaths(e.dataTransfer)) return;
          e.preventDefault();
          const paths = readFsPaths(e.dataTransfer);
          useTerminalDropStore.getState().setTarget(null);
          if (!paths.length) return;
          onFocusLeaf(node.id);
          pasteIntoLeaf(node.id, formatDroppedPaths(paths));
        }}
      >
        {showLabel && (
          <PaneLabel
            label={label}
            focused={focused}
            onCommit={(name) => onRenameLeaf?.(node.id, name)}
            onClose={onCloseLeaf ? () => onCloseLeaf(node.id) : undefined}
            zoomed={props.zoomed}
          />
        )}
        <div className="relative min-h-0 flex-1">
          <TerminalPane
            leafId={node.id}
            visible={tabVisible}
            focused={focused}
            initialCwd={node.cwd}
            blocks={blocks}
            isPrivate={isPrivate}
            shellPath={shellPath}
            ref={b.setRef}
            onSearchReady={b.onSearchReady}
            onCwd={b.onCwd}
            onExit={b.onExit}
          />
          <DropOverlay leafId={node.id} />
          <LockBadge leafId={node.id} />
        </div>
      </div>
    );
  }

  return <PaneSplitView {...props} node={node} />;
}

// Split rendering lives in its own component: the same React instance can
// switch between a leaf and a split (splitting in place keeps the slot key),
// and hooks must not appear conditionally.
function PaneSplitView(props: Props & { node: Extract<PaneNode, { kind: "split" }> }) {
  const { node, equalizeEpoch = 0 } = props;
  const groupRef = useGroupRef();
  useEffect(() => {
    if (equalizeEpoch === 0) return;
    const sizes = equalSizes(node);
    const layout: Record<string, number> = {};
    node.children.forEach((child, i) => {
      layout[`pane-slot-${firstLeafSlotId(child)}`] = sizes[i];
    });
    try {
      groupRef.current?.setLayout(layout);
    } catch (e) {
      console.warn("[gear] equalize panes failed:", e);
    }
    // Only a new epoch should re-balance; tree edits keep user sizes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equalizeEpoch]);

  return (
    <ResizablePanelGroup
      groupRef={groupRef}
      orientation={node.dir === "row" ? "horizontal" : "vertical"}
    >
      {node.children.map((child, i) => {
        // Keyed by the subtree's slot, not the node or leaf id: splitting a
        // leaf in place gives the replacing split node a fresh id (which would
        // remount the surviving pane), and swapping panes moves leaf ids
        // between positions (which would reset the resize layout).
        const slotId = firstLeafSlotId(child);
        return (
          <Fragment key={slotId}>
            {i > 0 && <ResizableHandle />}
            <ResizablePanel id={`pane-slot-${slotId}`} minSize="10%">
              <PaneTreeView {...props} node={child} showLabel />
            </ResizablePanel>
          </Fragment>
        );
      })}
    </ResizablePanelGroup>
  );
}

function PaneLabel({
  label,
  focused,
  onCommit,
  onClose,
  zoomed,
}: {
  label: string;
  focused: boolean;
  onCommit: (name: string) => void;
  onClose?: () => void;
  zoomed?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setDraft(label);
    setEditing(true);
    window.setTimeout(() => inputRef.current?.select(), 0);
  };
  const commit = () => {
    setEditing(false);
    onCommit(draft);
  };

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
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          className="w-full bg-transparent text-[11px] outline-none"
        />
      ) : (
        <span
          onDoubleClick={startEdit}
          title="Double-click to rename"
          className={cn(
            "flex-1 truncate text-[11px] leading-none",
            focused ? "text-foreground/80" : "text-muted-foreground/60",
          )}
        >
          {label || <span className="opacity-40">pane</span>}
        </span>
      )}
      {zoomed && !editing && (
        <span
          title="Zoomed — other panes are hidden. Toggle zoom to restore."
          className="ml-1 shrink-0 rounded bg-primary/20 px-1 text-[10px] leading-none text-primary"
        >
          ZOOM
        </span>
      )}
      {onClose && !editing && (
        <button
          type="button"
          onClick={onClose}
          title="Close pane (Ctrl+Shift+W)"
          aria-label="Close pane"
          className="ml-1 shrink-0 rounded px-1 text-[12px] leading-none text-muted-foreground/60 hover:bg-accent/40 hover:text-foreground"
        >
          ×
        </button>
      )}
    </div>
  );
}

function LockBadge({ leafId }: { leafId: number }) {
  const locked = usePaneLockStore((s) => !!s.locked[leafId]);
  if (!locked) return null;
  return (
    <div
      className="pointer-events-none absolute right-2 top-1.5 z-10 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
      title="Read-only: keyboard input and pastes are blocked"
    >
      🔒 read-only
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
