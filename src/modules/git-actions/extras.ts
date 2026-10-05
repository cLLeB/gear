// Pure parsing helpers for the stash, worktree, tag, cherry-pick and bisect
// palette workflows (see extraActions.ts).

export const SEP = "\x1f";

export interface Stash {
  ref: string; // stash@{0}
  index: number;
  message: string;
  branch: string | null;
  when: string;
}

export const STASH_FORMAT = `%gd${SEP}%gs${SEP}%cr`;

export function parseStashList(out: string): Stash[] {
  return out
    .split("\n")
    .filter((l) => l.includes(SEP))
    .map((l) => {
      const [ref, subject, when] = l.split(SEP);
      // "WIP on main: abc123 msg" / "On main: my message"
      const m = /^(?:WIP on|On) ([^:]+): (.*)$/.exec(subject);
      return {
        ref,
        index: Number(/\{(\d+)\}/.exec(ref)?.[1] ?? 0),
        message: m ? m[2] : subject,
        branch: m ? m[1] : null,
        when,
      };
    });
}

export interface Worktree {
  path: string;
  head: string;
  branch: string | null;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
  main: boolean;
}

export function parseWorktrees(porcelain: string): Worktree[] {
  const out: Worktree[] = [];
  for (const block of porcelain.split(/\n\s*\n/)) {
    const lines = block.split("\n").filter(Boolean);
    if (!lines.length || !lines[0].startsWith("worktree ")) continue;
    const wt: Worktree = { path: lines[0].slice(9), head: "", branch: null, detached: false, bare: false, locked: false, prunable: false, main: out.length === 0 };
    for (const l of lines.slice(1)) {
      if (l.startsWith("HEAD ")) wt.head = l.slice(5);
      else if (l.startsWith("branch ")) wt.branch = l.slice(7).replace(/^refs\/heads\//, "");
      else if (l === "detached") wt.detached = true;
      else if (l === "bare") wt.bare = true;
      else if (l.startsWith("locked")) wt.locked = true;
      else if (l.startsWith("prunable")) wt.prunable = true;
    }
    out.push(wt);
  }
  return out;
}

/** Sibling directory for a new worktree: /src/app + feat/x → /src/app-feat-x. */
export function worktreePathFor(repoRoot: string, branch: string): string {
  const root = repoRoot.replace(/[\\/]+$/, "");
  const slug = branch.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "worktree";
  return `${root}-${slug}`;
}

export interface LogEntry {
  sha: string;
  short: string;
  subject: string;
  author: string;
  when: string;
}

export const LOG_FORMAT = `%H${SEP}%h${SEP}%s${SEP}%an${SEP}%cr`;

export function parseLog(out: string): LogEntry[] {
  return out
    .split("\n")
    .filter((l) => l.includes(SEP))
    .map((l) => {
      const [sha, short, subject, author, when] = l.split(SEP);
      return { sha, short, subject, author, when };
    });
}

export interface Tag {
  name: string;
  sha: string;
  subject: string;
  when: string;
}

export const TAG_FORMAT = `%(refname:short)${SEP}%(objectname:short)${SEP}%(contents:subject)${SEP}%(creatordate:relative)`;

export function parseTags(out: string): Tag[] {
  return out
    .split("\n")
    .filter((l) => l.includes(SEP))
    .map((l) => {
      const [name, sha, subject, when] = l.split(SEP);
      return { name, sha, subject, when };
    });
}

/** Next semantic version tags after the latest one (v-prefix preserved). */
export function nextVersionTags(tags: string[]): string[] {
  const parsed = tags
    .map((t) => ({ t, m: /^(v?)(\d+)\.(\d+)\.(\d+)$/.exec(t) }))
    .filter((x): x is { t: string; m: RegExpExecArray } => !!x.m)
    .map(({ m }) => ({ prefix: m[1], v: [Number(m[2]), Number(m[3]), Number(m[4])] as const }))
    .sort((a, b) => b.v[0] - a.v[0] || b.v[1] - a.v[1] || b.v[2] - a.v[2]);
  const latest = parsed[0];
  if (!latest) return ["v0.1.0", "v1.0.0"];
  const [ma, mi, pa] = latest.v;
  const p = latest.prefix;
  return [`${p}${ma}.${mi}.${pa + 1}`, `${p}${ma}.${mi + 1}.0`, `${p}${ma + 1}.0.0`];
}

export interface BisectState {
  remaining: number | null;
  steps: number | null;
  current: string | null;
  done: string | null;
}

/** Read the outcome of a `git bisect good|bad|skip|start` step. */
export function parseBisectOutput(out: string): BisectState {
  const done = /^([0-9a-f]{7,40}) is the first bad commit/m.exec(out);
  if (done) return { remaining: 0, steps: 0, current: null, done: done[1] };
  const m = /Bisecting: (\d+) revisions? left to test after this \(roughly (\d+) steps?\)\s*\n?\[([0-9a-f]+)\]/.exec(out);
  if (m) return { remaining: Number(m[1]), steps: Number(m[2]), current: m[3], done: null };
  return { remaining: null, steps: null, current: null, done: null };
}

/** Pattern to add to .gitignore for a repo-relative path. */
export function gitignorePatternFor(relPath: string, kind: "file" | "extension" | "folder"): string {
  const p = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (kind === "extension") {
    const ext = /\.[^./]+$/.exec(p)?.[0];
    return ext ? `*${ext}` : `/${p}`;
  }
  if (kind === "folder") {
    const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : p;
    return `/${dir}/`;
  }
  return `/${p}`;
}

/** Append a pattern to .gitignore content unless it's already there. */
export function appendGitignore(content: string, pattern: string): string | null {
  const lines = content.split(/\r?\n/).map((l) => l.trim());
  if (lines.includes(pattern) || lines.includes(pattern.replace(/^\//, ""))) return null;
  const sep = content && !content.endsWith("\n") ? "\n" : "";
  return `${content}${sep}${pattern}\n`;
}
