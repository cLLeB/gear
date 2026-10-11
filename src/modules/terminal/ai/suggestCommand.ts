// Natural language → one shell command (Warp's "#" / Copilot CLI "suggest"),
// inserted at the prompt for review rather than executed.

export interface ShellContext {
  os: "macOS" | "Linux" | "Windows";
  shell: string;
  cwd: string | null;
}

export const SUGGEST_SYSTEM_PROMPT =
  "You turn a request into exactly one shell command line. Reply with only the command — no markdown, no backticks, no explanation, no leading $. Prefer standard, widely available tools and safe, non-destructive flags. If several steps are needed, join them on one line with && (or ; in PowerShell). If the request is impossible or unsafe, reply with: # cannot: <short reason>";

export function buildSuggestPrompt(request: string, ctx: ShellContext): string {
  return [`OS: ${ctx.os}`, `Shell: ${ctx.shell}`, ctx.cwd ? `Working directory: ${ctx.cwd}` : null, `Request: ${request.trim()}`]
    .filter(Boolean)
    .join("\n");
}

/** Extract a single command from a model reply, tolerating fences and prompts. */
export function cleanSuggestedCommand(reply: string): { command: string } | { refusal: string } | null {
  let text = reply.trim();
  const fence = /```[\w-]*\n([\s\S]*?)```/.exec(text);
  if (fence) text = fence[1].trim();
  text = text.replace(/^`+|`+$/g, "").trim();
  const lines = text
    .split("\n")
    .map((l) => l.replace(/^\s*(?:\$|>|PS [^>]*>)\s+/, "").trimEnd())
    .filter((l) => l.trim() !== "");
  if (lines.length === 0) return null;
  const refusal = /^#\s*cannot:\s*(.+)$/i.exec(lines[0]);
  if (refusal) return { refusal: refusal[1] };
  // Join continuation lines; otherwise keep only the first command line.
  let command = lines[0];
  for (let i = 1; i < lines.length && /\\$/.test(command); i++) command = `${command.slice(0, -1).trimEnd()} ${lines[i].trim()}`;
  return command.startsWith("#") ? null : { command };
}

// ------------------------------------------------------------- action

import { app } from "@/app/appBridge";
import { IS_MAC, IS_WINDOWS } from "@/lib/platform";
import { generateOneShot, oneShotUnavailableReason } from "@/modules/ai/lib/oneShot";
import { inputBox, quickPick } from "@/modules/quick-pick";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { toast } from "sonner";
import { classifyCommand } from "../features/commandGuard";
import { guardedSubmit } from "../features/guardedSubmit";
import { writeTerminalClipboard } from "../lib/terminalClipboard";
import { isLeafCommandRunning, leafCwd, writeToSession } from "../lib/useTerminalSession";

export async function suggestCommandWithAi(): Promise<void> {
  const unavailable = oneShotUnavailableReason();
  if (unavailable) {
    toast.error("AI is not configured", { description: unavailable });
    return;
  }
  const request = await inputBox({
    title: "Describe a command",
    placeholder: "e.g. find files over 100MB changed this week",
    validate: (v) => (v.trim() ? null : "Describe what you want to do"),
  });
  if (!request) return;
  const leaf = app().activeTerminalLeaf();
  const shellPref = usePreferencesStore.getState().terminalShell;
  const ctx: ShellContext = {
    os: IS_WINDOWS ? "Windows" : IS_MAC ? "macOS" : "Linux",
    shell: shellPref ? shellPref.replace(/^.*[\\/]/, "").replace(/\.exe$/i, "") : IS_WINDOWS ? "powershell" : IS_MAC ? "zsh" : "bash",
    cwd: leaf !== null ? leafCwd(leaf) : app().activeCwd(),
  };
  let command = "";
  const choice = await quickPick(
    generateOneShot({ system: SUGGEST_SYSTEM_PROMPT, prompt: buildSuggestPrompt(request, ctx), temperature: 0.1 }).then((reply) => {
      const parsed = cleanSuggestedCommand(reply);
      if (!parsed) throw new Error("The model did not return a command. Try rephrasing.");
      if ("refusal" in parsed) throw new Error(`Declined: ${parsed.refusal}`);
      command = parsed.command;
      const risk = classifyCommand(command);
      const canUse = leaf !== null && !isLeafCommandRunning(leaf);
      return [
        ...(canUse ? [{ label: "Insert at prompt", description: command, detail: risk ? `⚠ ${risk.reason}` : undefined, value: "insert" as const }] : []),
        ...(canUse ? [{ label: "Run now", description: command, value: "run" as const }] : []),
        { label: "Copy to clipboard", description: command, value: "copy" as const },
      ];
    }),
    { title: request, placeholder: "Generating command…" },
  );
  if (!choice || !command) return;
  if (choice === "insert" && leaf !== null) writeToSession(leaf, command);
  else if (choice === "run" && leaf !== null) void guardedSubmit(leaf, command);
  else {
    await writeTerminalClipboard(command);
    toast.success("Copied", { description: command });
  }
}
