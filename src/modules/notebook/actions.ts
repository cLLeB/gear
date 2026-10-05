// Palette commands for notebooks.

import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { native } from "@/modules/ai/lib/native";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { inputBox } from "@/modules/quick-pick";
import { emptyNotebook, serializeNotebook } from "./model";

async function newNotebook(): Promise<void> {
  const dir = getActiveEditor()?.path?.replace(/[\\/][^\\/]*$/, "") ?? app().workspaceRoot()?.replace(/[\\/]+$/, "");
  if (!dir) return void toast.error("Open a folder first");
  const name = await inputBox({ title: "New notebook", value: "Untitled.ipynb" });
  if (!name) return;
  const file = `${dir}/${/\.ipynb$/i.test(name) ? name : `${name}.ipynb`}`;
  const existing = await native.readFile(file).catch(() => null);
  if (existing) return void toast.error(`${file.replace(/^.*\//, "")} already exists`);
  await native.writeFile(file, serializeNotebook(emptyNotebook()), "user");
  app().openFile(file);
}

export const NOTEBOOK_ACTIONS = [
  { id: "notebook.new", label: "Notebook: New Jupyter notebook…", keywords: ["jupyter", "notebook", "ipynb", "python", "data science", "new"], run: () => void newNotebook() },
];
