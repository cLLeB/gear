// Pure helpers for git workflows, part four: partial (line-range) patches for
// staging / unstaging / discarding selected lines, an interactive-rebase
// plan, split-commit scripts, stale branches, big blobs, trailers, TODO ages.

// ── line-range patches ────────────────────────────────────────────────────

/**
 * Keep only the changes of a single-file unified diff that touch new-file
 * lines [from, to] (1-based, inclusive). Unselected additions are dropped
 * and unselected deletions become context, so the result applies cleanly
 * with `git apply --recount`. Returns null when nothing is selected.
 *
 * With `reverse` the range is in old-file line numbers instead — used when
 * the patch will be applied with -R against the *new* side (e.g. unstaging,
 * where the editor shows the working file but the patch is index→HEAD).
 */
export function filterPatch(diff: string, from: number, to: number): string | null {
  const lines = diff.replace(/\r\n/g, "\n").split("\n");
  const headerEnd = lines.findIndex((l) => l.startsWith("@@"));
  if (headerEnd < 0) return null;
  const header = lines.slice(0, headerEnd);
  const out: string[] = [];
  let any = false;
  let i = headerEnd;
  while (i < lines.length) {
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(lines[i]);
    if (!h) {
      i++;
      continue;
    }
    const oldStart = Number(h[1]);
    let newLine = Number(h[3]);
    const body: string[] = [];
    let hunkAny = false;
    i++;
    // A deletion sits "at" the new-file line where it was removed.
    while (i < lines.length && !lines[i].startsWith("@@") && !lines[i].startsWith("diff --git")) {
      const l = lines[i];
      const tag = l[0];
      if (tag === " ") {
        body.push(l);
        newLine++;
      } else if (tag === "+") {
        if (newLine >= from && newLine <= to) {
          body.push(l);
          hunkAny = true;
        }
        newLine++;
      } else if (tag === "-") {
        if (newLine >= from && newLine <= to) {
          body.push(l);
          hunkAny = true;
        } else body.push(` ${l.slice(1)}`);
      } else if (tag === "\\") {
        // "\ No newline at end of file" belongs to the previous line; keep it if that line survived.
        if (body.length) body.push(l);
      } else if (l === "" && i === lines.length - 1) {
        // trailing newline of the diff text
      } else body.push(l);
      i++;
    }
    if (hunkAny) {
      any = true;
      const oldCount = body.filter((l) => l[0] === " " || l[0] === "-").length;
      const newCount = body.filter((l) => l[0] === " " || l[0] === "+").length;
      out.push(`@@ -${oldStart},${oldCount} +${Number(h[3])},${newCount} @@${h[5]}`, ...body);
    }
  }
  if (!any) return null;
  return `${[...header, ...out].join("\n")}\n`;
}

// ── interactive rebase plan ───────────────────────────────────────────────

export type RebaseAction = "pick" | "reword" | "edit" | "squash" | "fixup" | "drop";

/** A git-rebase-todo for commits (oldest first). */
export function rebaseTodo(commits: { sha: string; subject: string; action: RebaseAction }[]): string {
  if (commits.length && (commits[0].action === "squash" || commits[0].action === "fixup")) throw new Error("The oldest commit can't be squashed — there's nothing before it to fold into");
  return `${commits.map((c) => `${c.action} ${c.sha} ${c.subject}`).join("\n")}\n`;
}

/** Guess a plan: fold `fixup!` / `squash!` commits into their targets (autosquash). */
export function autosquashPlan(commits: { sha: string; subject: string }[]): { sha: string; subject: string; action: RebaseAction }[] {
  const out: { sha: string; subject: string; action: RebaseAction }[] = [];
  const pending = [...commits];
  const placed = new Set<string>();
  for (const c of pending) {
    if (placed.has(c.sha)) continue;
    if (/^(fixup|squash|amend)! /.test(c.subject) && out.some((o) => c.subject.replace(/^(fixup|squash|amend)! /, "") === o.subject.replace(/^(fixup|squash)! /, ""))) continue;
    out.push({ ...c, action: "pick" });
    placed.add(c.sha);
    for (const f of pending) {
      if (placed.has(f.sha)) continue;
      const m = /^(fixup|squash|amend)! (.*)$/.exec(f.subject);
      if (m && m[2] === c.subject) {
        out.push({ ...f, action: m[1] === "squash" ? "squash" : "fixup" });
        placed.add(f.sha);
      }
    }
  }
  for (const c of pending) if (!placed.has(c.sha)) out.push({ ...c, action: "pick" });
  return out;
}

// ── split commit ──────────────────────────────────────────────────────────

/** Shell script that splits HEAD into one commit per file, reusing its message. */
export function splitCommitScript(subject: string, files: string[], shell: "posix" | "powershell"): string {
  const q = shell === "powershell" ? (s: string) => `'${s.replace(/'/g, "''")}'` : (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const name = (f: string) => f.replace(/^.*\//, "");
  const steps = ["git reset --soft HEAD~1", "git reset -q", ...files.map((f) => `git add -A -- ${q(f)} && git commit -q -m ${q(`${subject} (${name(f)})`)}`)];
  return steps.join(shell === "powershell" ? "; " : " && ");
}

// ── branches ──────────────────────────────────────────────────────────────

export interface BranchInfo {
  name: string;
  date: number;
  author: string;
  upstream: string;
  track: string;
  merged: boolean;
  ageDays: number;
}

export const BRANCH_FORMAT = "%(refname:short)%09%(committerdate:unix)%09%(authorname)%09%(upstream:short)%09%(upstream:track)";

/** for-each-ref output → branches, oldest first. */
export function parseBranches(out: string, merged: Set<string>, now = Date.now()): BranchInfo[] {
  return out
    .split(/\r?\n/)
    .filter((l) => l.includes("\t"))
    .map((l) => {
      const [name, ts, author, upstream, track] = l.split("\t");
      const date = Number(ts) * 1000;
      return { name, date, author, upstream, track, merged: merged.has(name), ageDays: Math.floor((now - date) / 86_400_000) };
    })
    .sort((a, b) => a.date - b.date);
}

export function staleness(b: BranchInfo, days = 90): string[] {
  const why: string[] = [];
  if (b.ageDays >= days) why.push(`${b.ageDays}d old`);
  if (b.merged) why.push("merged");
  if (/gone/.test(b.track)) why.push("upstream gone");
  if (!b.upstream) why.push("never pushed");
  return why;
}

// ── big blobs ─────────────────────────────────────────────────────────────

export interface Blob {
  sha: string;
  size: number;
  path: string;
}

/** `git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)'` → largest blobs (deduped by sha). */
export function largestBlobs(out: string, top = 50): Blob[] {
  const seen = new Map<string, Blob>();
  for (const l of out.split(/\r?\n/)) {
    const m = /^blob ([0-9a-f]+) (\d+) ?(.*)$/.exec(l);
    if (m && !seen.has(m[1])) seen.set(m[1], { sha: m[1], size: Number(m[2]), path: m[3] });
  }
  return [...seen.values()].sort((a, b) => b.size - a.size).slice(0, top);
}

export function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}

// ── trailers ──────────────────────────────────────────────────────────────

/** Append a trailer (e.g. Co-authored-by) to a commit message, once. */
export function addTrailer(message: string, trailer: string): string {
  const msg = message.replace(/\s+$/, "");
  if (msg.split("\n").some((l) => l.trim().toLowerCase() === trailer.trim().toLowerCase())) return `${msg}\n`;
  const lines = msg.split("\n");
  const last = lines[lines.length - 1];
  const hasTrailerBlock = lines.length > 1 && /^[\w-]+: .+/.test(last) && lines[lines.length - 2] !== undefined && (lines.slice(0, -1).reverse().find((l) => !/^[\w-]+: .+/.test(l)) ?? "") === "";
  return `${msg}${hasTrailerBlock ? "\n" : "\n\n"}${trailer}\n`;
}

/** `git shortlog -sne` → people. */
export function parseShortlog(out: string): { name: string; email: string; commits: number }[] {
  return out
    .split(/\r?\n/)
    .map((l) => /^\s*(\d+)\s+(.+?)\s+<([^>]+)>\s*$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ name: m[2], email: m[3], commits: Number(m[1]) }));
}

// ── TODO ages ─────────────────────────────────────────────────────────────

/** Author time + author for each line of `git blame --line-porcelain` output, by final line number. */
export function blameTimes(out: string): Map<number, { time: number; author: string; sha: string }> {
  const m = new Map<number, { time: number; author: string; sha: string }>();
  let line = 0;
  let sha = "";
  let author = "";
  let time = 0;
  for (const l of out.split("\n")) {
    const h = /^([0-9a-f]{40}) \d+ (\d+)/.exec(l);
    if (h) {
      sha = h[1];
      line = Number(h[2]);
    } else if (l.startsWith("author ")) author = l.slice(7);
    else if (l.startsWith("author-time ")) time = Number(l.slice(12)) * 1000;
    else if (l.startsWith("\t")) m.set(line, { time, author, sha });
  }
  return m;
}

/** `git grep -n` output → TODO hits. */
export function parseGitGrep(out: string): { file: string; line: number; text: string }[] {
  return out
    .split(/\r?\n/)
    .map((l) => /^(.+?):(\d+):(.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ file: m[1], line: Number(m[2]), text: m[3].trim() }));
}

/** `git clean -n` output → paths. */
export function parseCleanDryRun(out: string): string[] {
  return out
    .split(/\r?\n/)
    .map((l) => /^Would (?:remove|skip repository) (.+)$/.exec(l)?.[1])
    .filter((p): p is string => !!p);
}
