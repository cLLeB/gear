// Clipboard history: text copied in Gear (editor, terminal, palette tools) is
// kept in memory, newest first, so it can be pasted again later.

const MAX = 50;
const MAX_LEN = 100_000;
let items: { text: string; at: number }[] = [];

export function recordClip(text: string, now = Date.now()): void {
  if (!text.trim() || text.length > MAX_LEN) return;
  items = [{ text, at: now }, ...items.filter((i) => i.text !== text)].slice(0, MAX);
}

export function clipHistory(): readonly { text: string; at: number }[] {
  return items;
}

export function clearClipHistory(): void {
  items = [];
}

let installed = false;

/** Also capture copies made with the native copy command (Ctrl/Cmd+C in the editor). */
export function installClipboardCapture(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  const capture = () => {
    const sel = document.getSelection()?.toString() ?? "";
    // CodeMirror puts its own text on the clipboard; read it from the event's selection.
    if (sel) recordClip(sel);
  };
  document.addEventListener("copy", capture, true);
  document.addEventListener("cut", capture, true);
}
