/**
 * Drives the blame gutter: resolves which repository the open file belongs to,
 * loads blame for it, and installs the result into editor state. Toggling off
 * clears the field, which collapses the gutter.
 */

import type { EditorView } from "@codemirror/view";
import { toast } from "sonner";
import { native } from "@/modules/ai/lib/native";
import { isBlameVisible, setBlame } from "./blameGutter";

function parentDir(path: string): string {
  const normalized = path.replace(/[\\/]+/g, "/");
  const cut = normalized.lastIndexOf("/");
  return cut <= 0 ? normalized : normalized.slice(0, cut);
}

export async function toggleBlameOnView(
  view: EditorView,
  path: string,
): Promise<void> {
  if (isBlameVisible(view)) {
    view.dispatch({ effects: setBlame.of(null) });
    return;
  }
  if (!path) {
    toast.error("Blame needs a saved file");
    return;
  }
  try {
    const repo = await native.gitResolveRepo(parentDir(path));
    if (!repo) {
      toast.error("Not inside a git repository");
      return;
    }
    const blame = await native.gitBlame(repo.repoRoot, path);
    // The pane can be torn down, or switched to another file, while the blame
    // walk is in flight.
    if (!view.dom.isConnected) return;
    if (blame.lines.length === 0) {
      toast("No blame for this file", {
        description: "It has no committed history yet.",
      });
      return;
    }
    view.dispatch({ effects: setBlame.of(blame) });
  } catch (error) {
    toast.error("Could not load blame", {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}
