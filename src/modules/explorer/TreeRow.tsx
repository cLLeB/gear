import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { writeFsPaths } from "@/lib/pathDrag";
import { cn } from "@/lib/utils";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import React, { memo, useState } from "react";
import { InlineInput } from "./InlineInput";
import {
  copyToClipboard,
  relativePath,
  revealInFinder,
} from "./lib/contextActions";
import { fileIconUrl, folderIconUrl } from "./lib/iconResolver";
import { COMPACT_CONTENT, COMPACT_ITEM } from "./lib/menuItemClass";
import type { useFileTree } from "./lib/useFileTree";

type Tree = ReturnType<typeof useFileTree>;

export type EntryRowProps = {
  path: string;
  name: string;
  isDir: boolean;
  isExpanded: boolean;
  depth: number;
  rootPath: string;
  tree: Tree;
  isSelected: boolean;
  isRenaming: boolean;
  selectedCount: number;
  size?: number;
  mtime?: number;
  onOpenFile: (path: string, pin?: boolean) => void;
  onSelectPath: (path: string, event: React.MouseEvent) => void;
  onGetSelectedPaths: () => string[];
  onRevealInTerminal?: (path: string) => void;
  onAttachToAgent?: (path: string) => void;
  onOpenMarkdownPreview?: (path: string) => void;
};

function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function EntryRowImpl(props: EntryRowProps) {
  const {
    path,
    name,
    isDir,
    isExpanded,
    depth,
    rootPath,
    tree,
    isSelected,
    isRenaming,
    selectedCount,
    size,
    mtime,
    onOpenFile,
    onSelectPath,
    onGetSelectedPaths,
    onRevealInTerminal,
    onAttachToAgent,
    onOpenMarkdownPreview,
  } = props;

  const [isConfirming, setIsConfirming] = useState(false);

  const metaTitle = !isDir && size !== undefined && mtime !== undefined && mtime > 0
    ? `${formatBytes(size)} · Modified ${new Date(mtime).toLocaleString()}`
    : undefined;
  const iconUrl = isDir ? folderIconUrl(name, isExpanded) : fileIconUrl(name);
  const createTarget = isDir ? path : path.slice(0, path.lastIndexOf("/")) || rootPath;
  const paddingLeft = 6 + depth * 12;
  const bulkActive = isSelected && selectedCount > 1;

  const handleClick = (event: React.MouseEvent) => {
    if (tree.renaming) return;
    onSelectPath(path, event);
    if (event.shiftKey || event.metaKey || event.ctrlKey) return;
    if (isDir) tree.toggle(path);
    else onOpenFile(path);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {isRenaming ? (
          <div
            className="flex h-6 w-full min-w-0 items-center gap-2 px-1.5 text-[13px]"
            style={{ paddingLeft }}
          >
            <span className="size-3.5 shrink-0" />
            {iconUrl ? (
              <img src={iconUrl} alt="" className="size-4 shrink-0" />
            ) : (
              <span className="size-4 shrink-0" />
            )}
            <InlineInput
              initial={name}
              onCommit={tree.commitRename}
              onCancel={tree.cancelRename}
            />
          </div>
        ) : (
          <button
            type="button"
            data-fs-path={path}
            draggable
            onDragStart={(e) => {
              // Drag the whole selection when the grabbed row is part of a
              // multi-selection; otherwise just this row's path.
              const paths = bulkActive ? onGetSelectedPaths() : [path];
              writeFsPaths(e.dataTransfer, paths.length ? paths : [path]);
            }}
            onClick={(e) => handleClick(e)}
            onDoubleClick={() => !isDir && tree.beginRename(path)}
            title={metaTitle}
            className={cn(
              "group flex h-6 w-full min-w-0 cursor-pointer items-center gap-2 rounded-sm px-1.5 text-left text-[13px] text-foreground/85 transition-colors hover:bg-accent/70",
              isSelected && "bg-accent text-foreground",
            )}
            style={{ paddingLeft }}
          >
            <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
              {isDir ? (
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  size={12}
                  strokeWidth={2.25}
                  className={cn(
                    "transition-transform",
                    isExpanded && "rotate-90",
                  )}
                />
              ) : null}
            </span>
            {iconUrl ? (
              <img src={iconUrl} alt="" className="size-4 shrink-0" />
            ) : (
              <span className="size-4 shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate">{name}</span>
          </button>
        )}
      </ContextMenuTrigger>
      <ContextMenuContent
        className={COMPACT_CONTENT}
        onCloseAutoFocus={(e) => {
          if (tree.renaming || tree.pendingCreate) e.preventDefault();
        }}
      >
        {!isDir && (
          <ContextMenuItem
            className={COMPACT_ITEM}
            onSelect={() => onOpenFile(path, true)}
          >
            Open
          </ContextMenuItem>
        )}
        {!isDir && isMarkdownPath(path) && onOpenMarkdownPreview && (
          <ContextMenuItem
            className={COMPACT_ITEM}
            onSelect={() => onOpenMarkdownPreview(path)}
          >
            Open Preview
          </ContextMenuItem>
        )}
        {isDir && onRevealInTerminal && (
          <ContextMenuItem
            className={COMPACT_ITEM}
            onSelect={() => onRevealInTerminal(path)}
          >
            Open in Terminal
          </ContextMenuItem>
        )}
        <ContextMenuItem
          className={COMPACT_ITEM}
          onSelect={() => void revealInFinder(path)}
        >
          Reveal in Finder
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          className={COMPACT_ITEM}
          onSelect={() => tree.beginCreate(createTarget, "file")}
        >
          New File
        </ContextMenuItem>
        <ContextMenuItem
          className={COMPACT_ITEM}
          onSelect={() => tree.beginCreate(createTarget, "dir")}
        >
          New Folder
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          className={COMPACT_ITEM}
          onSelect={() => void copyToClipboard(path)}
        >
          Copy Path
        </ContextMenuItem>
        <ContextMenuItem
          className={COMPACT_ITEM}
          onSelect={() => void copyToClipboard(relativePath(rootPath, path))}
        >
          Copy Relative Path
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          className={COMPACT_ITEM}
          onSelect={() => {
            if (bulkActive) {
              for (const p of onGetSelectedPaths()) onAttachToAgent?.(p);
            } else {
              onAttachToAgent?.(path);
            }
          }}
        >
          {bulkActive ? `Attach ${selectedCount} files to Agent` : "Attach to Agent"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          className={COMPACT_ITEM}
          variant="destructive"
          onSelect={(e) => {
            e.preventDefault();
            if (isConfirming) {
              const targets = bulkActive ? onGetSelectedPaths() : [path];
              for (const p of targets) void tree.deletePath(p);
            } else {
              setIsConfirming(true);
            }
          }}
          onMouseLeave={() => setTimeout(() => setIsConfirming(false), 1500)}
        >
          {isConfirming
            ? "Click again to confirm"
            : bulkActive
              ? `Delete ${selectedCount} items`
              : "Delete"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export const EntryRow = memo(EntryRowImpl);

export type PendingRowProps = {
  depth: number;
  kind: "file" | "dir";
  onCommit: (name: string) => void | Promise<void>;
  onCancel: () => void;
};

export function PendingRow({ depth, kind, onCommit, onCancel }: PendingRowProps) {
  return (
    <div
      className="flex h-6 w-full min-w-0 items-center gap-2 px-1.5 text-[13px]"
      style={{ paddingLeft: 6 + depth * 12 }}
    >
      <span className="size-3.5 shrink-0" />
      <img
        src={kind === "dir" ? folderIconUrl("", false) : fileIconUrl("untitled")}
        alt=""
        className="size-4 shrink-0 opacity-70"
      />
      <InlineInput
        initial=""
        placeholder={kind === "dir" ? "New folder" : "New file"}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    </div>
  );
}

export function StatusRow({
  depth,
  message,
  tone,
}: {
  depth: number;
  message: string;
  tone: "muted" | "error";
}) {
  return (
    <div
      className={cn(
        "h-6 truncate px-2 text-[11px] leading-6",
        tone === "error" ? "text-destructive" : "text-muted-foreground",
      )}
      style={{ paddingLeft: 6 + depth * 12 + 18 }}
    >
      {message}
    </div>
  );
}
