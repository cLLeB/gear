import type { ClipboardMode } from "./clipboard";

/**
 * What the clipboard turned out to hold. Gathered by the caller (which needs
 * Tauri and the DOM); resolving it into an action is pure, and lives here.
 */
export type ClipboardContents = {
  /** Absolute paths from the OS clipboard — Explorer/Finder copied files. */
  osFiles: readonly string[];
  /** Gear's own copy/cut register, if the user copied inside the tree. */
  inApp: { paths: readonly string[]; mode: ClipboardMode } | null;
  /** Raw image bytes, when the clipboard holds a picture rather than files. */
  image: { bytes: Uint8Array; ext: string } | null;
  /** Plain clipboard text. */
  text: string | null;
};

export type PastePlan =
  | { op: "copy"; sources: string[]; destDir: string }
  | { op: "move"; sources: string[]; destDir: string }
  | { op: "write"; destDir: string; name: string; content: Uint8Array }
  | { op: "none"; reason: string };

/** `2026-08-15 17-42-08`, safe as a file name on every platform. */
export function timestampName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  const time = `${p(now.getHours())}-${p(now.getMinutes())}-${p(now.getSeconds())}`;
  return `${date} ${time}`;
}

/** True when `dest` is `dir` itself or nested inside it. */
export function isInside(dest: string, dir: string): boolean {
  if (dest === dir) return true;
  const sep = dir.includes("\\") ? "\\" : "/";
  return dest.startsWith(`${dir}/`) || dest.startsWith(dir + sep);
}

const encoder = new TextEncoder();

/**
 * Decides what a paste into `destDir` should do.
 *
 * Order matters: files win over text, because copying a file in Explorer also
 * puts its *name* on the clipboard as text, and writing a text file containing
 * the file name is never what the user meant. Gear's own register only applies
 * when the OS clipboard has no files, so copying a file in Explorer after
 * cutting one in Gear does the obvious thing.
 */
export function planPaste(
  contents: ClipboardContents,
  destDir: string,
  now: Date = new Date(),
): PastePlan {
  if (!destDir) return { op: "none", reason: "No folder selected" };

  const fromOs = contents.osFiles.length > 0;
  const sources = fromOs ? [...contents.osFiles] : [...(contents.inApp?.paths ?? [])];

  if (sources.length > 0) {
    // A directory cannot be pasted into itself or its own subtree — that
    // recurses until the disk fills.
    const recursive = sources.filter((s) => isInside(destDir, s));
    if (recursive.length > 0) {
      return {
        op: "none",
        reason: `Cannot paste ${basename(recursive[0])} into itself`,
      };
    }
    // The OS clipboard carries no portable cut/copy intent, so anything coming
    // from it is a copy; only Gear's own register can mean "move".
    const mode: ClipboardMode = fromOs ? "copy" : (contents.inApp?.mode ?? "copy");
    return mode === "cut"
      ? { op: "move", sources, destDir }
      : { op: "copy", sources, destDir };
  }

  if (contents.image) {
    return {
      op: "write",
      destDir,
      name: `Pasted image ${timestampName(now)}.${contents.image.ext}`,
      content: contents.image.bytes,
    };
  }

  if (contents.text && contents.text.length > 0) {
    return {
      op: "write",
      destDir,
      name: `Pasted text ${timestampName(now)}.txt`,
      content: encoder.encode(contents.text),
    };
  }

  return { op: "none", reason: "Clipboard is empty" };
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}
