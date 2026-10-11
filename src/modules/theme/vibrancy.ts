import { invoke } from "@tauri-apps/api/core";

/** Mirrors `Backdrop` in `src-tauri/src/modules/vibrancy.rs`. */
export type Backdrop = "vibrancy" | "mica" | "none";

let kindPromise: Promise<Backdrop> | null = null;

export function getBackdropKind(): Promise<Backdrop> {
  kindPromise ??= invoke<Backdrop>("window_backdrop_kind").catch(
    () => "none" as const,
  );
  return kindPromise;
}

/** Identifies the native state a request maps to. Mica tints its own backdrop
 * and cannot read the webview theme, so it has to be rebuilt on a mode flip;
 * NSVisualEffectView adapts on its own. */
export function backdropKey(
  kind: Backdrop,
  enabled: boolean,
  dark: boolean,
): string {
  if (!enabled || kind === "none") return "off";
  return kind === "mica" ? `on:${dark ? "dark" : "light"}` : "on";
}

/** Last state handed to the native side. Repeating it would rebuild the
 * effect view for nothing. */
let applied: string | null = null;
let queue: Promise<void> = Promise.resolve();

/** Serialized: two in-flight toggles could otherwise land out of order. */
export function applyVibrancy(enabled: boolean, dark: boolean): Promise<void> {
  queue = queue.then(() => run(enabled, dark));
  return queue;
}

async function run(enabled: boolean, dark: boolean): Promise<void> {
  const kind = await getBackdropKind();
  const key = backdropKey(kind, enabled, dark);
  const on = key !== "off";
  const root = document.documentElement;

  const paintOpaque = () => {
    root.removeAttribute("data-vibrancy");
    root.style.backgroundColor = "var(--background)";
  };

  if (on) {
    root.setAttribute("data-vibrancy", kind);
    // The pre-paint colour parked on <html> sits in front of the backdrop.
    root.style.backgroundColor = "";
  } else {
    paintOpaque();
  }

  // Nothing native to undo if the backdrop was never turned on.
  if (key === applied || (!on && applied === null)) return;

  try {
    await invoke("window_set_backdrop", { enabled: on, dark });
    applied = key;
  } catch {
    // Never leave the webview transparent over nothing.
    paintOpaque();
    applied = null;
  }
}
