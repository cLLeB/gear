// "Ask AI why this failed" for the last command in a pane (Warp's error
// block "Ask Warp AI"). Builds a redacted, size-bounded context block and a
// prompt, then hands both to the agent composer for the user to send.

import { redactSensitive } from "@/modules/ai/lib/redact";
import { humanizeDuration } from "@/lib/toolkit/humanizeDuration";

export interface FailureContext {
  command: string;
  exitCode: number | null;
  durationMs: number | null;
  output: string | null;
  cwd: string | null;
}

const MAX_LINES = 150;
const MAX_CHARS = 12_000;

/** Keep the tail of the output (where errors usually are), with a marker. */
export function tailOutput(output: string, maxLines = MAX_LINES, maxChars = MAX_CHARS): string {
  let lines = output.split("\n");
  let cut = false;
  if (lines.length > maxLines) {
    lines = lines.slice(-maxLines);
    cut = true;
  }
  let text = lines.join("\n");
  if (text.length > maxChars) {
    text = text.slice(-maxChars);
    cut = true;
  }
  return cut ? `[… earlier output omitted …]\n${text}` : text;
}

export function buildFailureContext(ctx: FailureContext): string {
  const meta = [
    `$ ${ctx.command}`,
    `exit code: ${ctx.exitCode ?? "unknown"}`,
    ctx.durationMs !== null ? `duration: ${humanizeDuration(ctx.durationMs)}` : null,
    ctx.cwd ? `cwd: ${ctx.cwd}` : null,
  ].filter(Boolean);
  const out = ctx.output?.trim() ? tailOutput(ctx.output.trim()) : "(no output)";
  return redactSensitive(`${meta.join("\n")}\n\n${out}`);
}

export function failurePrompt(ctx: FailureContext): string {
  return ctx.exitCode === 0
    ? "Explain what this command did and anything noteworthy in its output."
    : "This command failed. Explain the root cause from the output, then give the exact command(s) or code change to fix it.";
}

// ------------------------------------------------------------- action

import { app } from "@/app/appBridge";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { toast } from "sonner";
import { lastFinishedCommand } from "../lib/useTerminalSession";

export function explainLastCommandWithAi(): void {
  const leaf = app().activeTerminalLeaf();
  if (leaf === null) {
    toast.error("Focus a terminal first");
    return;
  }
  const tab = app().tabs().find((t) => t.id === app().activeTabId());
  if (tab?.kind === "terminal" && tab.private) {
    toast.error("This is a private terminal", { description: "Its output is never shared with AI." });
    return;
  }
  const last = lastFinishedCommand(leaf);
  if (!last) {
    toast.error("No finished command yet", { description: "Gear tracks commands through shell integration (OSC 133)." });
    return;
  }
  const ctx = { command: last.command, exitCode: last.exitCode, durationMs: last.durationMs, output: last.output, cwd: last.cwd };
  const chat = useChatStore.getState();
  chat.attachSelection(buildFailureContext(ctx), "terminal");
  chat.focusInput(failurePrompt(ctx));
}
