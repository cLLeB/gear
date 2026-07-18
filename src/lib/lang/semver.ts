// A semantic-versioning engine: parsing, precedence comparison, and npm-style
// range matching. Anything that reads a package manifest, checks an update, or
// sorts releases needs to compare versions the way the ecosystem does — which is
// not string comparison (`1.9.0` < `1.10.0`) and involves the full prerelease
// precedence rules and the range operators developers actually type: caret
// `^1.2.3`, tilde `~1.2`, x-ranges `1.x`, hyphen ranges `1.0.0 - 2.0.0`, unions
// with `||`, and the plain comparators. This implements the SemVer 2.0.0 spec
// closely enough to drive dependency and updater logic offline.

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: Array<string | number>;
  build: string[];
}

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

/** Parse a version string, or return null if it is not valid SemVer. */
export function parse(version: string): SemVer | null {
  const m = VERSION_RE.exec(version.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split(".").map((id) => (/^\d+$/.test(id) ? Number(id) : id)) : [],
    build: m[5] ? m[5].split(".") : [],
  };
}

/** Compare two versions by precedence: -1, 0, or 1 (build metadata ignored). */
export function compare(a: string | SemVer, b: string | SemVer): number {
  const va = typeof a === "string" ? parse(a) : a;
  const vb = typeof b === "string" ? parse(b) : b;
  if (!va || !vb) throw new Error("compare() requires valid versions");

  for (const key of ["major", "minor", "patch"] as const) {
    if (va[key] !== vb[key]) return va[key] < vb[key] ? -1 : 1;
  }
  return comparePrerelease(va.prerelease, vb.prerelease);
}

/** A version with no prerelease outranks one that has a prerelease. */
function comparePrerelease(a: Array<string | number>, b: Array<string | number>): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1; // 1.0.0 > 1.0.0-rc
  if (b.length === 0) return -1;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const cmp = comparePreId(a[i], b[i]);
    if (cmp !== 0) return cmp;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

function comparePreId(a: string | number, b: string | number): number {
  const an = typeof a === "number";
  const bn = typeof b === "number";
  if (an && bn) return a < b ? -1 : a > b ? 1 : 0;
  if (an) return -1; // numeric identifiers are lower than alphanumeric
  if (bn) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Sort an array of version strings ascending by precedence (new array). */
export function sortVersions(versions: readonly string[]): string[] {
  return [...versions].sort(compare);
}

// --- Ranges ----------------------------------------------------------------

type Op = "<" | "<=" | ">" | ">=" | "=";
interface Comparator {
  op: Op;
  version: SemVer;
}

/** Whether `version` satisfies the npm-style `range`. */
export function satisfies(version: string, range: string): boolean {
  const v = parse(version);
  if (!v) return false;
  const groups = parseRange(range);
  return groups.some((group) => matchesGroup(v, group));
}

/** The highest version in `versions` that satisfies `range`, or null. */
export function maxSatisfying(versions: readonly string[], range: string): string | null {
  const matching = versions.filter((v) => satisfies(v, range));
  if (matching.length === 0) return null;
  return sortVersions(matching)[matching.length - 1];
}

function matchesGroup(v: SemVer, group: Comparator[]): boolean {
  if (!group.every((c) => satisfiesComparator(v, c))) return false;
  // A prerelease version only matches if some comparator names the same
  // [major, minor, patch] tuple with a prerelease (the npm rule).
  if (v.prerelease.length > 0) {
    return group.some(
      (c) => c.version.prerelease.length > 0 && sameTuple(c.version, v),
    );
  }
  return true;
}

function sameTuple(a: SemVer, b: SemVer): boolean {
  return a.major === b.major && a.minor === b.minor && a.patch === b.patch;
}

function satisfiesComparator(v: SemVer, c: Comparator): boolean {
  const cmp = compare(v, c.version);
  switch (c.op) {
    case "<": return cmp < 0;
    case "<=": return cmp <= 0;
    case ">": return cmp > 0;
    case ">=": return cmp >= 0;
    case "=": return cmp === 0;
  }
}

/** Parse a range into an OR of AND-ed comparator groups. */
function parseRange(range: string): Comparator[][] {
  return range
    .split("||")
    .map((part) => parseComparatorSet(part.trim()));
}

function parseComparatorSet(set: string): Comparator[] {
  if (set === "" || set === "*") return [{ op: ">=", version: zero() }];

  // Hyphen range: "1.2.3 - 2.3.4".
  const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(set);
  if (hyphen) return hyphenRange(hyphen[1], hyphen[2]);

  const comparators: Comparator[] = [];
  for (const token of set.split(/\s+/).filter(Boolean)) comparators.push(...parseComparator(token));
  return comparators.length ? comparators : [{ op: ">=", version: zero() }];
}

function parseComparator(token: string): Comparator[] {
  const opMatch = /^(<=|>=|<|>|=)/.exec(token);
  const op = (opMatch?.[1] ?? "") as Op | "";
  const rest = token.slice(opMatch?.[0].length ?? 0);

  if (rest.startsWith("^")) return caretRange(rest.slice(1));
  if (rest.startsWith("~")) return tildeRange(rest.slice(1));

  const parts = partialParts(rest);
  if (op === "" && (parts.wildcard || parts.missing > 0)) return xRange(parts);

  return [{ op: (op || "=") as Op, version: fullOrPartial(rest) }];
}

/** Parse a full version (keeping any prerelease) or fall back to a zero-filled partial. */
function fullOrPartial(raw: string): SemVer {
  const full = parse(raw);
  if (full) return full;
  const p = partialParts(raw);
  return mk(p.major, p.minor, p.patch);
}

// --- Range helpers ---------------------------------------------------------

interface Partial {
  major: number;
  minor: number;
  patch: number;
  /** How many of minor/patch were absent. */
  missing: number;
  wildcard: boolean;
  raw: string;
}

function partialParts(raw: string): Partial {
  const segs = raw.split(".");
  let wildcard = false;
  let missing = 0;
  const nums: number[] = [];
  for (let i = 0; i < 3; i++) {
    const seg = segs[i];
    if (seg === undefined) { missing++; nums.push(0); continue; }
    if (seg === "x" || seg === "X" || seg === "*") { wildcard = true; nums.push(0); continue; }
    nums.push(Number(seg.replace(/[-+].*$/, "")));
  }
  return { major: nums[0], minor: nums[1], patch: nums[2], missing, wildcard, raw };
}

function xRange(p: Partial): Comparator[] {
  const majorWild = p.wildcard && p.raw.split(".")[0]?.match(/[xX*]/);
  if (majorWild || (p.raw === "" )) return [{ op: ">=", version: zero() }];

  // Determine the least-significant defined position.
  const segs = p.raw.split(".");
  const definedMinor = segs[1] !== undefined && !/[xX*]/.test(segs[1]);
  if (!definedMinor) {
    // "1" or "1.x" -> >=1.0.0 <2.0.0
    return [
      { op: ">=", version: mk(p.major, 0, 0) },
      { op: "<", version: mk(p.major + 1, 0, 0) },
    ];
  }
  // "1.2" or "1.2.x" -> >=1.2.0 <1.3.0
  return [
    { op: ">=", version: mk(p.major, p.minor, 0) },
    { op: "<", version: mk(p.major, p.minor + 1, 0) },
  ];
}

function caretRange(raw: string): Comparator[] {
  const p = partialParts(raw);
  const lower = fullOrPartial(raw);
  let upper: SemVer;
  if (p.major > 0) upper = mk(p.major + 1, 0, 0);
  else if (p.minor > 0) upper = mk(0, p.minor + 1, 0);
  else upper = mk(0, 0, p.patch + 1);
  return [{ op: ">=", version: lower }, { op: "<", version: upper }];
}

function tildeRange(raw: string): Comparator[] {
  const p = partialParts(raw);
  const segs = raw.split(".");
  const definedMinor = segs[1] !== undefined && !/[xX*]/.test(segs[1]);
  const lower = fullOrPartial(raw);
  // ~1 -> <2.0.0 ; ~1.2 / ~1.2.3 -> <1.3.0
  const upper = definedMinor ? mk(p.major, p.minor + 1, 0) : mk(p.major + 1, 0, 0);
  return [{ op: ">=", version: lower }, { op: "<", version: upper }];
}

function hyphenRange(lo: string, hi: string): Comparator[] {
  const low = partialParts(lo);
  const lower: Comparator = { op: ">=", version: mk(low.major, low.minor, low.patch) };

  const hiSegs = hi.split(".");
  const hiDefinedMinor = hiSegs[1] !== undefined && !/[xX*]/.test(hiSegs[1]);
  const hiDefinedPatch = hiSegs[2] !== undefined && !/[xX*]/.test(hiSegs[2]);
  const hp = partialParts(hi);

  let upper: Comparator;
  if (!hiDefinedMinor) upper = { op: "<", version: mk(hp.major + 1, 0, 0) };
  else if (!hiDefinedPatch) upper = { op: "<", version: mk(hp.major, hp.minor + 1, 0) };
  else upper = { op: "<=", version: mk(hp.major, hp.minor, hp.patch) };

  return [lower, upper];
}

function mk(major: number, minor: number, patch: number): SemVer {
  return { major, minor, patch, prerelease: [], build: [] };
}

function zero(): SemVer {
  return mk(0, 0, 0);
}
