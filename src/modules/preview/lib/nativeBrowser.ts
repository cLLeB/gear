// The browser pane's native webview: commands, events, and the geometry
// that keeps the view exactly over its placeholder in the page.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type BrowserEvent =
  | { kind: "navigated"; key: string; url: string }
  | { kind: "loading"; key: string; url: string }
  | { kind: "loaded"; key: string; url: string }
  | { kind: "title"; key: string; title: string }
  | { kind: "newWindow"; key: string; url: string }
  | { kind: "downloadStarted"; key: string; url: string; path: string }
  | { kind: "downloadFinished"; key: string; url: string; path: string | null; success: boolean }
  | { kind: "blocked"; key: string; url: string }
  /** A Gear shortcut pressed while the page had focus, e.g. "mod+shift+p". */
  | { kind: "shortcut"; key: string; combo: string };

const KEY_NAMES: Record<string, string> = { tab: "Tab", arrowleft: "ArrowLeft", arrowright: "ArrowRight", arrowup: "ArrowUp", arrowdown: "ArrowDown", enter: "Enter" };

/** The keydown a forwarded combo stands for, to replay on Gear's own window. */
export function keyEventInit(combo: string, isMac: boolean): KeyboardEventInit {
  const parts = combo.split("+");
  // "mod+," splits into ["mod", ","]; a literal "+" key never appears in the allowlist.
  const key = parts[parts.length - 1];
  const has = (p: string) => parts.slice(0, -1).includes(p);
  const mod = has("mod");
  return {
    key: KEY_NAMES[key] ?? key,
    ctrlKey: has("ctrl") || (mod && !isMac),
    metaKey: mod && isMac,
    shiftKey: has("shift"),
    altKey: has("alt"),
    bubbles: true,
    cancelable: true,
  };
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Gear zooms its UI with CSS `zoom`. Window coordinates are the page's
 * coordinates times the ratio between the viewport and the root element's
 * reported width, which is right whether or not rects already include zoom.
 */
export function zoomFactor(innerWidth: number, rootWidth: number): number {
  if (!(innerWidth > 0) || !(rootWidth > 0)) return 1;
  const f = innerWidth / rootWidth;
  return Math.abs(f - 1) < 0.001 ? 1 : f;
}

export function toWindowBounds(rect: RectLike, factor: number): Bounds {
  const round = (n: number) => Math.round(n * 100) / 100;
  return { x: round(rect.left * factor), y: round(rect.top * factor), width: round(Math.max(1, rect.width * factor)), height: round(Math.max(1, rect.height * factor)) };
}

export interface Device {
  id: string;
  label: string;
  /** CSS pixels; null fills the pane. */
  width: number | null;
  height: number | null;
}

export const DEVICES: Device[] = [
  { id: "fill", label: "Fill the pane", width: null, height: null },
  { id: "phone", label: "Phone · 390 × 844", width: 390, height: 844 },
  { id: "phone-small", label: "Small phone · 360 × 740", width: 360, height: 740 },
  { id: "tablet", label: "Tablet · 820 × 1180", width: 820, height: 1180 },
  { id: "laptop", label: "Laptop · 1280 × 800", width: 1280, height: 800 },
];

/** The device frame centred inside the pane, shrunk to fit when the pane is smaller. */
export function deviceRect(pane: RectLike, device: Device): RectLike {
  if (device.width === null || device.height === null) return pane;
  const width = Math.min(device.width, pane.width);
  const height = Math.min(device.height, pane.height);
  return { left: pane.left + (pane.width - width) / 2, top: pane.top + (pane.height - height) / 2, width, height };
}

export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

/** Webview labels must be stable per open view and unique across reopenings. */
export function browserKey(tabId: number): string {
  return `t${tabId}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Elements that draw above the page and must not be hidden behind a native view. */
export const OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper], [cmdk-root]';

export const browser = {
  open: (key: string, url: string, bounds: Bounds) => invoke<void>("browser_open", { key, url, bounds }),
  setBounds: (key: string, bounds: Bounds) => invoke<void>("browser_set_bounds", { key, bounds }),
  setVisible: (key: string, visible: boolean) => invoke<void>("browser_set_visible", { key, visible }),
  navigate: (key: string, url: string) => invoke<void>("browser_navigate", { key, url }),
  command: (key: string, command: "back" | "forward" | "reload" | "stop" | "hardReload") => invoke<void>("browser_command", { key, command }),
  setZoom: (key: string, factor: number) => invoke<void>("browser_set_zoom", { key, factor }),
  devtools: (key: string) => invoke<void>("browser_devtools", { key }),
  close: (key: string) => invoke<void>("browser_close", { key }),
};

const handlers = new Map<string, (e: BrowserEvent) => void>();
let unlisten: Promise<UnlistenFn> | null = null;

/** Routes backend events to the view with that key; one listener for all views. */
export function onBrowserEvent(key: string, handler: (e: BrowserEvent) => void): () => void {
  handlers.set(key, handler);
  unlisten ??= listen<BrowserEvent>("browser:event", (e) => handlers.get(e.payload.key)?.(e.payload));
  return () => {
    handlers.delete(key);
  };
}
