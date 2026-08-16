/**
 * Pure decisions the run executor needs: which terminal hosts the run, and
 * what gets typed into it. Kept free of React and of the PTY so the reuse,
 * working-directory and environment rules are testable on their own.
 */

import { quoteShellPath } from "@/modules/terminal/lib/quoteShellPath";
import type { Tab, TerminalTab } from "@/modules/tabs";
import type { RunSpec, ShellDialect } from "./types";

export type RunTargetPlan = {
  tabs: Tab[];
  tabId: number;
  leafId: number;
  /** True when the terminal was just created and has no shell yet. */
  created: boolean;
};

const isRunTerminal = (tab: Tab, spaceId: string): tab is TerminalTab =>
  tab.kind === "terminal" && tab.run === true && tab.spaceId === spaceId;

/**
 * Find this space's run terminal, or lay out a new one. Runs never borrow an
 * ordinary terminal: the user's own shell keeps its history and its foreground
 * process, and a re-run always knows exactly which shell to interrupt.
 */
export function planRunTarget(
  tabs: Tab[],
  spaceId: string,
  allocId: () => number,
  spec: RunSpec,
): RunTargetPlan {
  const existing = tabs.find((tab) => isRunTerminal(tab, spaceId));
  if (existing) {
    const target = existing as TerminalTab;
    // A restored tab is cold until activated; running is an activation.
    const tabsOut = target.cold
      ? tabs.map((tab) => {
          if (tab.id !== target.id) return tab;
          const { cold: _cold, ...warm } = tab as TerminalTab;
          return warm as Tab;
        })
      : tabs;
    return {
      tabs: tabsOut,
      tabId: target.id,
      leafId: target.activeLeafId,
      created: false,
    };
  }

  const tabId = allocId();
  const leafId = allocId();
  const tab = {
    id: tabId,
    kind: "terminal",
    spaceId,
    title: "Run",
    run: true,
    cwd: spec.cwd,
    paneTree: { kind: "leaf", id: leafId, cwd: spec.cwd },
    activeLeafId: leafId,
  } satisfies TerminalTab & { spaceId: string };

  return { tabs: [...tabs, tab], tabId, leafId, created: true };
}

/**
 * Which syntax a shell wants for `set VAR`. Matched on the executable name so
 * a directory that merely contains "cmd" cannot flip the dialect.
 */
export function shellDialect(shellPath: string | null): ShellDialect {
  if (!shellPath) return "posix";
  const exe = shellPath
    .replace(/\\/g, "/")
    .split("/")
    .pop()!
    .toLowerCase()
    .replace(/\.exe$/, "");
  if (exe === "powershell" || exe === "pwsh") return "powershell";
  if (exe === "cmd") return "cmd";
  return "posix";
}

function envLine(name: string, value: string, dialect: ShellDialect): string {
  switch (dialect) {
    case "powershell":
      return `$env:${name} = '${value.replace(/'/g, "''")}'`;
    // cmd has no reliable quoting for `set`; the value runs to end of line,
    // which is why project-supplied env is gated behind workspace trust.
    case "cmd":
      return `set ${name}=${value}`;
    default:
      return `export ${name}='${value.replace(/'/g, `'\\''`)}'`;
  }
}

function sameDir(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  return norm(a) === norm(b);
}

/**
 * The lines to submit, in order: cd, then environment, then the command. Each
 * is its own submission rather than a `&&` chain, because that separator
 * differs across bash, PowerShell 5 and cmd.
 */
export function planRunSubmission(
  spec: RunSpec,
  currentCwd: string | null,
  dialect: ShellDialect = "posix",
): string[] {
  const lines: string[] = [];
  if (currentCwd === null || !sameDir(currentCwd, spec.cwd)) {
    lines.push(`cd ${quoteShellPath(spec.cwd)}`);
  }
  // Sorted so a re-run produces byte-identical output and diffs stay readable.
  for (const name of Object.keys(spec.env).sort()) {
    lines.push(envLine(name, spec.env[name], dialect));
  }
  lines.push(spec.command);
  return lines;
}
