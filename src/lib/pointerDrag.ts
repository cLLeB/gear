// HTML5 drag-and-drop for Windows. With Tauri's native file-drop handling on,
// WebView2 starts a `draggable` element's drag but never delivers `dragover` or
// `drop` to the page, so every in-app drag (explorer rows, tabs, rebase rows)
// lands nowhere. This follows the pointer instead and dispatches the standard
// drag events with a real DataTransfer, so existing handlers work unchanged.

import { FS_PATHS_MIME, readFsPaths } from "./pathDrag";

const THRESHOLD_PX = 5;

export function exceedsDragThreshold(dx: number, dy: number): boolean {
  return dx * dx + dy * dy > THRESHOLD_PX * THRESHOLD_PX;
}

/** Text for the badge that follows the cursor. */
export function dragLabel(paths: readonly string[], fallback: string): string {
  if (paths.length > 1) return `${paths.length} items`;
  if (paths.length === 1) {
    const clean = paths[0].replace(/\\/g, "/").replace(/\/+$/, "");
    return clean.slice(clean.lastIndexOf("/") + 1) || clean;
  }
  const text = fallback.replace(/\s+/g, " ").trim();
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

type Point = { clientX: number; clientY: number };
type DragType = "dragstart" | "dragover" | "dragleave" | "drop" | "dragend";

function makeGhost(label: string): HTMLElement {
  const el = document.createElement("div");
  el.textContent = label;
  Object.assign(el.style, {
    position: "fixed",
    left: "0",
    top: "0",
    zIndex: "2147483647",
    pointerEvents: "none",
    padding: "2px 8px",
    borderRadius: "6px",
    font: "12px var(--font-sans, sans-serif)",
    color: "var(--popover-foreground)",
    background: "var(--popover)",
    border: "1px solid var(--border)",
    boxShadow: "0 4px 12px rgb(0 0 0 / 0.25)",
    whiteSpace: "nowrap",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(el);
  return el;
}

function track(source: Element, down: Point): void {
  const data = new DataTransfer();
  let ghost: HTMLElement | null = null;
  let over: Element | null = null;
  let accepted = false;
  let prevUserSelect = "";

  // dispatchEvent returns false when a handler called preventDefault, which is
  // how a drop target says it accepts the drag.
  const fire = (type: DragType, target: Element, at: Point, related?: Element | null): boolean =>
    !target.dispatchEvent(
      new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: at.clientX,
        clientY: at.clientY,
        dataTransfer: data,
        relatedTarget: related ?? null,
      }),
    );

  const stop = () => {
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointercancel", onCancel, true);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("blur", onCancel);
    if (!ghost) return;
    ghost.remove();
    ghost = null;
    document.body.style.userSelect = prevUserSelect;
    document.documentElement.style.cursor = "";
  };

  const finish = (at: Point, drop: boolean) => {
    const dragged = ghost !== null;
    if (dragged) {
      if (drop && over && accepted) fire("drop", over, at);
      else if (over) fire("dragleave", over, at, null);
      fire("dragend", source, at);
    }
    stop();
    return dragged;
  };

  const onMove = (e: PointerEvent) => {
    if (!ghost) {
      if (!exceedsDragThreshold(e.clientX - down.clientX, e.clientY - down.clientY)) return;
      // A handler that cancels dragstart is refusing the drag.
      if (fire("dragstart", source, down)) return stop();
      ghost = makeGhost(dragLabel(data.types.includes(FS_PATHS_MIME) ? readFsPaths(data) : [], source.textContent ?? ""));
      prevUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = "none";
      window.getSelection()?.removeAllRanges();
    }
    ghost.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 14}px)`;
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (target !== over) {
      if (over) fire("dragleave", over, e, target);
      over = target;
    }
    accepted = over ? fire("dragover", over, e) : false;
    document.documentElement.style.cursor = accepted ? "grabbing" : "no-drop";
  };

  const onUp = (e: PointerEvent) => {
    if (!finish(e, true)) return;
    // The release would otherwise click whatever the drag started on.
    const swallow = (c: MouseEvent) => {
      c.stopPropagation();
      c.preventDefault();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, true), 0);
  };

  const onCancel = () => void finish(down, false);

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !ghost) return;
    e.preventDefault();
    e.stopPropagation();
    onCancel();
  };

  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onCancel, true);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("blur", onCancel);
}

const draggableFrom = (target: EventTarget | null): Element | null =>
  target instanceof Element ? target.closest('[draggable="true"]') : null;

/** Call once at startup, on Windows only. */
export function installPointerDrag(): void {
  window.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0) return;
      const source = draggableFrom(e.target);
      if (!source) return;
      // A control inside the draggable (a tab's close button, a field) is
      // being pressed, not the draggable itself.
      const control = (e.target as Element).closest('[role="button"], button, input, textarea, select');
      if (control && control !== source && source.contains(control)) return;
      track(source, { clientX: e.clientX, clientY: e.clientY });
    },
    true,
  );
  // The browser's own drag would swallow the pointer and then go nowhere.
  window.addEventListener(
    "dragstart",
    (e) => {
      if (!e.isTrusted || !draggableFrom(e.target)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );
}
