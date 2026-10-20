import { Globe02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { cn } from "@/lib/utils";
import { PreviewAddressBar, type PreviewAddressBarHandle } from "./PreviewAddressBar";
import { type BrowserEvent, DEVICES, type Device } from "./lib/nativeBrowser";
import { useNativeView } from "./lib/useNativeView";

export type PreviewPaneHandle = {
  reload: () => void;
  focusAddressBar: () => void;
  getUrl: () => string;
};

type Props = {
  tabId: number;
  url: string;
  visible: boolean;
  onUrlChange: (url: string) => void;
  onTitleChange?: (title: string) => void;
};

/**
 * A browser tab: the address bar and a native webview placed over this
 * pane's page area. A real webview (not an iframe) loads sites that refuse
 * to be framed and keeps their sign-ins.
 */
export const PreviewPane = forwardRef<PreviewPaneHandle, Props>(function PreviewPane({ tabId, url, visible, onUrlChange, onTitleChange }, ref) {
  const addressRef = useRef<PreviewAddressBarHandle>(null);
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [device, setDevice] = useState<Device>(DEVICES[0]);

  const onEvent = (e: BrowserEvent) => {
    switch (e.kind) {
      case "navigated":
        onUrlChange(e.url);
        break;
      case "loading":
        setLoading(true);
        break;
      case "loaded":
        setLoading(false);
        break;
      case "title":
        if (e.title.trim()) onTitleChange?.(e.title.trim());
        break;
      case "newWindow":
        app().openPreview(e.url);
        break;
      case "downloadStarted":
        toast.info(`Downloading ${e.path.split(/[\\/]/).pop()}`);
        break;
      case "downloadFinished":
        if (e.success && e.path) {
          const path = e.path;
          toast.success(`Downloaded ${path.split(/[\\/]/).pop()}`, { action: { label: "Show in folder", onClick: () => void revealItemInDir(path).catch(() => {}) } });
        } else toast.error(`Download failed: ${e.url}`);
        break;
      case "blocked":
        toast.info(`The browser pane opens only web pages; ${e.url.split(":")[0]}: links were blocked.`, { action: { label: "Open outside Gear", onClick: () => void openUrl(e.url).catch(() => {}) } });
        break;
    }
  };

  const view = useNativeView({ tabId, url, visible, device, zoom, onEvent });

  useImperativeHandle(
    ref,
    () => ({
      reload: () => view.command("reload"),
      focusAddressBar: () => addressRef.current?.focus(),
      getUrl: () => url,
    }),
    [url, view.command],
  );

  return (
    <div
      data-browser-pane
      className="flex h-full w-full flex-col overflow-hidden rounded-md border border-border/60 bg-background"
      style={{ visibility: visible ? "visible" : "hidden", pointerEvents: visible ? "auto" : "none" }}
    >
      <PreviewAddressBar
        ref={addressRef}
        url={url}
        onSubmit={onUrlChange}
        onReload={() => view.command("reload")}
        nav={
          url
            ? {
                loading,
                onBack: () => view.command("back"),
                onForward: () => view.command("forward"),
                onStop: () => {
                  view.command("stop");
                  setLoading(false);
                },
                onDevtools: view.devtools,
                zoom,
                onZoom: setZoom,
                device,
                onDevice: setDevice,
              }
            : undefined
        }
      />
      <div className={cn("h-0.5 shrink-0 overflow-hidden", loading && "bg-primary/20")}>{loading && <div className="h-full w-1/3 animate-pulse bg-primary" data-browser-loading />}</div>
      <div className={cn("relative min-h-0 flex-1", device.width ? "bg-muted/40" : "bg-background")}>
        {/* The native view is placed over this element. */}
        <div ref={view.placeholderRef} className="absolute inset-0" data-browser-placeholder />
        {!url ? (
          <EmptyState />
        ) : view.error ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-[12px] text-red-500" data-browser-error>
            {view.error}
          </div>
        ) : view.suspended ? (
          <SuspendedState />
        ) : null}
      </div>
    </div>
  );
});

function SuspendedState() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
      <HugeiconsIcon icon={Globe02Icon} size={18} strokeWidth={1.5} />
      <p className="text-[11px]">Reloading the page…</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl border border-border/60 bg-card text-muted-foreground">
        <HugeiconsIcon icon={Globe02Icon} size={20} strokeWidth={1.5} />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">Nothing to show yet</p>
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
          Type an address above, or open the{" "}
          <span className="rounded bg-muted px-1 py-0.5 font-mono text-[10.5px]">Ports</span> menu to jump to a running dev server. Any site works here, signed-in pages included.
        </p>
      </div>
    </div>
  );
}
