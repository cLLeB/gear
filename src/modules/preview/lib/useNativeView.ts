// One native browser view per tab: opened when the tab is first shown, kept
// exactly over its placeholder, hidden while the tab is in the background or
// an overlay (dialog, menu, palette) is open, and closed after a while in the
// background to give its memory back.

import { useCallback, useEffect, useRef, useState } from "react";
import { browser, browserKey, type BrowserEvent, type Bounds, type Device, deviceRect, onBrowserEvent, OVERLAY_SELECTOR, toWindowBounds, zoomFactor } from "./nativeBrowser";

const SUSPEND_AFTER_MS = 30_000;
const POLL_MS = 200;

export interface NativeViewOptions {
  tabId: number;
  url: string;
  visible: boolean;
  device: Device;
  zoom: number;
  onEvent: (e: BrowserEvent) => void;
}

/** Whether something that draws above the page is open, outside `pane`. */
function overlayOpen(pane: HTMLElement | null): boolean {
  for (const el of document.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR)) {
    if (pane?.contains(el)) continue;
    if (typeof el.checkVisibility === "function" ? el.checkVisibility() : el.offsetParent !== null) return true;
  }
  return false;
}

function boundsOf(el: HTMLElement, device: Device): Bounds | null {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  const factor = zoomFactor(window.innerWidth, document.documentElement.getBoundingClientRect().width);
  return toWindowBounds(deviceRect({ left: r.left, top: r.top, width: r.width, height: r.height }, device), factor);
}

const same = (a: Bounds | null, b: Bounds | null) => !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

export function useNativeView({ tabId, url, visible, device, zoom, onEvent }: NativeViewOptions) {
  const placeholderRef = useRef<HTMLDivElement>(null);
  const keyRef = useRef<string | null>(null);
  const currentUrl = useRef<string>("");
  const lastBounds = useRef<Bounds | null>(null);
  const shown = useRef(false);
  const [open, setOpen] = useState(false);
  const [suspended, setSuspended] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef({ device, zoom, onEvent, visible });
  live.current = { device, zoom, onEvent, visible };

  const setShown = useCallback((want: boolean) => {
    const key = keyRef.current;
    if (!key || shown.current === want) return;
    shown.current = want;
    void browser.setVisible(key, want).catch(() => {});
  }, []);

  /** Moves the view to its placeholder and decides whether it may show. */
  const sync = useCallback(() => {
    const key = keyRef.current;
    const el = placeholderRef.current;
    if (!key || !el) return;
    const b = boundsOf(el, live.current.device);
    if (b && !same(b, lastBounds.current)) {
      lastBounds.current = b;
      void browser.setBounds(key, b).catch(() => {});
    }
    setShown(live.current.visible && !!b && !overlayOpen(el.closest("[data-browser-pane]")));
  }, [setShown]);

  const close = useCallback(() => {
    const key = keyRef.current;
    keyRef.current = null;
    shown.current = false;
    lastBounds.current = null;
    setOpen(false);
    if (key) void browser.close(key).catch(() => {});
  }, []);

  // Open on first show (or after a suspension) once there is a URL.
  useEffect(() => {
    if (!visible || !url || keyRef.current) return;
    const el = placeholderRef.current;
    const b = el ? boundsOf(el, live.current.device) : null;
    if (!b) return;
    const key = browserKey(tabId);
    keyRef.current = key;
    currentUrl.current = url;
    lastBounds.current = b;
    shown.current = true;
    setSuspended(false);
    setError(null);
    browser
      .open(key, url, b)
      .then(() => {
        if (keyRef.current !== key) return void browser.close(key).catch(() => {});
        setOpen(true);
        if (live.current.zoom !== 1) void browser.setZoom(key, live.current.zoom).catch(() => {});
        sync();
      })
      .catch((e) => {
        if (keyRef.current === key) keyRef.current = null;
        setError(String(e));
      });
  }, [visible, url, tabId, sync]);

  // A new URL from the address bar (not one the page navigated to itself).
  useEffect(() => {
    const key = keyRef.current;
    if (!key || !url || url === currentUrl.current) return;
    currentUrl.current = url;
    void browser.navigate(key, url).catch((e) => setError(String(e)));
  }, [url]);

  useEffect(() => {
    const key = keyRef.current;
    if (key && open) void browser.setZoom(key, zoom).catch(() => {});
  }, [zoom, open]);

  // Follow layout and overlays: observers for immediate changes, a light poll for moves nothing reports.
  useEffect(() => {
    if (!open) return;
    sync();
    if (!visible) return;
    const ro = new ResizeObserver(sync);
    if (placeholderRef.current) ro.observe(placeholderRef.current);
    ro.observe(document.body);
    const mo = new MutationObserver(sync);
    mo.observe(document.body, { childList: true });
    window.addEventListener("resize", sync);
    const t = setInterval(sync, POLL_MS);
    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", sync);
      clearInterval(t);
    };
  }, [open, visible, device, sync]);

  // Background tabs: hide now, close after a while.
  useEffect(() => {
    if (visible) return;
    setShown(false);
    const t = setTimeout(() => {
      if (keyRef.current) {
        close();
        setSuspended(true);
      }
    }, SUSPEND_AFTER_MS);
    return () => clearTimeout(t);
  }, [visible, close, setShown]);

  // Events for this view; the page's own navigations update currentUrl first so they are not re-sent.
  useEffect(() => {
    const key = keyRef.current;
    if (!key || !open) return;
    return onBrowserEvent(key, (e) => {
      if (e.kind === "navigated") currentUrl.current = e.url;
      live.current.onEvent(e);
    });
  }, [open]);

  useEffect(() => close, [close]);

  const command = useCallback((c: "back" | "forward" | "reload" | "stop" | "hardReload") => {
    const key = keyRef.current;
    if (key) void browser.command(key, c).catch(() => {});
  }, []);
  const devtools = useCallback(() => {
    const key = keyRef.current;
    if (key) void browser.devtools(key).catch(() => {});
  }, []);

  return { placeholderRef, open, suspended, error, command, devtools, sync };
}
