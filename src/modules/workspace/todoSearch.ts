// Workspace TODO list: ripgrep for tags, keep only real comment markers,
// rank by urgency and open the chosen one.

import { app } from "@/app/appBridge";
import { native } from "@/modules/ai/lib/native";
import { quickPick } from "@/modules/quick-pick";
import { parseTodo, todoRank, TODO_GREP_PATTERN } from "@/modules/editor/lib/textTools/todos";
import { toast } from "sonner";

export async function listWorkspaceTodos(): Promise<void> {
  const root = app().workspaceRoot();
  if (!root) {
    toast.error("Open a folder first");
    return;
  }
  const load = native.grep({ pattern: TODO_GREP_PATTERN, root, maxResults: 3000 }).then((res) => {
    const items = res.hits
      .map((h) => ({ h, todo: parseTodo(h.text) }))
      .filter((x): x is { h: typeof x.h; todo: NonNullable<typeof x.todo> } => x.todo !== null)
      .sort((a, b) => todoRank(a.todo.tag) - todoRank(b.todo.tag) || a.h.rel.localeCompare(b.h.rel) || a.h.line - b.h.line)
      .map(({ h, todo }) => ({
        label: todo.text || "(no description)",
        description: `${h.rel}:${h.line}`,
        detail: todo.owner ? `${todo.tag} · ${todo.owner}` : undefined,
        group: todo.tag,
        keywords: [todo.tag, todo.owner ?? "", h.rel],
        value: h,
      }));
    if (res.truncated) toast.info("Showing the first matches only", { description: "The workspace has more TODO markers than the search limit." });
    return items;
  });
  const hit = await quickPick(load, {
    title: "TODOs in workspace",
    placeholder: "Filter by text, tag, owner or file…",
    emptyText: "No TODO, FIXME, HACK, BUG, XXX or NOTE comments found",
  });
  if (hit) app().openFile(hit.path, hit.line);
}
