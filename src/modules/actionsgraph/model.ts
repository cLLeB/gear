// GitHub Actions workflows read as GitHub runs them: the job graph from
// `needs`, matrices expanded with include/exclude, and a simulator that
// answers "if I push this branch with these files changed, which workflows
// and jobs run — and if not, why not".

import { parseYaml } from "@/modules/editor/lib/textTools/yaml";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const strs = (v: unknown): string[] => arr(v).map((x) => String(x));

export interface Filters {
  branches?: string[];
  branchesIgnore?: string[];
  tags?: string[];
  tagsIgnore?: string[];
  paths?: string[];
  pathsIgnore?: string[];
  types?: string[];
}

export interface Trigger {
  event: string;
  filters: Filters;
  /** schedule: cron strings; workflow_dispatch / workflow_call: input names. */
  details: string[];
}

export interface Job {
  id: string;
  name: string;
  needs: string[];
  if: string | null;
  runsOn: string;
  /** Expanded matrix combinations; null when the matrix is computed at run time. */
  matrix: Record<string, unknown>[] | null;
  /** The reusable workflow it calls, if any. */
  uses: string | null;
  steps: { name: string; uses: string | null; run: string | null; if: string | null }[];
  environment: string | null;
  timeout: number | null;
}

export interface Workflow {
  file: string;
  name: string;
  triggers: Trigger[];
  jobs: Job[];
  problems: string[];
}

function filtersOf(v: unknown): Filters {
  const o = obj(v);
  const f: Filters = {};
  if ("branches" in o) f.branches = strs(o.branches);
  if ("branches-ignore" in o) f.branchesIgnore = strs(o["branches-ignore"]);
  if ("tags" in o) f.tags = strs(o.tags);
  if ("tags-ignore" in o) f.tagsIgnore = strs(o["tags-ignore"]);
  if ("paths" in o) f.paths = strs(o.paths);
  if ("paths-ignore" in o) f.pathsIgnore = strs(o["paths-ignore"]);
  if ("types" in o) f.types = strs(o.types);
  return f;
}

/**
 * Expands a matrix the way GitHub does: the product of its axes, minus
 * `exclude` (partial matches), then each `include` added to every
 * combination it does not contradict on an original axis, or as a new
 * combination when it fits none.
 */
export function expandMatrix(matrix: unknown): Record<string, unknown>[] | null {
  if (typeof matrix === "string") return null;
  const m = obj(matrix);
  if (!Object.keys(m).length) return [];
  const axes = Object.entries(m).filter(([k]) => k !== "include" && k !== "exclude");
  if (axes.some(([, v]) => typeof v === "string")) return null;
  let combos: Record<string, unknown>[] = [{}];
  for (const [k, values] of axes) combos = combos.flatMap((c) => arr(values).map((v) => ({ ...c, [k]: v })));
  if (!axes.length) combos = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const excludes = arr(m.exclude).map(obj);
  combos = combos.filter((c) => !excludes.some((e) => Object.entries(e).every(([k, v]) => same(c[k], v))));
  const axisNames = new Set(axes.map(([k]) => k));
  // Includes merge only into the original combinations, never into ones an earlier include created.
  const originals = combos.map((c) => ({ ...c }));
  const result = combos.map((c) => ({ ...c }));
  const added: Record<string, unknown>[] = [];
  for (const incRaw of arr(m.include)) {
    const inc = obj(incRaw);
    let applied = false;
    originals.forEach((orig, i) => {
      // An include may not overwrite an original matrix value; values added by earlier includes can be overwritten.
      if (Object.entries(inc).every(([k, v]) => !axisNames.has(k) || orig[k] === undefined || same(orig[k], v))) {
        Object.assign(result[i], inc);
        applied = true;
      }
    });
    if (!applied) added.push({ ...inc });
  }
  return [...result, ...added];
}

export function parseWorkflow(text: string, file: string): Workflow {
  const problems: string[] = [];
  let doc: Json;
  try {
    doc = obj(parseYaml(text));
  } catch (err) {
    return { file, name: file, triggers: [], jobs: [], problems: [`Not valid YAML: ${err instanceof Error ? err.message : String(err)}`] };
  }
  // YAML 1.1 parsers turn a bare `on` key into true.
  const on = doc.on ?? doc.true;
  const triggers: Trigger[] = [];
  if (typeof on === "string") triggers.push({ event: on, filters: {}, details: [] });
  else if (Array.isArray(on)) for (const e of on) triggers.push({ event: String(e), filters: {}, details: [] });
  else
    for (const [event, cfg] of Object.entries(obj(on))) {
      const details = event === "schedule" ? arr(cfg).map((s) => String(obj(s).cron ?? "")) : event === "workflow_dispatch" || event === "workflow_call" ? Object.keys(obj(obj(cfg).inputs)) : [];
      const f = filtersOf(cfg);
      if (f.branches && f.branchesIgnore) problems.push(`on.${event}: branches and branches-ignore cannot both be set.`);
      if (f.paths && f.pathsIgnore) problems.push(`on.${event}: paths and paths-ignore cannot both be set.`);
      if (f.tags && f.tagsIgnore) problems.push(`on.${event}: tags and tags-ignore cannot both be set.`);
      triggers.push({ event, filters: f, details });
    }
  if (!triggers.length) problems.push("No `on:` triggers; this workflow never runs.");
  const jobs: Job[] = Object.entries(obj(doc.jobs)).map(([id, raw]) => {
    const j = obj(raw);
    const runsOn = j["runs-on"];
    const env = j.environment;
    return {
      id,
      name: typeof j.name === "string" ? j.name : id,
      needs: strs(j.needs),
      if: j.if === undefined ? null : String(j.if),
      runsOn: Array.isArray(runsOn) ? runsOn.join(", ") : typeof runsOn === "object" && runsOn ? String(obj(runsOn).group ?? obj(runsOn).labels ?? "group") : String(runsOn ?? (j.uses ? "" : "?")),
      matrix: obj(j.strategy).matrix === undefined ? [] : expandMatrix(obj(j.strategy).matrix),
      uses: typeof j.uses === "string" ? j.uses : null,
      steps: arr(j.steps).map((s) => {
        const o = obj(s);
        return { name: String(o.name ?? o.uses ?? (typeof o.run === "string" ? o.run.split("\n")[0].slice(0, 60) : "step")), uses: typeof o.uses === "string" ? o.uses : null, run: typeof o.run === "string" ? o.run : null, if: o.if === undefined ? null : String(o.if) };
      }),
      environment: typeof env === "string" ? env : env ? String(obj(env).name ?? "") || null : null,
      timeout: typeof j["timeout-minutes"] === "number" ? (j["timeout-minutes"] as number) : null,
    };
  });
  if (!jobs.length) problems.push("No jobs.");
  const ids = new Set(jobs.map((j) => j.id));
  for (const j of jobs) for (const n of j.needs) if (!ids.has(n)) problems.push(`Job ${j.id} needs ${n}, which does not exist.`);
  for (const j of jobs) if (!j.uses && !j.runsOn) problems.push(`Job ${j.id} has no runs-on.`);
  const cycle = findCycle(jobs);
  if (cycle) problems.push(`Jobs depend on each other in a cycle: ${cycle.join(" → ")}.`);
  return { file, name: typeof doc.name === "string" ? doc.name : file.split("/").pop() ?? file, triggers, jobs, problems };
}

function findCycle(jobs: Job[]): string[] | null {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    if (state.get(id) === 2) return null;
    if (state.get(id) === 1) return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, 1);
    stack.push(id);
    for (const n of byId.get(id)?.needs ?? []) {
      if (!byId.has(n)) continue;
      const c = visit(n);
      if (c) return c;
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const j of jobs) {
    const c = visit(j.id);
    if (c) return c;
  }
  return null;
}

/** Columns for drawing: each job one column right of the furthest job it needs. */
export function levels(jobs: Job[]): string[][] {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const memo = new Map<string, number>();
  const depth = (id: string, seen: Set<string>): number => {
    if (memo.has(id)) return memo.get(id) as number;
    if (seen.has(id)) return 0;
    seen.add(id);
    const needs = (byId.get(id)?.needs ?? []).filter((n) => byId.has(n));
    const d = needs.length ? Math.max(...needs.map((n) => depth(n, seen))) + 1 : 0;
    memo.set(id, d);
    return d;
  };
  const cols: string[][] = [];
  for (const j of jobs) (cols[depth(j.id, new Set())] ??= []).push(j.id);
  return cols.map((c) => c ?? []);
}

/**
 * GitHub's filter patterns: `*` stays inside a path segment, `**` crosses
 * them, `?` and `+` repeat the previous character (zero-or-one, one-or-more),
 * `[...]` is a character class.
 */
export function filterRegex(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i++;
      } else re += "[^/]*";
    } else if (ch === "?" || ch === "+") re += ch;
    else if (ch === "[") {
      const end = pattern.indexOf("]", i);
      if (end > i) {
        re += pattern.slice(i, end + 1);
        i = end;
      } else re += "\\[";
    } else re += ch.replace(/[.^${}()|\\/]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** Positive and `!` patterns in order: the last pattern that matches decides. */
export function matchesList(value: string, patterns: string[]): boolean {
  let hit = false;
  for (const p of patterns) {
    const neg = p.startsWith("!");
    if (filterRegex(neg ? p.slice(1) : p).test(value)) hit = !neg;
  }
  return hit;
}

export interface SimEvent {
  /** push, pull_request, pull_request_target, workflow_dispatch, schedule, release, … */
  name: string;
  /** Branch pushed, or the pull request's base branch. */
  branch: string;
  /** Tag pushed (push only); when set, `branch` is ignored for push. */
  tag: string | null;
  /** pull_request activity type. */
  type: string;
  changedFiles: string[];
}

export type Verdict = "runs" | "skipped" | "maybe";

export interface JobOutcome {
  job: Job;
  verdict: Verdict;
  reason: string;
}

export interface WorkflowOutcome {
  workflow: Workflow;
  runs: boolean;
  reason: string;
  jobs: JobOutcome[];
}

const PR_DEFAULT_TYPES = ["opened", "synchronize", "reopened"];

/** Whether `trigger` fires for `ev`, and why not when it does not. */
export function triggerFires(t: Trigger, ev: SimEvent): { fires: boolean; reason: string } {
  const f = t.filters;
  if (t.event !== ev.name) return { fires: false, reason: "" };
  if ((ev.name === "pull_request" || ev.name === "pull_request_target") && !(f.types ?? PR_DEFAULT_TYPES).includes(ev.type)) return { fires: false, reason: `only for ${ev.name} types ${(f.types ?? PR_DEFAULT_TYPES).join(", ")}` };
  if (ev.name === "push" || ev.name === "pull_request" || ev.name === "pull_request_target") {
    const isTag = ev.name === "push" && !!ev.tag;
    const hasBranchFilter = !!(f.branches || f.branchesIgnore);
    const hasTagFilter = !!(f.tags || f.tagsIgnore);
    if (isTag) {
      // Only branch filters: tag pushes do not run. Neither: everything runs.
      if (hasBranchFilter && !hasTagFilter) return { fires: false, reason: "only branch pushes (branches filter without tags)" };
      if (f.tags && !matchesList(ev.tag as string, f.tags)) return { fires: false, reason: `tag ${ev.tag} is not in tags: ${f.tags.join(", ")}` };
      if (f.tagsIgnore && matchesList(ev.tag as string, f.tagsIgnore)) return { fires: false, reason: `tag ${ev.tag} is in tags-ignore` };
    } else {
      if (ev.name === "push" && hasTagFilter && !hasBranchFilter) return { fires: false, reason: "only tag pushes (tags filter without branches)" };
      const what = ev.name === "push" ? "branch" : "base branch";
      if (f.branches && !matchesList(ev.branch, f.branches)) return { fires: false, reason: `${what} ${ev.branch} is not in branches: ${f.branches.join(", ")}` };
      if (f.branchesIgnore && matchesList(ev.branch, f.branchesIgnore)) return { fires: false, reason: `${what} ${ev.branch} is in branches-ignore` };
    }
    // Path filters are not evaluated for tag pushes.
    if (!isTag) {
      if (f.paths && !ev.changedFiles.some((p) => matchesList(p, f.paths as string[]))) return { fires: false, reason: `no changed file matches paths: ${f.paths.join(", ")}` };
      if (f.pathsIgnore && ev.changedFiles.length && ev.changedFiles.every((p) => matchesList(p, f.pathsIgnore as string[]))) return { fires: false, reason: "every changed file is in paths-ignore" };
    }
  }
  return { fires: true, reason: "" };
}

// ---------------------------------------------------------------- if: expressions

type Val = string | number | boolean | null | undefined;
/** `undefined` means unknown at simulation time. */
type Tri = Val;

export interface ExprContext {
  event_name: string;
  ref: string;
  ref_name: string;
  base_ref: string;
  head_ref: string;
  ref_type: string;
}

/**
 * Evaluates the parts of an `if:` that are known before a run — event name,
 * refs, literals, comparisons, &&, ||, !, startsWith/endsWith/contains and
 * the status functions. Anything else is unknown, and unknown spreads
 * unless && or || settle the answer anyway.
 */
export function evalIf(expr: string, ctx: ExprContext): boolean | undefined {
  const src = expr.trim().replace(/^\$\{\{([\s\S]*)\}\}$/, "$1").trim();
  let i = 0;
  const peek = () => {
    while (/\s/.test(src[i] ?? "")) i++;
    return src.slice(i);
  };
  const eat = (s: string) => {
    if (peek().startsWith(s)) {
      i += s.length;
      return true;
    }
    return false;
  };
  const truthy = (v: Tri): boolean | undefined => (v === undefined ? undefined : !(v === false || v === null || v === 0 || v === ""));
  const lookup = (path: string): Tri => {
    const p = path.toLowerCase();
    if (p === "github.event_name") return ctx.event_name;
    if (p === "github.ref") return ctx.ref;
    if (p === "github.ref_name") return ctx.ref_name;
    if (p === "github.base_ref") return ctx.base_ref;
    if (p === "github.head_ref") return ctx.head_ref;
    if (p === "github.ref_type") return ctx.ref_type;
    return undefined;
  };
  const primary = (): Tri => {
    peek();
    if (eat("(")) {
      const v = or();
      eat(")");
      return v;
    }
    if (eat("!")) {
      const v = truthy(primary());
      return v === undefined ? undefined : !v;
    }
    const rest = peek();
    let m: RegExpExecArray | null;
    if ((m = /^'((?:[^']|'')*)'/.exec(rest))) {
      i += m[0].length;
      return m[1].replace(/''/g, "'");
    }
    if ((m = /^-?\d+(\.\d+)?/.exec(rest))) {
      i += m[0].length;
      return Number(m[0]);
    }
    if ((m = /^(true|false|null)\b/.exec(rest))) {
      i += m[0].length;
      return m[1] === "true" ? true : m[1] === "false" ? false : null;
    }
    if ((m = /^([A-Za-z_][\w-]*)\s*\(/.exec(rest))) {
      i += m[0].length;
      const args: Tri[] = [];
      if (!eat(")")) {
        do args.push(or());
        while (eat(","));
        eat(")");
      }
      const fn = m[1].toLowerCase();
      const s = (v: Tri) => (v === undefined ? undefined : String(v ?? "").toLowerCase());
      if (fn === "success" || fn === "always") return true;
      if (fn === "failure" || fn === "cancelled") return false;
      if (fn === "startswith" || fn === "endswith" || fn === "contains") {
        const [a, b] = [s(args[0]), s(args[1])];
        if (a === undefined || b === undefined) return undefined;
        return fn === "startswith" ? a.startsWith(b) : fn === "endswith" ? a.endsWith(b) : a.includes(b);
      }
      return undefined;
    }
    if ((m = /^[A-Za-z_][\w-]*(?:\.[\w-]+|\[[^\]]*\])*/.exec(rest))) {
      i += m[0].length;
      return lookup(m[0]);
    }
    i = src.length;
    return undefined;
  };
  const cmp = (): Tri => {
    const l = primary();
    for (const op of ["==", "!=", "<=", ">=", "<", ">"]) {
      if (eat(op)) {
        const r = primary();
        if (l === undefined || r === undefined) return undefined;
        const a = typeof l === "string" ? l.toLowerCase() : l;
        const b = typeof r === "string" ? r.toLowerCase() : r;
        if (op === "==") return a === b;
        if (op === "!=") return a !== b;
        return op === "<" ? (a as number) < (b as number) : op === ">" ? (a as number) > (b as number) : op === "<=" ? (a as number) <= (b as number) : (a as number) >= (b as number);
      }
    }
    return l;
  };
  const and = (): Tri => {
    let l = cmp();
    while (eat("&&")) {
      const r = cmp();
      const tl = truthy(l);
      const tr = truthy(r);
      l = tl === false || tr === false ? false : tl === undefined || tr === undefined ? undefined : r;
    }
    return l;
  };
  function or(): Tri {
    let l = and();
    while (eat("||")) {
      const r = and();
      const tl = truthy(l);
      const tr = truthy(r);
      l = tl === true ? l : tr === true ? r : tl === undefined || tr === undefined ? undefined : r;
    }
    return l;
  }
  const v = or();
  return truthy(v);
}

/** Which jobs of a triggered workflow run: their `if:`, and the jobs they need. */
export function simulateJobs(w: Workflow, ctx: ExprContext): JobOutcome[] {
  const byId = new Map(w.jobs.map((j) => [j.id, j]));
  const out = new Map<string, JobOutcome>();
  const visit = (id: string, seen: Set<string>): JobOutcome => {
    const done = out.get(id);
    if (done) return done;
    const job = byId.get(id) as Job;
    if (seen.has(id)) return { job, verdict: "maybe", reason: "dependency cycle" };
    seen.add(id);
    const needs = job.needs.filter((n) => byId.has(n)).map((n) => visit(n, seen));
    const ifText = job.if ?? "";
    const ignoresStatus = /\b(always|failure|cancelled)\s*\(/.test(ifText) || /\bsuccess\s*\(\s*\)\s*\|\|/.test(ifText);
    let result: JobOutcome;
    const skippedNeed = needs.find((n) => n.verdict === "skipped");
    if (skippedNeed && !ignoresStatus) result = { job, verdict: "skipped", reason: `needs ${skippedNeed.job.id}, which is skipped` };
    else {
      const cond = job.if === null ? true : evalIf(job.if, ctx);
      if (cond === false) result = { job, verdict: "skipped", reason: `if: ${job.if}` };
      else if (cond === undefined) result = { job, verdict: "maybe", reason: `depends on if: ${job.if}` };
      else if (needs.some((n) => n.verdict === "maybe") && !ignoresStatus) result = { job, verdict: "maybe", reason: `needs ${needs.filter((n) => n.verdict === "maybe").map((n) => n.job.id).join(", ")}` };
      else result = { job, verdict: "runs", reason: "" };
    }
    out.set(id, result);
    return result;
  };
  return w.jobs.map((j) => visit(j.id, new Set()));
}

export function simulate(workflows: Workflow[], ev: SimEvent): WorkflowOutcome[] {
  const isPr = ev.name === "pull_request" || ev.name === "pull_request_target";
  const ctx: ExprContext = {
    event_name: ev.name,
    ref: ev.name === "push" && ev.tag ? `refs/tags/${ev.tag}` : isPr ? "refs/pull/1/merge" : `refs/heads/${ev.branch}`,
    ref_name: ev.name === "push" && ev.tag ? ev.tag : isPr ? "1/merge" : ev.branch,
    base_ref: isPr ? ev.branch : "",
    head_ref: isPr ? "feature" : "",
    ref_type: ev.name === "push" && ev.tag ? "tag" : "branch",
  };
  return workflows.map((w) => {
    const relevant = w.triggers.filter((t) => t.event === ev.name);
    if (!relevant.length) return { workflow: w, runs: false, reason: `not triggered by ${ev.name} (on: ${w.triggers.map((t) => t.event).join(", ") || "nothing"})`, jobs: [] };
    const results = relevant.map((t) => triggerFires(t, ev));
    const fired = results.some((r) => r.fires);
    if (!fired) return { workflow: w, runs: false, reason: results.map((r) => r.reason).join("; "), jobs: [] };
    return { workflow: w, runs: true, reason: "", jobs: simulateJobs(w, ctx) };
  });
}
