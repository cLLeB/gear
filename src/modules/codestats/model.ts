// What a codebase is made of and where the risk sits: lines of code,
// comments and blank lines per language; from git history, how often each
// file changes, who changes it, which files change together, and the
// hotspots — big files that keep changing.

export interface Lang {
  name: string;
  line: string[];
  block: [string, string][];
}

const C_LIKE: Omit<Lang, "name"> = { line: ["//"], block: [["/*", "*/"]] };
const HASH: Omit<Lang, "name"> = { line: ["#"], block: [] };

const LANGS: Record<string, Lang> = {};
const add = (exts: string, name: string, syntax: Omit<Lang, "name">) => {
  for (const e of exts.split(" ")) LANGS[e] = { name, ...syntax };
};
add("ts mts cts", "TypeScript", C_LIKE);
add("tsx", "TSX", C_LIKE);
add("js mjs cjs", "JavaScript", C_LIKE);
add("jsx", "JSX", C_LIKE);
add("rs", "Rust", C_LIKE);
add("go", "Go", C_LIKE);
add("java", "Java", C_LIKE);
add("kt kts", "Kotlin", C_LIKE);
add("scala", "Scala", C_LIKE);
add("swift", "Swift", C_LIKE);
add("c h", "C", C_LIKE);
add("cpp cc cxx hpp hh hxx", "C++", C_LIKE);
add("cs", "C#", C_LIKE);
add("dart", "Dart", C_LIKE);
add("php", "PHP", { line: ["//", "#"], block: [["/*", "*/"]] });
add("css", "CSS", { line: [], block: [["/*", "*/"]] });
add("scss less", "SCSS / Less", C_LIKE);
add("py pyi", "Python", { line: ["#"], block: [['"""', '"""'], ["'''", "'''"]] });
add("rb", "Ruby", { line: ["#"], block: [["=begin", "=end"]] });
add("sh bash zsh fish", "Shell", HASH);
add("ps1 psm1", "PowerShell", { line: ["#"], block: [["<#", "#>"]] });
add("yml yaml", "YAML", HASH);
add("toml", "TOML", HASH);
add("r", "R", HASH);
add("pl pm", "Perl", HASH);
add("ex exs", "Elixir", HASH);
add("nix", "Nix", { line: ["#"], block: [["/*", "*/"]] });
add("lua", "Lua", { line: ["--"], block: [["--[[", "]]"]] });
add("sql", "SQL", { line: ["--"], block: [["/*", "*/"]] });
add("hs", "Haskell", { line: ["--"], block: [["{-", "-}"]] });
add("html htm xml svg vue svelte astro", "Markup", { line: [], block: [["<!--", "-->"]] });
add("md mdx", "Markdown", { line: [], block: [["<!--", "-->"]] });
add("json jsonc json5", "JSON", C_LIKE);
add("zig", "Zig", { line: ["//"], block: [] });
add("ml mli", "OCaml", { line: [], block: [["(*", "*)"]] });
add("clj cljs edn", "Clojure", { line: [";"], block: [] });
add("erl", "Erlang", { line: ["%"], block: [] });
add("vim", "Vim script", { line: ['"'], block: [] });
add("tf", "Terraform", { line: ["#", "//"], block: [["/*", "*/"]] });
add("proto", "Protobuf", C_LIKE);
add("graphql gql", "GraphQL", HASH);

const SPECIAL: Record<string, Lang> = {
  dockerfile: { name: "Dockerfile", ...HASH },
  makefile: { name: "Makefile", ...HASH },
  "cmakelists.txt": { name: "CMake", ...HASH },
};

export function languageOf(path: string): Lang | null {
  const base = path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  if (SPECIAL[base]) return SPECIAL[base];
  if (base.startsWith("dockerfile.") || base.endsWith(".dockerfile")) return SPECIAL.dockerfile;
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1) : "";
  return LANGS[ext] ?? null;
}

export interface LineCount {
  code: number;
  comment: number;
  blank: number;
}

/**
 * Counts code, comment and blank lines. A line with code and a comment is
 * code. Comment markers inside strings are not recognised; for counting
 * this is close enough, as tools like cloc do the same.
 */
export function countLines(text: string, lang: Lang): LineCount {
  const out: LineCount = { code: 0, comment: 0, blank: 0 };
  let inBlock: [string, string] | null = null;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    let line = raw.trim();
    if (!line) {
      if (inBlock) out.comment++;
      else out.blank++;
      continue;
    }
    let code = false;
    let comment = false;
    while (line) {
      if (inBlock) {
        comment = true;
        const end = line.indexOf(inBlock[1]);
        if (end < 0) {
          line = "";
          break;
        }
        line = line.slice(end + inBlock[1].length).trim();
        inBlock = null;
        continue;
      }
      // The earliest comment start on the line.
      let at = -1;
      let kind: "line" | [string, string] | null = null;
      for (const m of lang.line) {
        const i = line.indexOf(m);
        if (i >= 0 && (at < 0 || i < at)) (at = i), (kind = "line");
      }
      for (const b of lang.block) {
        const i = line.indexOf(b[0]);
        if (i >= 0 && (at < 0 || i < at)) (at = i), (kind = b);
      }
      if (at < 0 || !kind) {
        code = true;
        break;
      }
      if (at > 0) code = true;
      comment = true;
      if (kind === "line") break;
      inBlock = kind;
      line = line.slice(at + kind[0].length);
    }
    if (code) out.code++;
    else if (comment) out.comment++;
    else out.blank++;
  }
  return out;
}

export interface FileStat extends LineCount {
  path: string;
  language: string;
  bytes: number;
}

export interface LanguageStat extends LineCount {
  language: string;
  files: number;
}

export function byLanguage(files: FileStat[]): LanguageStat[] {
  const map = new Map<string, LanguageStat>();
  for (const f of files) {
    const s = map.get(f.language) ?? { language: f.language, files: 0, code: 0, comment: 0, blank: 0 };
    s.files++;
    s.code += f.code;
    s.comment += f.comment;
    s.blank += f.blank;
    map.set(f.language, s);
  }
  return [...map.values()].sort((a, b) => b.code - a.code);
}

// --- Git history -----------------------------------------------------------

export const LOG_MARK = "@@gear@@";
/** Arguments for the log this module reads. */
export function logArgs(sinceDays: number, maxCommits: number): string[] {
  return ["log", "--no-merges", "--numstat", "--no-renames", `--format=${LOG_MARK}%H%x09%an%x09%ae%x09%at`, `--since=${sinceDays}.days`, "-n", String(maxCommits)];
}

export interface Commit {
  sha: string;
  author: string;
  email: string;
  time: number;
  files: { path: string; added: number; deleted: number }[];
}

export function parseLog(out: string): Commit[] {
  const commits: Commit[] = [];
  let cur: Commit | null = null;
  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith(LOG_MARK)) {
      const [sha, author, email, time] = line.slice(LOG_MARK.length).split("\t");
      cur = { sha, author, email: email.toLowerCase(), time: Number(time) * 1000, files: [] };
      commits.push(cur);
      continue;
    }
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
    if (m && cur) cur.files.push({ path: m[3], added: m[1] === "-" ? 0 : Number(m[1]), deleted: m[2] === "-" ? 0 : Number(m[2]) });
  }
  return commits;
}

export interface Churn {
  path: string;
  commits: number;
  added: number;
  deleted: number;
  authors: { name: string; commits: number }[];
  lastChange: number;
}

/** Changes per file, for files that still exist when `exists` is given. */
export function churn(commits: Commit[], exists?: (path: string) => boolean): Churn[] {
  const map = new Map<string, { commits: number; added: number; deleted: number; authors: Map<string, number>; last: number }>();
  for (const c of commits) {
    for (const f of c.files) {
      if (exists && !exists(f.path)) continue;
      const s = map.get(f.path) ?? { commits: 0, added: 0, deleted: 0, authors: new Map(), last: 0 };
      s.commits++;
      s.added += f.added;
      s.deleted += f.deleted;
      s.authors.set(c.author, (s.authors.get(c.author) ?? 0) + 1);
      s.last = Math.max(s.last, c.time);
      map.set(f.path, s);
    }
  }
  return [...map]
    .map(([path, s]) => ({ path, commits: s.commits, added: s.added, deleted: s.deleted, lastChange: s.last, authors: [...s.authors].map(([name, n]) => ({ name, commits: n })).sort((a, b) => b.commits - a.commits) }))
    .sort((a, b) => b.commits - a.commits || b.added + b.deleted - (a.added + a.deleted));
}

export interface Hotspot {
  path: string;
  commits: number;
  code: number;
  /** 0–100, relative to the worst file. */
  score: number;
  /** Share of commits by the most active author, 0–1. */
  ownership: number;
  mainAuthor: string;
  authors: number;
}

/**
 * Files that are both large and often changed — where bugs and slow
 * reviews tend to collect. The score is commits × log(lines of code).
 */
export function hotspots(changes: Churn[], files: Map<string, FileStat>, limit = 50): Hotspot[] {
  const rows = changes
    .map((c) => {
      const f = files.get(c.path);
      if (!f || f.code === 0) return null;
      const total = c.authors.reduce((a, x) => a + x.commits, 0);
      return { path: c.path, commits: c.commits, code: f.code, raw: c.commits * Math.log2(1 + f.code), ownership: total ? c.authors[0].commits / total : 1, mainAuthor: c.authors[0]?.name ?? "", authors: c.authors.length };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.raw - a.raw)
    .slice(0, limit);
  const top = rows[0]?.raw || 1;
  return rows.map(({ raw, ...r }) => ({ ...r, score: Math.round((raw / top) * 100) }));
}

export interface Coupling {
  a: string;
  b: string;
  /** Commits that touched both. */
  together: number;
  /** together / commits of the less-changed file, 0–1. */
  degree: number;
}

/**
 * Files that change in the same commits. Large commits (formatting,
 * renames, dependency bumps) are left out because they couple everything.
 */
export function coupling(commits: Commit[], opts: { minTogether?: number; maxFilesPerCommit?: number; limit?: number; exists?: (p: string) => boolean } = {}): Coupling[] {
  const minTogether = opts.minTogether ?? 3;
  const maxFiles = opts.maxFilesPerCommit ?? 30;
  const single = new Map<string, number>();
  const pairs = new Map<string, number>();
  for (const c of commits) {
    const files = [...new Set(c.files.map((f) => f.path))].filter((p) => !opts.exists || opts.exists(p)).sort();
    if (files.length < 2 || files.length > maxFiles) {
      for (const f of files) single.set(f, (single.get(f) ?? 0) + 1);
      continue;
    }
    for (const f of files) single.set(f, (single.get(f) ?? 0) + 1);
    for (let i = 0; i < files.length; i++) for (let j = i + 1; j < files.length; j++) pairs.set(`${files[i]}\n${files[j]}`, (pairs.get(`${files[i]}\n${files[j]}`) ?? 0) + 1);
  }
  return [...pairs]
    .filter(([, n]) => n >= minTogether)
    .map(([key, together]) => {
      const [a, b] = key.split("\n");
      return { a, b, together, degree: together / Math.min(single.get(a) ?? together, single.get(b) ?? together) };
    })
    .sort((x, y) => y.degree - x.degree || y.together - x.together)
    .slice(0, opts.limit ?? 50);
}

export interface Contributor {
  name: string;
  commits: number;
  added: number;
  deleted: number;
  files: number;
  first: number;
  last: number;
}

export function contributors(commits: Commit[]): Contributor[] {
  const map = new Map<string, Contributor & { fileSet: Set<string> }>();
  for (const c of commits) {
    const s = map.get(c.author) ?? { name: c.author, commits: 0, added: 0, deleted: 0, files: 0, first: c.time, last: c.time, fileSet: new Set<string>() };
    s.commits++;
    for (const f of c.files) {
      s.added += f.added;
      s.deleted += f.deleted;
      s.fileSet.add(f.path);
    }
    s.first = Math.min(s.first, c.time);
    s.last = Math.max(s.last, c.time);
    map.set(c.author, s);
  }
  return [...map.values()].map(({ fileSet, ...s }) => ({ ...s, files: fileSet.size })).sort((a, b) => b.commits - a.commits);
}

/** Commits per ISO week (Monday start), oldest first, with empty weeks filled in. */
export function weeklyActivity(commits: Commit[], now = Date.now()): { week: number; commits: number }[] {
  if (!commits.length) return [];
  const WEEK = 7 * 86400000;
  const monday = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.getTime();
  };
  const counts = new Map<number, number>();
  for (const c of commits) counts.set(monday(c.time), (counts.get(monday(c.time)) ?? 0) + 1);
  const first = Math.min(...counts.keys());
  const out: { week: number; commits: number }[] = [];
  // Weeks can be 1 h short or long across DST changes; re-snap each step.
  for (let w = first; w <= monday(now); w = monday(w + WEEK + 3600000 * 2)) out.push({ week: w, commits: counts.get(w) ?? 0 });
  return out;
}

/** How many people together made at least half the changes to the code: below 2 is a risk. */
export function busFactor(changes: Churn[]): number {
  const byAuthor = new Map<string, number>();
  for (const c of changes) for (const a of c.authors) byAuthor.set(a.name, (byAuthor.get(a.name) ?? 0) + a.commits);
  const sorted = [...byAuthor.values()].sort((a, b) => b - a);
  const total = sorted.reduce((a, b) => a + b, 0);
  let sum = 0;
  for (let i = 0; i < sorted.length; i++) {
    sum += sorted[i];
    if (sum >= total / 2) return i + 1;
  }
  return 0;
}

/** Paths to skip when counting: generated, vendored and lock files. */
export function isCounted(path: string): boolean {
  if (/(^|\/)(node_modules|vendor|dist|build|out|target|\.git|\.next|\.nuxt|coverage|__pycache__|\.venv|venv|Pods|\.gradle)\//.test(path)) return false;
  if (/(\.min\.(js|css)|\.map|\.lock|-lock\.json|lock\.yaml|\.snap|\.d\.ts)$/i.test(path)) return false;
  return languageOf(path) !== null;
}
