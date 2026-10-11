// Pure helpers for the terminal extras: a searchable output history per pane,
// pane rotation, kubectl / ps parsing, schedules and toolchain activation.

import type { PaneNode } from "../lib/panes";

// ── output history (all panes, including hidden ones) ─────────────────────

export class OutputRing {
  private lines: string[] = [];
  private start = 0; // number of lines dropped so far (for stable numbering)
  constructor(private readonly max = 5000) {}

  push(lines: readonly string[]): void {
    for (const l of lines) if (l.trim()) this.lines.push(l);
    const over = this.lines.length - this.max;
    if (over > 0) {
      this.lines.splice(0, over);
      this.start += over;
    }
  }

  search(re: RegExp, limit = 200): { index: number; text: string }[] {
    const out: { index: number; text: string }[] = [];
    for (let i = this.lines.length - 1; i >= 0 && out.length < limit; i--) {
      re.lastIndex = 0;
      if (re.test(this.lines[i])) out.push({ index: this.start + i, text: this.lines[i] });
    }
    return out;
  }

  get size(): number {
    return this.lines.length;
  }
}

/** Search query: /regex/flags or smart-case literal. */
export function searchRegex(q: string): RegExp {
  const m = /^\/(.+)\/([a-z]*)$/.exec(q);
  if (m) return new RegExp(m[1], m[2].replace(/g/g, ""));
  return new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), q === q.toLowerCase() ? "i" : "");
}

// ── panes ─────────────────────────────────────────────────────────────────

function leaves(n: PaneNode): Extract<PaneNode, { kind: "leaf" }>[] {
  return n.kind === "leaf" ? [n] : n.children.flatMap(leaves);
}

/** tmux rotate-window: every pane moves one slot along (dir 1) or back (-1). */
export function rotatePanes(tree: PaneNode, dir: 1 | -1 = 1): PaneNode {
  const ls = leaves(tree);
  if (ls.length < 2) return tree;
  const rotated = dir === 1 ? [ls[ls.length - 1], ...ls.slice(0, -1)] : [...ls.slice(1), ls[0]];
  let i = 0;
  const rebuild = (n: PaneNode): PaneNode => (n.kind === "leaf" ? rotated[i++] : { ...n, children: n.children.map(rebuild) });
  return rebuild(tree);
}

// ── kubectl ───────────────────────────────────────────────────────────────

export interface KubeContext {
  name: string;
  current: boolean;
  cluster: string;
  namespace: string;
}

/** `kubectl config get-contexts` table. */
export function parseKubeContexts(out: string): KubeContext[] {
  const lines = out.split("\n").filter((l) => l.trim());
  if (!lines.length) return [];
  const header = lines[0];
  const col = (name: string) => header.indexOf(name);
  const cut = (l: string, a: number, b: number) => (a < 0 ? "" : l.slice(a, b < 0 ? undefined : b).trim());
  const [c0, c1, c2, c3, c4] = [col("CURRENT"), col("NAME"), col("CLUSTER"), col("AUTHINFO"), col("NAMESPACE")];
  return lines.slice(1).map((l) => ({
    current: cut(l, c0, c1) === "*",
    name: cut(l, c1, c2),
    cluster: cut(l, c2, c3),
    namespace: cut(l, c4, -1) || "default",
  }));
}

export interface Pod {
  name: string;
  ready: string;
  status: string;
  restarts: string;
  age: string;
}

/** `kubectl get pods --no-headers`. */
export function parsePods(out: string): Pod[] {
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const c = l.split(/\s+/);
      // RESTARTS may be "3 (2m ago)".
      const age = c[c.length - 1];
      const restarts = c.slice(3, c.length - 1).join(" ");
      return { name: c[0], ready: c[1], status: c[2], restarts, age };
    });
}

// ── processes ─────────────────────────────────────────────────────────────

export interface Proc {
  pid: number;
  cpu: number;
  memMb: number;
  name: string;
  command: string;
}

/** `ps -Ao pid=,pcpu=,rss=,comm=,args=` (rss in KiB). */
export function parsePs(out: string): Proc[] {
  return out
    .split("\n")
    .map((l) => /^\s*(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s*(.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ pid: Number(m[1]), cpu: Number(m[2]), memMb: Number(m[3]) / 1024, name: m[4].split("/").pop()!, command: m[5] || m[4] }))
    .sort((a, b) => b.cpu - a.cpu || b.memMb - a.memMb);
}

/** `tasklist /fo csv /nh`: "name","pid","session","#","12,345 K". */
export function parseTasklist(out: string): Proc[] {
  return out
    .split(/\r?\n/)
    .map((l) => /^"([^"]+)","(\d+)","[^"]*","[^"]*","([\d,. ]+)\s*K"/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ pid: Number(m[2]), cpu: 0, memMb: Number(m[3].replace(/[^\d]/g, "")) / 1024, name: m[1], command: m[1] }))
    .sort((a, b) => b.memMb - a.memMb);
}

// ── schedules ─────────────────────────────────────────────────────────────

export type Schedule = { kind: "once"; at: number } | { kind: "every"; ms: number };

/** "in 5m", "in 1h30m", "at 14:30", "at 9pm", "every 10m", "every 30s". */
export function parseSchedule(input: string, now = new Date()): Schedule {
  const s = input.trim().toLowerCase();
  const dur = (t: string) => {
    let total = 0;
    let any = false;
    for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(ms|s|sec|m|min|h|hr|d)[a-z]*/g)) {
      any = true;
      total += Number(m[1]) * ({ ms: 1, s: 1000, sec: 1000, m: 60_000, min: 60_000, h: 3_600_000, hr: 3_600_000, d: 86_400_000 } as Record<string, number>)[m[2]];
    }
    if (!any) throw new Error(`Can't read "${t}" as a duration (try 5m, 1h30m, 45s)`);
    return total;
  };
  if (s.startsWith("every ")) {
    const ms = dur(s.slice(6));
    if (ms < 5000) throw new Error("Repeat at most every 5 seconds");
    return { kind: "every", ms };
  }
  if (s.startsWith("in ")) return { kind: "once", at: now.getTime() + dur(s.slice(3)) };
  const at = /^(?:at\s+)?(\d{1,2})(?::(\d\d))?\s*(am|pm)?$/.exec(s);
  if (at) {
    let h = Number(at[1]);
    if (at[3]) h = (h % 12) + (at[3] === "pm" ? 12 : 0);
    const d = new Date(now);
    d.setHours(h, Number(at[2] ?? 0), 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return { kind: "once", at: d.getTime() };
  }
  throw new Error('Use "in 10m", "at 14:30" or "every 5m"');
}

// ── toolchains ────────────────────────────────────────────────────────────

/** Commands that activate the project's Python venv / Node version, for a shell. */
export function activationCommands(
  entries: { venvDirs: string[]; hasNvmrc: boolean; hasNodeVersion: boolean; hasToolVersions: boolean },
  shell: "posix" | "powershell" | "cmd" | "fish",
): string[] {
  const cmds: string[] = [];
  const venv = entries.venvDirs[0];
  if (venv) {
    if (shell === "powershell") cmds.push(`& ./${venv}/Scripts/Activate.ps1`);
    else if (shell === "cmd") cmds.push(`${venv}\\Scripts\\activate.bat`);
    else if (shell === "fish") cmds.push(`source ${venv}/bin/activate.fish`);
    else cmds.push(`source ${venv}/bin/activate`);
  }
  if (entries.hasNvmrc || entries.hasNodeVersion) cmds.push(shell === "powershell" || shell === "cmd" ? "fnm use" : "nvm use || fnm use");
  if (entries.hasToolVersions && shell !== "powershell" && shell !== "cmd") cmds.push("asdf install");
  return cmds;
}

/** Markdown block for sharing a command and its output. */
export function commandAsMarkdown(command: string, output: string, exitCode: number | null, cwd?: string | null): string {
  const fence = output.includes("```") ? "````" : "```";
  const status = exitCode === null ? "" : exitCode === 0 ? " ✓" : ` ✗ exit ${exitCode}`;
  return `${cwd ? `\`${cwd}\`\n\n` : ""}${fence}console\n$ ${command}\n${output.replace(/\s+$/, "")}\n${fence}${status ? `\n\n_${status.trim()}_` : ""}\n`;
}
