// SARIF 2.1.0 (Static Analysis Results Interchange Format): what CodeQL,
// Semgrep, ESLint, Trivy, Bandit, gosec and most other scanners write. This
// reads a log into flat findings with their rule, severity, location and
// code-flow path, and compares two logs to show what is new and what got fixed.

export type Level = "error" | "warning" | "note" | "none";
export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type BaselineState = "new" | "unchanged" | "updated" | "absent" | null;

export interface Rule {
  id: string;
  name: string | null;
  short: string | null;
  full: string | null;
  help: string | null;
  helpUri: string | null;
  level: Level;
  tags: string[];
  securitySeverity: number | null;
  precision: string | null;
}

export interface Location {
  /** Workspace-relative (or absolute when outside every base) path, forward slashes. */
  path: string | null;
  line: number | null;
  column: number | null;
  endLine: number | null;
  snippet: string | null;
  message: string | null;
}

export interface Finding {
  index: number;
  tool: string;
  ruleId: string;
  rule: Rule | null;
  level: Level;
  severity: Severity;
  message: string;
  location: Location;
  related: Location[];
  /** Each code flow as its ordered steps (source to sink). */
  flows: Location[][];
  fingerprint: string | null;
  suppressed: boolean;
  baseline: BaselineState;
}

export interface SarifLog {
  tools: { name: string; version: string | null; rules: number }[];
  findings: Finding[];
  /** Problems reading the log that did not stop it (tool notifications, bad entries). */
  notes: string[];
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

const LEVELS: Level[] = ["error", "warning", "note", "none"];
const asLevel = (v: unknown): Level | null => (LEVELS.includes(v as Level) ? (v as Level) : null);

/** `{0}` placeholders filled from `arguments`, and `[text](n)` links reduced to their text. */
export function formatMessage(message: unknown, rule: Json | null): string {
  const m = obj(message);
  let text = str(m.text) ?? str(m.markdown);
  if (text === null && typeof m.id === "string" && rule) {
    const fmt = obj(obj(rule.messageStrings)[m.id]);
    text = str(fmt.text) ?? str(fmt.markdown);
  }
  if (text === null) return "";
  const args = arr(m.arguments).map((a) => String(a));
  return text
    .replace(/\{(\d+)\}/g, (all, n: string) => args[Number(n)] ?? all)
    .replace(/\[([^\]]*)\]\((\d+|https?:[^)]*)\)/g, "$1")
    .trim();
}

/** Bucket like GitHub code scanning: security-severity when present, else the level. */
export function severityOf(level: Level, securitySeverity: number | null): Severity {
  if (securitySeverity !== null) {
    if (securitySeverity >= 9) return "critical";
    if (securitySeverity >= 7) return "high";
    if (securitySeverity >= 4) return "medium";
    if (securitySeverity > 0) return "low";
    return "info";
  }
  return level === "error" ? "high" : level === "warning" ? "medium" : level === "note" ? "low" : "info";
}

export const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];

/**
 * A path from an artifact URI: `file://` URIs decoded, `uriBaseId`s resolved
 * through `originalUriBaseIds`, and anything inside `root` made relative.
 */
export function resolveUri(uri: string, baseId: string | null, bases: Map<string, string>, root: string | null): string {
  let u = uri;
  const seen = new Set<string>();
  let id = baseId;
  while (id && bases.has(id) && !seen.has(id) && !/^[a-z]+:/i.test(u)) {
    seen.add(id);
    const b = bases.get(id) as string;
    u = `${b.replace(/\/?$/, "/")}${u}`;
    id = null;
  }
  let p = u;
  if (/^file:/i.test(p)) {
    p = p.replace(/^file:(\/\/[^/]*)?/i, "");
    try {
      p = decodeURIComponent(p);
    } catch {
      /* keep it encoded */
    }
    if (/^\/[a-z]:/i.test(p)) p = p.slice(1);
  } else if (!/^[a-z][a-z0-9+.-]+:/i.test(p)) {
    try {
      p = decodeURIComponent(p);
    } catch {
      /* keep it encoded */
    }
  }
  p = p.replace(/\\/g, "/").replace(/^\.\//, "");
  if (root) {
    const r = root.replace(/\\/g, "/").replace(/\/+$/, "");
    if (p.toLowerCase().startsWith(`${r.toLowerCase()}/`)) p = p.slice(r.length + 1);
  }
  return p;
}

function readLocation(loc: unknown, bases: Map<string, string>, root: string | null, artifacts: unknown[]): Location {
  const l = obj(loc);
  const phys = obj(l.physicalLocation);
  const art = obj(phys.artifactLocation);
  let uri = str(art.uri);
  let baseId = str(art.uriBaseId);
  const ai = num(art.index);
  if (uri === null && ai !== null) {
    const a = obj(obj(artifacts[ai]).location);
    uri = str(a.uri);
    baseId = baseId ?? str(a.uriBaseId);
  }
  const region = obj(phys.region);
  const context = obj(phys.contextRegion);
  const logical = arr(l.logicalLocations).map((x) => str(obj(x).fullyQualifiedName) ?? str(obj(x).name)).find(Boolean) ?? null;
  return {
    path: uri !== null ? resolveUri(uri, baseId, bases, root) : logical,
    line: num(region.startLine),
    column: num(region.startColumn),
    endLine: num(region.endLine),
    snippet: str(obj(region.snippet).text) ?? str(obj(context.snippet).text),
    message: l.message ? formatMessage(l.message, null) || null : null,
  };
}

function readRule(r: Json): Rule {
  const props = obj(r.properties);
  const ss = props["security-severity"];
  const sec = typeof ss === "string" ? Number.parseFloat(ss) : num(ss);
  return {
    id: str(r.id) ?? "",
    name: str(r.name),
    short: str(obj(r.shortDescription).text),
    full: str(obj(r.fullDescription).text),
    help: str(obj(r.help).markdown) ?? str(obj(r.help).text),
    helpUri: str(r.helpUri),
    level: asLevel(obj(r.defaultConfiguration).level) ?? "warning",
    tags: arr(props.tags).filter((t): t is string => typeof t === "string"),
    securitySeverity: sec !== null && Number.isFinite(sec) ? sec : null,
    precision: str(props.precision),
  };
}

/** Reads a SARIF log. `root` is the workspace, so paths come out relative to it. */
export function parseSarif(text: string, root: string | null = null): SarifLog {
  let doc: Json;
  try {
    doc = obj(JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text));
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  if (!Array.isArray(doc.runs)) throw new Error("This JSON is not a SARIF log (it has no runs).");
  const tools: SarifLog["tools"] = [];
  const findings: Finding[] = [];
  const notes: string[] = [];
  for (const runV of doc.runs) {
    const run = obj(runV);
    const driver = obj(obj(run.tool).driver);
    const toolName = str(driver.name) ?? "Unknown tool";
    const ruleList: Json[] = [driver, ...arr(obj(run.tool).extensions).map(obj)].flatMap((c) => arr(c.rules).map(obj));
    const rules = ruleList.map(readRule);
    const byId = new Map(rules.map((r) => [r.id, r]));
    const rawById = new Map(ruleList.map((r) => [str(r.id) ?? "", r]));
    tools.push({ name: toolName, version: str(driver.semanticVersion) ?? str(driver.version), rules: rules.length });
    const bases = new Map<string, string>();
    for (const [k, v] of Object.entries(obj(run.originalUriBaseIds))) {
      const u = str(obj(v).uri);
      if (u) bases.set(k, u);
    }
    const artifacts = arr(run.artifacts);
    for (const inv of arr(run.invocations)) {
      for (const n of arr(obj(inv).toolExecutionNotifications)) {
        const t = formatMessage(obj(n).message, null);
        if (t && obj(n).level === "error") notes.push(`${toolName}: ${t}`);
      }
    }
    arr(run.results).forEach((resV) => {
      const res = obj(resV);
      const ri = num(res.ruleIndex) ?? num(obj(res.rule).index);
      const ruleId = str(res.ruleId) ?? str(obj(res.rule).id) ?? (ri !== null ? (rules[ri]?.id ?? "") : "");
      const rule = (ri !== null ? rules[ri] : undefined) ?? byId.get(ruleId) ?? (ruleId.includes("/") ? byId.get(ruleId.split("/")[0]) : undefined) ?? null;
      const kind = str(res.kind);
      if (kind === "pass" || kind === "notApplicable") return;
      const level = asLevel(res.level) ?? (kind && kind !== "fail" ? "note" : (rule?.level ?? "warning"));
      const locs = arr(res.locations);
      const location = locs.length ? readLocation(locs[0], bases, root, artifacts) : { path: null, line: null, column: null, endLine: null, snippet: null, message: null };
      const flows = arr(res.codeFlows).flatMap((cf) =>
        arr(obj(cf).threadFlows).map((tf) =>
          arr(obj(tf).locations)
            .map((step) => readLocation(obj(step).location, bases, root, artifacts))
            .filter((s) => s.path !== null),
        ),
      );
      const fps = { ...obj(res.partialFingerprints), ...obj(res.fingerprints) };
      const fpKey = Object.keys(fps).sort()[0];
      const resProps = obj(res.properties);
      const ss = resProps["security-severity"];
      const resSec = typeof ss === "string" ? Number.parseFloat(ss) : num(ss);
      const sec = resSec !== null && Number.isFinite(resSec) ? resSec : (rule?.securitySeverity ?? null);
      const bs = str(res.baselineState);
      findings.push({
        index: findings.length,
        tool: toolName,
        ruleId,
        rule,
        level,
        severity: severityOf(level, sec),
        message: formatMessage(res.message, rawById.get(ruleId) ?? null) || rule?.short || ruleId,
        location,
        related: arr(res.relatedLocations).map((l) => readLocation(l, bases, root, artifacts)),
        flows: flows.filter((f) => f.length > 0),
        fingerprint: fpKey ? `${fpKey}:${String(fps[fpKey])}` : null,
        suppressed: arr(res.suppressions).some((s) => (str(obj(s).status) ?? "accepted") === "accepted"),
        baseline: bs === "new" || bs === "unchanged" || bs === "updated" || bs === "absent" ? bs : null,
      });
    });
  }
  return { tools, findings, notes };
}

/**
 * What identifies a finding across two scans: its fingerprint when the tool
 * wrote one, else rule, file and message with numbers taken out (line
 * numbers move when code above changes).
 */
export function findingKey(f: Finding): string {
  if (f.fingerprint) return `${f.tool}|${f.ruleId}|${f.fingerprint}`;
  return `${f.tool}|${f.ruleId}|${f.location.path ?? ""}|${f.message.replace(/\d+/g, "#")}|${(f.location.snippet ?? "").trim()}`;
}

export interface Comparison {
  added: Finding[];
  fixed: Finding[];
  unchanged: Finding[];
}

/** Matches findings of `current` against `baseline`, counting duplicates of the same key. */
export function compare(current: Finding[], baseline: Finding[]): Comparison {
  const pool = new Map<string, Finding[]>();
  for (const f of baseline) pool.set(findingKey(f), [...(pool.get(findingKey(f)) ?? []), f]);
  const added: Finding[] = [];
  const unchanged: Finding[] = [];
  for (const f of current) {
    const list = pool.get(findingKey(f));
    if (list?.length) {
      list.shift();
      unchanged.push(f);
    } else added.push(f);
  }
  const fixed = [...pool.values()].flat();
  return { added, fixed, unchanged };
}

export interface Filter {
  text: string;
  severities: Set<Severity>;
  tool: string | null;
  showSuppressed: boolean;
}

export function filterFindings(findings: Finding[], f: Filter): Finding[] {
  const q = f.text.trim().toLowerCase();
  return findings.filter(
    (x) =>
      (f.showSuppressed || !x.suppressed) &&
      (f.severities.size === 0 || f.severities.has(x.severity)) &&
      (!f.tool || x.tool === f.tool) &&
      (!q || `${x.ruleId} ${x.rule?.name ?? ""} ${x.message} ${x.location.path ?? ""} ${x.rule?.tags.join(" ") ?? ""}`.toLowerCase().includes(q)),
  );
}

export type GroupBy = "rule" | "file" | "severity";

export function groupFindings(findings: Finding[], by: GroupBy): { key: string; findings: Finding[] }[] {
  const m = new Map<string, Finding[]>();
  for (const f of findings) {
    const k = by === "rule" ? f.ruleId || "(no rule)" : by === "file" ? (f.location.path ?? "(no location)") : f.severity;
    m.set(k, [...(m.get(k) ?? []), f]);
  }
  const rank = (fs: Finding[]) => Math.min(...fs.map((f) => SEVERITY_ORDER.indexOf(f.severity)));
  return [...m]
    .map(([key, fs]) => ({ key, findings: fs.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || (a.location.path ?? "").localeCompare(b.location.path ?? "") || (a.location.line ?? 0) - (b.location.line ?? 0)) }))
    .sort((a, b) => (by === "severity" ? SEVERITY_ORDER.indexOf(a.key as Severity) - SEVERITY_ORDER.indexOf(b.key as Severity) : rank(a.findings) - rank(b.findings) || b.findings.length - a.findings.length || a.key.localeCompare(b.key)));
}

/** A Markdown summary for a pull request or an issue. */
export function toMarkdown(log: SarifLog, findings: Finding[], cmp: Comparison | null): string {
  const count = (s: Severity) => findings.filter((f) => f.severity === s).length;
  const lines = [
    `## Static analysis: ${log.tools.map((t) => `${t.name}${t.version ? ` ${t.version}` : ""}`).join(", ")}`,
    "",
    `${findings.length} finding${findings.length === 1 ? "" : "s"}: ${SEVERITY_ORDER.map((s) => `${count(s)} ${s}`).join(", ")}.`,
  ];
  if (cmp) lines.push("", `Compared with the baseline: ${cmp.added.length} new, ${cmp.fixed.length} fixed, ${cmp.unchanged.length} unchanged.`);
  const shown = cmp ? cmp.added : findings;
  if (shown.length) {
    lines.push("", "| Severity | Rule | Location | Message |", "|---|---|---|---|");
    for (const f of shown.slice(0, 100)) {
      const loc = f.location.path ? `\`${f.location.path}${f.location.line ? `:${f.location.line}` : ""}\`` : "";
      lines.push(`| ${f.severity} | ${f.ruleId} | ${loc} | ${f.message.replace(/\|/g, "\\|").replace(/\s+/g, " ").slice(0, 200)} |`);
    }
    if (shown.length > 100) lines.push("", `…and ${shown.length - 100} more.`);
  }
  return lines.join("\n");
}
