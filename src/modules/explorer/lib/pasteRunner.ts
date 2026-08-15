import { invoke } from "@tauri-apps/api/core";
import { currentWorkspaceEnv } from "@/modules/workspace";
import type { ClipboardEntry } from "./clipboard";
import { type ClipboardContents, type PastePlan, planPaste } from "./paste";

/** Image types worth writing straight to disk, mapped to their extension. */
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
};

/** Absolute paths on the OS clipboard, or [] when it holds no files. */
async function readOsFiles(): Promise<string[]> {
  try {
    return await invoke<string[]>("clipboard_read_files");
  } catch (e) {
    // Not every platform can read a file list; that is a fallback, not a failure.
    console.debug("[gear] clipboard file read unavailable:", e);
    return [];
  }
}

async function readImageAndText(): Promise<
  Pick<ClipboardContents, "image" | "text">
> {
  let image: ClipboardContents["image"] = null;
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((t) => t in IMAGE_EXTENSIONS);
      if (!type) continue;
      const blob = await item.getType(type);
      image = {
        bytes: new Uint8Array(await blob.arrayBuffer()),
        ext: IMAGE_EXTENSIONS[type],
      };
      break;
    }
  } catch {
    // No permission or no rich clipboard support — fall through to text.
  }

  let text: string | null = null;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    text = null;
  }

  return { image, text };
}

/** Gathers everything the clipboard currently offers, in every supported form. */
export async function readClipboardContents(
  inApp: ClipboardEntry | null,
): Promise<ClipboardContents> {
  const [osFiles, rich] = await Promise.all([
    readOsFiles(),
    readImageAndText(),
  ]);
  return { osFiles, inApp, ...rich };
}

export type PasteResult =
  | { ok: true; written: string[]; op: PastePlan["op"] }
  | { ok: false; reason: string };

/** Carries out a plan. Pure decision-making already happened in `planPaste`. */
export async function executePaste(plan: PastePlan): Promise<PasteResult> {
  const workspace = currentWorkspaceEnv();
  try {
    switch (plan.op) {
      case "copy": {
        const written = await invoke<string[]>("fs_copy", {
          sources: plan.sources,
          destDir: plan.destDir,
          workspace,
        });
        return { ok: true, written, op: "copy" };
      }
      case "move": {
        const written = await invoke<string[]>("fs_move", {
          sources: plan.sources,
          destDir: plan.destDir,
          workspace,
        });
        return { ok: true, written, op: "move" };
      }
      case "write": {
        const path = await invoke<string>("fs_write_new", {
          destDir: plan.destDir,
          name: plan.name,
          // Tauri's IPC takes a plain number array, not a typed array.
          content: Array.from(plan.content),
          workspace,
        });
        return { ok: true, written: [path], op: "write" };
      }
      default:
        return { ok: false, reason: plan.reason };
    }
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

/** Reads the clipboard, plans, and runs — the whole paste in one call. */
export async function pasteInto(
  destDir: string,
  inApp: ClipboardEntry | null,
): Promise<PasteResult> {
  const contents = await readClipboardContents(inApp);
  return executePaste(planPaste(contents, destDir));
}
