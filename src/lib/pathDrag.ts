// Payload for in-app drags of filesystem paths (Gear's sidebar explorer →
// terminal pane). Distinct from Tauri's OS-level file drop, which arrives via
// `onDragDropEvent`; this rides the browser's HTML5 DataTransfer and never
// leaves the webview.
export const FS_PATHS_MIME = "application/x-gear-fs-paths";

export function writeFsPaths(dt: DataTransfer, paths: readonly string[]): void {
  const clean = paths.filter((p) => typeof p === "string" && p.length > 0);
  if (!clean.length) return;
  dt.setData(FS_PATHS_MIME, JSON.stringify(clean));
  // Plain-text fallback so the drag still means something outside a pane.
  dt.setData("text/plain", clean.join(" "));
  dt.effectAllowed = "copy";
}

export function dragHasFsPaths(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types).includes(FS_PATHS_MIME);
}

export function readFsPaths(dt: DataTransfer): string[] {
  const raw = dt.getData(FS_PATHS_MIME);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((p): p is string => typeof p === "string" && p.length > 0)
      : [];
  } catch {
    return [];
  }
}
