// Palette commands for the database client.

import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { quickPick } from "@/modules/quick-pick";
import { statementAt } from "./model";
import { consolePath, useDbStore } from "./store";

function showView(): void {
  window.dispatchEvent(new CustomEvent("gear:show-database-panel"));
}

async function pickProfile(title: string): Promise<string | undefined> {
  const profiles = useDbStore.getState().profiles;
  if (!profiles.length) {
    showView();
    toast.info("Add a connection in the Database view first");
    return undefined;
  }
  if (profiles.length === 1) return profiles[0].id;
  return quickPick(profiles.map((p) => ({ label: p.name, description: p.kind, value: p.id })), { title });
}

async function newConsole(): Promise<void> {
  const id = await pickProfile("Open a SQL console for…");
  if (id) app().openFile(consolePath(id));
}

/** Send the selection (or the statement at the cursor) of a .sql file to a console and run it there. */
async function runSqlFromEditor(): Promise<void> {
  const ed = getActiveEditor();
  if (!ed) return void toast.info("Open a .sql file first");
  const sel = ed.view.state.selection.main;
  const text = sel.empty ? (statementAt(ed.view.state.doc.toString(), sel.head)?.text ?? "") : ed.view.state.sliceDoc(sel.from, sel.to);
  if (!text.trim()) return;
  const id = await pickProfile("Run against which connection?");
  if (!id) return;
  sessionStorage.setItem("gear-db-pending", JSON.stringify({ id, sql: text }));
  app().openFile(consolePath(id));
}

export const DATABASE_ACTIONS = [
  { id: "db.show", label: "Database: Show connections", keywords: ["database", "sql", "postgres", "mysql", "sqlite", "db", "tables"], run: showView },
  { id: "db.console", label: "Database: New SQL console…", keywords: ["database", "sql", "console", "query", "postgres", "mysql"], run: () => void newConsole() },
  { id: "db.runSelection", label: "Database: Run selected SQL against a connection…", keywords: ["sql", "run", "execute", "query", "selection", "database"], run: () => void runSqlFromEditor() },
];
