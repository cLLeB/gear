// "Tell me when it's done": a desktop notification when a slow command
// finishes while you are looking elsewhere (iTerm2's "alert on next mark",
// Kitty's notify_on_cmd_finish, Warp's long-running command notifications).

import { humanizeDuration } from "@/lib/toolkit/humanizeDuration";

export interface NotifyContext {
  command: string;
  exitCode: number | null;
  durationMs: number | null;
  thresholdMs: number;
  /** Gear's window has OS focus. */
  windowFocused: boolean;
  /** The pane is in the active tab of the visible space. */
  paneVisible: boolean;
  /** Program names that never notify (interactive tools). */
  ignore: readonly string[];
}

/** The program a command line runs, skipping env assignments and wrappers. */
export function commandProgram(command: string): string | null {
  const WRAPPERS = new Set(["sudo", "doas", "time", "nice", "nohup", "env", "command", "exec", "caffeinate"]);
  const tokens = command.trim().split(/\s+/);
  for (const tok of tokens) {
    if (tok === "") continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) continue; // FOO=bar cmd
    if (tok.startsWith("-")) continue; // flags of a wrapper (`nice -n 5`)
    if (/^\d+$/.test(tok)) continue;
    const base = tok.replace(/^.*[\\/]/, "").replace(/\.exe$/i, "");
    if (WRAPPERS.has(base)) continue;
    return base;
  }
  return null;
}

export function shouldNotifyCommand(ctx: NotifyContext): boolean {
  if (ctx.durationMs === null || ctx.durationMs < ctx.thresholdMs) return false;
  if (ctx.windowFocused && ctx.paneVisible) return false;
  const program = commandProgram(ctx.command);
  if (!program) return false;
  return !ctx.ignore.includes(program);
}

export function formatCommandNotification(
  command: string,
  exitCode: number | null,
  durationMs: number,
): { title: string; body: string } {
  const ok = exitCode === 0 || exitCode === null;
  const took = humanizeDuration(durationMs);
  const short = command.length > 120 ? `${command.slice(0, 117)}…` : command;
  return {
    title: ok ? `Command finished · ${took}` : `Command failed (exit ${exitCode}) · ${took}`,
    body: short,
  };
}
