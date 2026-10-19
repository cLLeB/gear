// CODEOWNERS as GitHub and GitLab read it: which rule owns each file (the
// last matching one), files nobody owns, rules that match nothing or that
// later rules always override, owners written wrongly, and who has to
// review a set of changed files.

export interface Rule {
  /** 1-based line in the CODEOWNERS file. */
  line: number;
  pattern: string;
  owners: string[];
  /** GitLab section name, or null outside sections. */
  section: string | null;
  regex: RegExp;
}

export interface Problem {
  line: number;
  message: string;
  severity: "error" | "warning";
}

export interface Parsed {
  rules: Rule[];
  problems: Problem[];
  sections: string[];
}

/** Where GitHub looks, in order; the first that exists is used. GitLab adds the same three. */
export const LOCATIONS = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS", ".gitlab/CODEOWNERS"];

const OWNER = /^(@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\/[A-Za-z0-9_.-]+)*|[^@\s]+@[^@\s]+\.[^@\s]+)$/;

/**
 * A CODEOWNERS pattern as a regular expression over workspace-relative
 * paths. Follows gitignore rules, with GitHub's differences: a trailing
 * `/*` matches only files directly inside, and a pattern that names a
 * directory owns everything below it.
 */
export function compilePattern(pattern: string): RegExp {
  let p = pattern.replace(/\\([#\s])/g, "$1");
  const dirOnly = p.endsWith("/");
  const anchored = p.startsWith("/") || p.replace(/\/+$/, "").includes("/");
  p = p.replace(/^\/+/, "").replace(/\/+$/, "");
  if (p === "" || p === "**") return /^.+$/;
  const segments = p.split("/");
  const last = segments[segments.length - 1];
  let body = "";
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === "*" && p[i + 1] === "*") {
      const atStart = i === 0 || p[i - 1] === "/";
      const slashAfter = p[i + 2] === "/";
      if (atStart && slashAfter) {
        body += "(?:.*/)?";
        i += 2;
      } else if (atStart && i + 2 === p.length) {
        body += ".*";
        i += 1;
      } else {
        body += "[^/]*";
        i += 1;
      }
    } else if (ch === "*") body += "[^/]*";
    else if (ch === "?") body += "[^/]";
    else body += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  const prefix = anchored ? "^" : "^(?:.*/)?";
  // A directory pattern owns what is below it; a wildcard last segment (docs/*) owns only that level.
  const wild = /[*?]/.test(last) && last !== "**";
  const suffix = dirOnly ? "/.*$" : wild ? "$" : "(?:/.*)?$";
  return new RegExp(prefix + body + suffix);
}

export function parseCodeowners(text: string): Parsed {
  const rules: Rule[] = [];
  const problems: Problem[] = [];
  const sections: string[] = [];
  let section: string | null = null;
  let sectionOwners: string[] = [];
  text.split(/\r?\n/).forEach((raw, idx) => {
    const line = idx + 1;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    // GitLab sections: [Name], ^[Optional], [Name][2] @default-owners
    const sec = /^\^?\[([^\]]+)\](?:\[\d+\])?(?:\s+(.*))?$/.exec(trimmed);
    if (sec) {
      section = sec[1].trim();
      sectionOwners = (sec[2] ?? "").split(/\s+/).filter((o) => o && !o.startsWith("#"));
      if (!sections.includes(section)) sections.push(section);
      return;
    }
    // Split on unescaped whitespace; a trailing comment starts at an unescaped #.
    const tokens: string[] = [];
    let cur = "";
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (ch === "\\" && i + 1 < trimmed.length) {
        cur += ch + trimmed[i + 1];
        i++;
      } else if (/\s/.test(ch)) {
        if (cur) tokens.push(cur);
        cur = "";
      } else if (ch === "#" && !cur && tokens.length > 0) break;
      else cur += ch;
    }
    if (cur) tokens.push(cur);
    const [pattern, ...rest] = tokens;
    let owners = rest;
    if (!owners.length && section && sectionOwners.length) owners = sectionOwners;
    if (pattern.startsWith("!")) problems.push({ line, severity: "error", message: `Negation (${pattern}) is not supported in CODEOWNERS; this line is ignored.` });
    else if (/\[[^\]]*\]/.test(pattern.replace(/\\\[/g, ""))) problems.push({ line, severity: "error", message: `Character ranges ([…]) are not supported in CODEOWNERS; ${pattern} is ignored.` });
    for (const o of rest) if (!OWNER.test(o)) problems.push({ line, severity: "error", message: `${o} is not an owner: use @user, @org/team or an email address.` });
    if (pattern.startsWith("!") || /\[[^\]]*\]/.test(pattern.replace(/\\\[/g, ""))) return;
    rules.push({ line, pattern, owners: owners.filter((o) => OWNER.test(o)), section, regex: compilePattern(pattern) });
  });
  return { rules, problems, sections };
}

export interface Ownership {
  /** Owners of the file (union over GitLab sections); empty when unowned. */
  owners: string[];
  /** The rule that decided, per section (null key outside sections). */
  decided: Rule[];
  /** Every rule that matches, in file order. */
  matches: Rule[];
}

/** Last match wins (per section in GitLab). */
export function ownersOf(path: string, rules: Rule[]): Ownership {
  const p = path.replace(/\\/g, "/").replace(/^\.?\//, "");
  const matches = rules.filter((r) => r.regex.test(p));
  const bySection = new Map<string | null, Rule>();
  for (const r of matches) bySection.set(r.section, r);
  const decided = [...bySection.values()];
  const owners = [...new Set(decided.flatMap((r) => r.owners))];
  return { owners, decided, matches };
}

export interface Analysis {
  files: number;
  owned: number;
  /** Files with no owner, including files a rule explicitly leaves unowned. */
  unowned: string[];
  /** Rules that match no file. */
  dead: Rule[];
  /** Rules that match files, but a later rule always wins for every one of them. */
  shadowed: { rule: Rule; by: Rule[] }[];
  /** Owner → number of files they own. */
  byOwner: Map<string, number>;
  /** Rule line → files it decides. */
  decides: Map<number, number>;
}

export function analyze(files: string[], parsed: Parsed): Analysis {
  const decides = new Map<number, number>();
  const matchedAny = new Set<number>();
  const shadowers = new Map<number, Set<Rule>>();
  const byOwner = new Map<string, number>();
  const unowned: string[] = [];
  for (const f of files) {
    const o = ownersOf(f, parsed.rules);
    for (const r of o.matches) matchedAny.add(r.line);
    for (const r of o.decided) decides.set(r.line, (decides.get(r.line) ?? 0) + 1);
    for (const r of o.matches)
      if (!o.decided.includes(r)) {
        const winner = o.decided.find((d) => d.section === r.section);
        if (winner) (shadowers.get(r.line) ?? shadowers.set(r.line, new Set()).get(r.line))?.add(winner);
      }
    if (o.owners.length) for (const owner of o.owners) byOwner.set(owner, (byOwner.get(owner) ?? 0) + 1);
    else unowned.push(f);
  }
  const dead = parsed.rules.filter((r) => !matchedAny.has(r.line));
  const shadowed = parsed.rules.filter((r) => matchedAny.has(r.line) && !decides.has(r.line)).map((rule) => ({ rule, by: [...(shadowers.get(rule.line) ?? [])].sort((a, b) => a.line - b.line) }));
  return { files: files.length, owned: files.length - unowned.length, unowned, dead, shadowed, byOwner: new Map([...byOwner].sort((a, b) => b[1] - a[1])), decides };
}

/** Who has to review a change: each owner with the changed files they own, plus changed files nobody owns. */
export function reviewersFor(changed: string[], rules: Rule[]): { reviewers: { owner: string; files: string[] }[]; unowned: string[] } {
  const m = new Map<string, string[]>();
  const unowned: string[] = [];
  for (const f of changed) {
    const { owners } = ownersOf(f, rules);
    if (!owners.length) unowned.push(f);
    for (const o of owners) m.set(o, [...(m.get(o) ?? []), f]);
  }
  return { reviewers: [...m].map(([owner, files]) => ({ owner, files })).sort((a, b) => b.files.length - a.files.length || a.owner.localeCompare(b.owner)), unowned };
}

/** Groups unowned files by their top folders, biggest first, to suggest rules. */
export function unownedFolders(unowned: string[], depth = 2): { folder: string; files: number }[] {
  const m = new Map<string, number>();
  for (const f of unowned) {
    const parts = f.split("/");
    const folder = parts.length > 1 ? `/${parts.slice(0, Math.min(depth, parts.length - 1)).join("/")}/` : "/ (root files)";
    m.set(folder, (m.get(folder) ?? 0) + 1);
  }
  return [...m].map(([folder, files]) => ({ folder, files })).sort((a, b) => b.files - a.files || a.folder.localeCompare(b.folder));
}
