// Palette commands and shortcut handlers for the debugger.

import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { native } from "@/modules/ai/lib/native";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { LAUNCH_JSON_TEMPLATE } from "./launchConfig";
import {
  activeEntry,
  availableAdapters,
  debugCommand,
  removeAllBreakpoints,
  restartDebugging,
  runToLine,
  startOrContinue,
  stopDebugging,
  toggleBreakpoint,
  upsertBreakpoint,
  breakpointsIn,
} from "./store";
import { ADAPTERS, type AdapterKind } from "./launchConfig";
import { inputBox, quickPick } from "@/modules/quick-pick";

export async function openLaunchJson(): Promise<void> {
  const root = app().workspaceRoot()?.replace(/[\\/]+$/, "");
  if (!root) return void toast.error("Open a folder first");
  const path = `${root}/.vscode/launch.json`;
  const existing = await native.readFile(path).catch(() => null);
  if (existing?.kind !== "text") {
    await native.createDir(`${root}/.vscode`).catch(() => {});
    await native.writeFile(path, LAUNCH_JSON_TEMPLATE, "user");
  }
  app().openFile(path);
}

function cursor(): { path: string; line: number } | null {
  const ed = getActiveEditor();
  if (!ed?.path) {
    toast.info("Put the cursor in a file");
    return null;
  }
  return { path: ed.path, line: ed.view.state.doc.lineAt(ed.view.state.selection.main.head).number };
}

export function toggleBreakpointAtCursor(): void {
  const c = cursor();
  if (c) toggleBreakpoint(c.path, c.line);
}

async function conditionalAtCursor(kind: "condition" | "log"): Promise<void> {
  const c = cursor();
  if (!c) return;
  const prev = breakpointsIn(c.path).find((b) => b.line === c.line);
  const v = await inputBox(
    kind === "condition"
      ? { title: `Break at line ${c.line} when`, placeholder: "i > 10", value: prev?.condition ?? "" }
      : { title: `Log at line ${c.line} ({expr} is interpolated)`, placeholder: "x={x}", value: prev?.logMessage ?? "" },
  );
  if (v === undefined || !v.trim()) return;
  upsertBreakpoint(c.path, { ...(prev ?? { line: c.line, enabled: true }), enabled: true, ...(kind === "condition" ? { condition: v.trim() } : { logMessage: v.trim() }) });
}

export function isPaused(): boolean {
  return activeEntry()?.state.status === "stopped";
}

export function isDebugging(): boolean {
  const e = activeEntry();
  return !!e && e.state.status !== "ended";
}

async function adapterStatus(): Promise<void> {
  const have = await availableAdapters();
  await quickPick(
    (Object.keys(ADAPTERS) as AdapterKind[]).map((k) => ({ label: `${have.has(k) ? "✓" : "✗"} ${ADAPTERS[k].label}`, description: have.has(k) ? "installed" : ADAPTERS[k].install, value: k })),
    { title: "Debug adapters" },
  );
}

export const DEBUG_ACTIONS = [
  { id: "debug.start", label: "Debug: Start / continue", keywords: ["debug", "start", "launch", "run", "f5", "breakpoint", "debugger"], run: () => void startOrContinue() },
  { id: "debug.stop", label: "Debug: Stop", keywords: ["debug", "stop", "terminate", "kill"], run: () => void stopDebugging() },
  { id: "debug.restart", label: "Debug: Restart", keywords: ["debug", "restart", "relaunch"], run: () => void restartDebugging() },
  { id: "debug.pause", label: "Debug: Pause", keywords: ["debug", "pause", "break"], run: () => void debugCommand.pause() },
  { id: "debug.stepOver", label: "Debug: Step over", keywords: ["debug", "step", "next", "over", "f10"], run: () => void debugCommand.next() },
  { id: "debug.stepInto", label: "Debug: Step into", keywords: ["debug", "step", "into", "f11"], run: () => void debugCommand.stepIn() },
  { id: "debug.stepOut", label: "Debug: Step out", keywords: ["debug", "step", "out", "return"], run: () => void debugCommand.stepOut() },
  { id: "debug.toggleBreakpoint", label: "Debug: Toggle breakpoint", keywords: ["breakpoint", "toggle", "f9", "debug"], run: toggleBreakpointAtCursor },
  { id: "debug.conditionalBreakpoint", label: "Debug: Add conditional breakpoint…", keywords: ["breakpoint", "condition", "when", "debug"], run: () => void conditionalAtCursor("condition") },
  { id: "debug.logpoint", label: "Debug: Add logpoint…", keywords: ["logpoint", "tracepoint", "log", "printf", "debug"], run: () => void conditionalAtCursor("log") },
  { id: "debug.runToCursor", label: "Debug: Run to cursor", keywords: ["run to cursor", "continue to", "debug"], run: () => {
    const c = cursor();
    if (c) void runToLine(c.path, c.line);
  } },
  { id: "debug.removeAllBreakpoints", label: "Debug: Remove all breakpoints", keywords: ["breakpoints", "clear", "remove", "debug"], run: removeAllBreakpoints },
  { id: "debug.launchJson", label: "Debug: Open launch.json", keywords: ["launch.json", "configuration", "debug", "vscode"], run: () => void openLaunchJson() },
  { id: "debug.showView", label: "Debug: Show Run and Debug view", keywords: ["debug", "panel", "view", "variables", "call stack"], run: () => window.dispatchEvent(new CustomEvent("gear:show-debug-panel")) },
  { id: "debug.adapters", label: "Debug: Installed debug adapters", keywords: ["debugpy", "delve", "dlv", "lldb", "gdb", "js-debug", "adapter", "install"], run: () => void adapterStatus() },
];
