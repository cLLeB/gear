import { recordClip } from "@/modules/clipboard/history";
// WebKitGTK can't read external copies, so the native plugin is Linux-only and
// lazy-loaded to keep it out of the mac/win bundle.
const IS_LINUX =
  typeof navigator !== "undefined" &&
  /Linux/.test(navigator.userAgent) &&
  !/Android/.test(navigator.userAgent);

function webClipboard(): Clipboard | null {
  if (typeof navigator === "undefined") return null;
  return navigator.clipboard ?? null;
}

export async function readTerminalClipboard(): Promise<string> {
  if (IS_LINUX) {
    try {
      const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
      return await readText();
    } catch {}
  }
  try {
    return (await webClipboard()?.readText()) ?? "";
  } catch {
    return "";
  }
}

export async function writeTerminalClipboard(text: string): Promise<void> {
  recordClip(text);
  if (IS_LINUX) {
    try {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(text);
      return;
    } catch {}
  }
  try {
    await webClipboard()?.writeText(text);
  } catch {}
}

/**
 * When a paste finds no text, what the clipboard holds instead as local file
 * paths: files copied in a file manager, else an image (a screenshot) saved to
 * a temp PNG. Terminal apps like Claude Code attach a pasted image path, so
 * this is how a screenshot reaches them. Empty when there is nothing usable.
 */
export async function readClipboardAttachmentPaths(): Promise<string[]> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const files = await invoke<string[]>("clipboard_read_files").catch(() => []);
    if (files.length) return files;
    const image = await invoke<string | null>("clipboard_save_image");
    return image ? [image] : [];
  } catch {
    return [];
  }
}
