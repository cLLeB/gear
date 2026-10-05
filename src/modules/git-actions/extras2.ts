// Pure helpers for the second set of git workflows (see extraActions2.ts).

export const SEP = "\x1f";

export interface BlameInfo {
  sha: string;
  author: string;
  email: string;
  time: number;
  summary: string;
  uncommitted: boolean;
}

/** `git blame --porcelain -L n,n` output. */
export function parseBlamePorcelain(out: string): BlameInfo | null {
  const lines = out.split("\n");
  const head = /^([0-9a-f]{40}) \d+ \d+/.exec(lines[0] ?? "");
  if (!head) return null;
  const get = (k: string) => lines.find((l) => l.startsWith(`${k} `))?.slice(k.length + 1) ?? "";
  return {
    sha: head[1],
    author: get("author"),
    email: get("author-mail").replace(/[<>]/g, ""),
    time: Number(get("author-time")) * 1000,
    summary: get("summary"),
    uncommitted: /^0+$/.test(head[1]),
  };
}

/** PR/MR number from a merge or squash subject: "Fix x (#123)", "Merge pull request #45 from …", "See merge request group/p!7". */
export function pullRequestNumber(subject: string): number | null {
  const m = /\(#(\d+)\)\s*$|Merge pull request #(\d+)|merge request [\w./-]*!(\d+)/i.exec(subject);
  return m ? Number(m[1] ?? m[2] ?? m[3]) : null;
}

export interface NameStatus {
  status: string;
  path: string;
  from: string | null;
}

/** `git diff --name-status` (renames as R100\told\tnew). */
export function parseNameStatus(out: string): NameStatus[] {
  return out
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [st, a, b] = l.split("\t");
      return b ? { status: st[0], path: b, from: a } : { status: st[0], path: a, from: null };
    });
}

export const STATUS_LABEL: Record<string, string> = { A: "added", M: "modified", D: "deleted", R: "renamed", C: "copied", T: "type changed", U: "unmerged" };

export interface ReflogEntry {
  sha: string;
  ref: string;
  action: string;
  message: string;
  when: string;
}

export const REFLOG_FORMAT = `%H${SEP}%gd${SEP}%gs${SEP}%cr`;

/** `git reflog --format=REFLOG_FORMAT`: "checkout: moving from a to b", "commit: msg"… */
export function parseReflog(out: string): ReflogEntry[] {
  return out
    .split("\n")
    .filter((l) => l.includes(SEP))
    .map((l) => {
      const [sha, ref, subject, when] = l.split(SEP);
      const i = subject.indexOf(": ");
      return { sha, ref, action: i > 0 ? subject.slice(0, i) : subject, message: i > 0 ? subject.slice(i + 2) : "", when };
    });
}

export interface Contributor {
  name: string;
  email: string;
  commits: number;
}

/** `git shortlog -sne HEAD`. */
export function parseShortlog(out: string): Contributor[] {
  return out
    .split("\n")
    .map((l) => /^\s*(\d+)\s+(.+?)\s+<([^>]*)>\s*$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ commits: Number(m[1]), name: m[2], email: m[3] }));
}

export interface Remote {
  name: string;
  fetch: string;
  push: string;
}

/** `git remote -v`. */
export function parseRemotes(out: string): Remote[] {
  const map = new Map<string, Remote>();
  for (const l of out.split("\n")) {
    const m = /^(\S+)\s+(\S+)\s+\((fetch|push)\)/.exec(l);
    if (!m) continue;
    const r = map.get(m[1]) ?? { name: m[1], fetch: "", push: "" };
    r[m[3] as "fetch" | "push"] = m[2];
    map.set(m[1], r);
  }
  return [...map.values()];
}

/** git@host:owner/repo.git or ssh/https URL → https web URL. */
export function remoteWebUrl(url: string): string | null {
  const scp = /^[\w.-]+@([^:]+):(.+?)(?:\.git)?\/?$/.exec(url);
  if (scp) return `https://${scp[1]}/${scp[2]}`;
  const u = /^(?:ssh|git|https?):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/.exec(url);
  return u ? `https://${u[1]}/${u[2]}` : null;
}

export interface Submodule {
  path: string;
  sha: string;
  state: "ok" | "uninitialized" | "modified" | "conflict";
  describe: string;
}

/** `git submodule status`. */
export function parseSubmodules(out: string): Submodule[] {
  return out
    .split("\n")
    .map((l) => /^([ +U-])([0-9a-f]+) (\S+)(?: \((.*)\))?/.exec(l))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({
      path: m[3],
      sha: m[2],
      state: m[1] === "-" ? "uninitialized" : m[1] === "+" ? "modified" : m[1] === "U" ? "conflict" : "ok",
      describe: m[4] ?? "",
    }));
}

export const CONVENTIONAL_TYPES: { type: string; description: string }[] = [
  { type: "feat", description: "A new feature" },
  { type: "fix", description: "A bug fix" },
  { type: "docs", description: "Documentation only" },
  { type: "refactor", description: "Code change that neither fixes a bug nor adds a feature" },
  { type: "perf", description: "Performance improvement" },
  { type: "test", description: "Adding or fixing tests" },
  { type: "build", description: "Build system or dependencies" },
  { type: "ci", description: "CI configuration" },
  { type: "chore", description: "Maintenance that doesn't touch src or tests" },
  { type: "style", description: "Formatting only" },
  { type: "revert", description: "Reverts a previous commit" },
];

export function buildConventionalMessage(o: { type: string; scope?: string; breaking?: boolean; subject: string; body?: string; issues?: string }): string {
  const scope = o.scope?.trim() ? `(${o.scope.trim()})` : "";
  let subject = o.subject.trim().replace(/\.$/, "");
  subject = subject.charAt(0).toLowerCase() + subject.slice(1);
  let msg = `${o.type}${scope}${o.breaking ? "!" : ""}: ${subject}`;
  const body = o.body?.trim();
  if (body) msg += `\n\n${body}`;
  const footers: string[] = [];
  if (o.breaking) footers.push(`BREAKING CHANGE: ${body?.split("\n")[0] || subject}`);
  for (const ref of (o.issues ?? "").split(/[\s,]+/).filter(Boolean)) footers.push(`Refs: ${ref.startsWith("#") || /^\w+-\d+$/.test(ref) ? ref : `#${ref}`}`);
  if (footers.length) msg += `\n\n${footers.join("\n")}`;
  return msg;
}

/** Scope suggestions from staged paths: the most common top-level folder under src/packages/apps. */
export function suggestScopes(paths: string[]): string[] {
  const counts = new Map<string, number>();
  for (const p of paths) {
    const parts = p.split("/");
    const i = parts.findIndex((x) => ["src", "packages", "apps", "modules", "crates", "lib"].includes(x));
    const scope = i >= 0 && parts[i + 1] && i + 2 < parts.length ? parts[i + 1] : parts.length > 1 ? parts[0] : "";
    if (scope) counts.set(scope, (counts.get(scope) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
}
