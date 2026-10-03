// Picking, filling in and running workflows.

import { app } from "@/app/appBridge";
import { IS_MAC, IS_WINDOWS } from "@/lib/platform";
import { native } from "@/modules/ai/lib/native";
import { inputBox, quickPick } from "@/modules/quick-pick";
import { toast } from "sonner";
import { writeTerminalClipboard } from "../lib/terminalClipboard";
import {
  isLeafCommandRunning,
  lastFinishedCommand,
  submitToLeaf,
  writeToSession,
} from "../lib/useTerminalSession";
import { BUILTIN_WORKFLOWS, type Platform, type Workflow } from "./library";
import {
  availableOn,
  loadUserWorkflows,
  parseProjectWorkflows,
  PROJECT_WORKFLOWS_FILE,
  saveUserWorkflows,
} from "./sources";
import { paramLabel, parseTemplate, renderTemplate } from "./template";

const PLATFORM: Platform = IS_WINDOWS ? "windows" : IS_MAC ? "mac" : "linux";

async function loadProjectWorkflows(): Promise<Workflow[]> {
  const root = app().workspaceRoot();
  if (!root) return [];
  try {
    const res = await native.readFile(`${root.replace(/[\\/]+$/, "")}/${PROJECT_WORKFLOWS_FILE}`);
    if (res.kind !== "text") return [];
    const { workflows, errors } = parseProjectWorkflows(res.content);
    if (errors.length > 0) {
      toast.warning(`${PROJECT_WORKFLOWS_FILE}: ${errors.length} problem${errors.length === 1 ? "" : "s"}`, {
        description: errors.slice(0, 3).join("\n"),
      });
    }
    return workflows;
  } catch {
    return []; // no project file
  }
}

async function allWorkflows(): Promise<Workflow[]> {
  const project = await loadProjectWorkflows();
  return [...project, ...loadUserWorkflows(), ...BUILTIN_WORKFLOWS].filter((w) => availableOn(w, PLATFORM));
}

const GROUP: Record<Workflow["source"], string> = {
  project: "This project",
  user: "Saved by you",
  builtin: "Library",
};

/** Ask for each template parameter; undefined when the user cancels. */
export async function fillParameters(command: string): Promise<string | undefined> {
  const values: Record<string, string> = {};
  for (const p of parseTemplate(command)) {
    let value: string | undefined;
    if (p.choices) {
      value = await quickPick(
        p.choices.map((c) => ({ label: c, value: c })),
        { title: paramLabel(p.name), placeholder: `Choose ${paramLabel(p.name).toLowerCase()}` },
      );
    } else {
      value = await inputBox({
        title: paramLabel(p.name),
        value: p.defaultValue ?? "",
        prompt: renderTemplate(command, values),
        validate: (v) => (v.trim() === "" && p.defaultValue === null ? "A value is required" : null),
      });
    }
    if (value === undefined) return undefined;
    values[p.name] = value;
  }
  return renderTemplate(command, values);
}

export async function runWorkflow(): Promise<void> {
  const wf = await quickPick(
    allWorkflows().then((list) =>
      list.map((w) => ({
        label: w.name,
        description: w.tags?.join(" · "),
        detail: w.command,
        keywords: [...(w.tags ?? []), w.command, w.description ?? ""],
        group: GROUP[w.source],
        value: w,
      })),
    ),
    { title: "Workflows", placeholder: "Search workflows…" },
  );
  if (!wf) return;
  const command = await fillParameters(wf.command);
  if (command === undefined) return;

  const leaf = app().activeTerminalLeaf();
  const canRun = leaf !== null && !isLeafCommandRunning(leaf);
  const action = await quickPick(
    [
      ...(canRun ? [{ label: "Insert at prompt", detail: "Review before pressing Enter", value: "insert" as const }] : []),
      ...(canRun ? [{ label: "Run now", value: "run" as const }] : []),
      { label: "Run in a new tab", value: "tab" as const },
      { label: "Copy to clipboard", value: "copy" as const },
    ],
    { title: command, placeholder: "What should happen with this command?" },
  );
  if (!action) return;
  if (action === "insert" && leaf !== null) writeToSession(leaf, command);
  else if (action === "run" && leaf !== null) submitToLeaf(leaf, command);
  else if (action === "tab") app().openTerminal({ command });
  else if (action === "copy") {
    await writeTerminalClipboard(command);
    toast.success("Copied", { description: command });
  }
}

export async function saveLastCommandAsWorkflow(): Promise<void> {
  const leaf = app().activeTerminalLeaf();
  const last = leaf !== null ? lastFinishedCommand(leaf) : null;
  const command = await inputBox({
    title: "Save workflow — command",
    value: last?.command ?? "",
    prompt: "Use {{name}}, {{name:default}} or {{name|a|b}} for parameters",
    validate: (v) => (v.trim() ? null : "Enter a command"),
  });
  if (!command) return;
  const name = await inputBox({
    title: "Save workflow — name",
    placeholder: "e.g. Deploy to staging",
    validate: (v) => (v.trim() ? null : "Enter a name"),
  });
  if (!name) return;
  const list = loadUserWorkflows();
  list.unshift({ id: `user:${Date.now()}`, name: name.trim(), command: command.trim(), source: "user" });
  saveUserWorkflows(list);
  toast.success("Workflow saved", { description: name });
}

export async function deleteSavedWorkflow(): Promise<void> {
  const list = loadUserWorkflows();
  if (list.length === 0) {
    toast.info("You have no saved workflows");
    return;
  }
  const id = await quickPick(
    list.map((w) => ({ label: w.name, detail: w.command, value: w.id })),
    { title: "Delete saved workflow" },
  );
  if (!id) return;
  saveUserWorkflows(list.filter((w) => w.id !== id));
  toast.success("Workflow deleted");
}
