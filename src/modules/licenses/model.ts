// Third-party licenses: SPDX expressions read properly (OR picks the most
// permissive choice, AND the most demanding), each dependency sorted into
// permissive / weak copyleft / strong copyleft, conflicts with the
// project's own license explained, and a notices file.

export type Category = "public-domain" | "permissive" | "weak-copyleft" | "strong-copyleft" | "network-copyleft" | "proprietary" | "unknown";

/** Least demanding first; used to pick between OR choices and combine ANDs. */
export const RANK: Record<Category, number> = { "public-domain": 0, permissive: 1, "weak-copyleft": 2, "strong-copyleft": 3, "network-copyleft": 4, proprietary: 5, unknown: 6 };

export const CATEGORY_LABEL: Record<Category, string> = {
  "public-domain": "Public domain",
  permissive: "Permissive",
  "weak-copyleft": "Weak copyleft",
  "strong-copyleft": "Strong copyleft",
  "network-copyleft": "Network copyleft",
  proprietary: "Proprietary / no license",
  unknown: "Unknown",
};

const PUBLIC = new Set(["CC0-1.0", "Unlicense", "0BSD", "WTFPL", "CC-PDDC", "MIT-0", "BlueOak-1.0.0"]);
const PERMISSIVE = /^(MIT|ISC|Apache-[12]\.\d|BSD-[1234]-Clause(-\w+)?|BSD-2-Clause-Patent|Zlib|zlib-acknowledgement|PSF-2\.0|Python-2\.0(\.1)?|BSL-1\.0|Unicode-(DFS-2016|3\.0)|X11|NCSA|PostgreSQL|OpenSSL|CC-BY-[34]\.0|Artistic-2\.0|AFL-[123]\.\d|Ruby|curl|HPND|MIT-CMU|ICU|W3C|Libpng|libpng-2\.0|BSD-Source-Code|OFL-1\.1)$/;
const WEAK = /^(LGPL-[23]\.\d+(-only|-or-later)?\+?|MPL-[12]\.\d(-no-copyleft-exception)?|EPL-[12]\.0|CDDL-1\.[01]|EUPL-1\.[12]|CPL-1\.0|MS-RL|OSL-[123]\.\d|CC-BY-SA-[34]\.0|APSL-2\.0)$/;
const STRONG = /^(GPL-[123]\.\d+(-only|-or-later)?\+?|CECILL-2\.[01])$/;
const NETWORK = /^(AGPL-[13]\.\d+(-only|-or-later)?\+?|SSPL-1\.0|OSL-3\.0-network)$/;
const PROPRIETARY = /^(UNLICENSED|SEE LICENSE IN .*|Commercial|Proprietary|BUSL-1\.1|Elastic-2\.0|PolyForm-.*|CC-BY-NC.*)$/i;

/** Common ways people write licenses that are not SPDX ids. */
const ALIASES: Record<string, string> = {
  "apache 2.0": "Apache-2.0",
  "apache-2": "Apache-2.0",
  "apache 2": "Apache-2.0",
  "apache2": "Apache-2.0",
  "apache license 2.0": "Apache-2.0",
  "apache license, version 2.0": "Apache-2.0",
  "apache software license": "Apache-2.0",
  "mit license": "MIT",
  "the mit license": "MIT",
  "mit/x11": "MIT",
  "expat": "MIT",
  "bsd": "BSD-3-Clause",
  "new bsd": "BSD-3-Clause",
  "bsd license": "BSD-3-Clause",
  "simplified bsd": "BSD-2-Clause",
  "isc license": "ISC",
  "gplv2": "GPL-2.0-only",
  "gplv3": "GPL-3.0-only",
  "gpl": "GPL-3.0-or-later",
  "lgpl": "LGPL-3.0-or-later",
  "lgplv3": "LGPL-3.0-only",
  "mpl 2.0": "MPL-2.0",
  "mozilla public license 2.0": "MPL-2.0",
  "public domain": "Unlicense",
  "cc0": "CC0-1.0",
  "python software foundation license": "PSF-2.0",
  "psf": "PSF-2.0",
  "boost": "BSL-1.0",
};

export function normalizeId(id: string): string {
  const t = id.trim().replace(/^["'(]+|["')]+$/g, "");
  const alias = ALIASES[t.toLowerCase()];
  if (alias) return alias;
  // GPL-2.0+ and friends are the deprecated spelling of -or-later.
  return t.replace(/^((?:A|L)?GPL-\d\.\d)\+$/, "$1-or-later").replace(/^((?:A|L)?GPL-\d\.\d)$/, "$1-only");
}

export function categoryOf(id: string): Category {
  const n = normalizeId(id);
  if (!n) return "unknown";
  if (PUBLIC.has(n)) return "public-domain";
  if (PERMISSIVE.test(n)) return "permissive";
  if (WEAK.test(n)) return "weak-copyleft";
  if (NETWORK.test(n)) return "network-copyleft";
  if (STRONG.test(n)) return "strong-copyleft";
  if (PROPRIETARY.test(n)) return "proprietary";
  return "unknown";
}

type Expr = { id: string; exception?: string } | { op: "AND" | "OR"; left: Expr; right: Expr };

/** Parses an SPDX expression (`MIT OR Apache-2.0`, `(A AND B) OR C`, `GPL-2.0 WITH Classpath-exception-2.0`). */
export function parseExpression(input: string): Expr | null {
  // Old npm style: "MIT/Apache-2.0" means either.
  const src = input.trim().replace(/\s*\/\s*(?=[A-Za-z])/g, " OR ");
  const tokens = src.match(/\(|\)|[^\s()]+/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const primary = (): Expr | null => {
    const t = tokens[i++];
    if (t === undefined) return null;
    if (t === "(") {
      const e = orExpr();
      if (tokens[i] === ")") i++;
      return e;
    }
    // Multi-word aliases such as "Apache License 2.0" are kept together.
    let id = t;
    while (peek() && !/^(AND|OR|WITH|and|or|with|\(|\))$/.test(peek() as string)) id += ` ${tokens[i++]}`;
    let exception: string | undefined;
    if (peek()?.toUpperCase() === "WITH") {
      i++;
      exception = tokens[i++];
    }
    return { id: normalizeId(id), exception };
  };
  const andExpr = (): Expr | null => {
    let left = primary();
    while (left && peek()?.toUpperCase() === "AND") {
      i++;
      const right = primary();
      if (!right) break;
      left = { op: "AND", left, right };
    }
    return left;
  };
  const orExpr = (): Expr | null => {
    let left = andExpr();
    while (left && peek()?.toUpperCase() === "OR") {
      i++;
      const right = andExpr();
      if (!right) break;
      left = { op: "OR", left, right };
    }
    return left;
  };
  return tokens.length ? orExpr() : null;
}

/** The category that applies, and the license you would choose under it. */
export function evaluate(e: Expr | null): { category: Category; chosen: string } {
  if (!e) return { category: "unknown", chosen: "" };
  if ("id" in e) {
    let category = categoryOf(e.id);
    // GPL with a linking exception (Classpath, GCC runtime, LLVM) behaves like weak copyleft.
    if (e.exception && category === "strong-copyleft" && /classpath|gcc|llvm|linking|bison|autoconf/i.test(e.exception)) category = "weak-copyleft";
    return { category, chosen: e.exception ? `${e.id} WITH ${e.exception}` : e.id };
  }
  const l = evaluate(e.left);
  const r = evaluate(e.right);
  if (e.op === "OR") return RANK[l.category] <= RANK[r.category] ? l : r;
  return RANK[l.category] >= RANK[r.category] ? { category: l.category, chosen: `${l.chosen} AND ${r.chosen}` } : { category: r.category, chosen: `${l.chosen} AND ${r.chosen}` };
}

/** Reads the license field of a package.json, including the old `licenses` array. */
export function licenseFromPackageJson(pkg: Record<string, unknown>): string {
  const l = pkg.license;
  if (typeof l === "string") return l;
  if (l && typeof l === "object" && typeof (l as { type?: unknown }).type === "string") return (l as { type: string }).type;
  if (Array.isArray(pkg.licenses)) {
    const ids = pkg.licenses.map((x) => (typeof x === "string" ? x : x && typeof x === "object" ? String((x as { type?: unknown }).type ?? "") : "")).filter(Boolean);
    return ids.length > 1 ? `(${ids.join(" OR ")})` : (ids[0] ?? "");
  }
  return "";
}

export interface Package {
  name: string;
  version: string;
  ecosystem: "npm" | "cargo";
  /** As declared. */
  license: string;
  /** Folder holding the package's files, when known (for its license text). */
  dir?: string;
  /** Development-only (not shipped). */
  dev?: boolean;
}

/** Package names and versions from pnpm-lock.yaml (v6–v9). */
export function parsePnpmLock(text: string): { name: string; version: string; dev: boolean }[] {
  const out = new Map<string, { name: string; version: string; dev: boolean }>();
  let section = "";
  for (const line of text.split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      section = line.replace(/:.*$/, "");
      continue;
    }
    if (section !== "packages") continue;
    const m = /^ {2}['"]?\/?((?:@[^/@'"]+\/)?[^@/'"(]+)[@/]([^('":\s]+)/.exec(line);
    if (m && /^ {2}\S/.test(line)) out.set(`${m[1]}@${m[2]}`, { name: m[1], version: m[2], dev: false });
    else if (/^ {4}dev: true/.test(line)) {
      const last = [...out.values()].pop();
      if (last) last.dev = true;
    }
  }
  return [...out.values()];
}

/** Packages from package-lock.json v2/v3, which records each package's license. */
export function parsePackageLock(json: string): Package[] {
  const doc = JSON.parse(json) as { packages?: Record<string, { version?: string; license?: unknown; dev?: boolean; name?: string; link?: boolean }> };
  const out: Package[] = [];
  for (const [path, p] of Object.entries(doc.packages ?? {})) {
    if (!path || p.link) continue;
    const name = p.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    out.push({ name, version: p.version ?? "", ecosystem: "npm", license: licenseFromPackageJson(p as Record<string, unknown>), dir: path, dev: Boolean(p.dev) });
  }
  // The same package can be installed at several paths; keep one per version.
  const seen = new Set<string>();
  return out.filter((p) => (seen.has(`${p.name}@${p.version}`) ? false : (seen.add(`${p.name}@${p.version}`), true)));
}

/** The folder pnpm stores a package in, relative to the project. */
export function pnpmDir(name: string, version: string): string {
  return `node_modules/.pnpm/${name.replace("/", "+")}@${version}/node_modules/${name}`;
}

/** Packages from `cargo metadata --format-version 1`, without the workspace's own crates. */
export function parseCargoMetadata(json: string): Package[] {
  const doc = JSON.parse(json) as { packages?: { id: string; name: string; version: string; license?: string | null; license_file?: string | null; manifest_path: string }[]; workspace_members?: string[] };
  const own = new Set(doc.workspace_members ?? []);
  return (doc.packages ?? [])
    .filter((p) => !own.has(p.id))
    .map((p) => ({ name: p.name, version: p.version, ecosystem: "cargo" as const, license: p.license ?? (p.license_file ? `SEE LICENSE IN ${p.license_file}` : ""), dir: p.manifest_path.replace(/[\\/]Cargo\.toml$/, "") }));
}

export interface Assessed extends Package {
  category: Category;
  chosen: string;
  /** Why this one needs a look, when it does. */
  concern: string | null;
}

export type Distribution = "app" | "library" | "service";

/**
 * What a dependency's license means for this project. `project` is the
 * project's own SPDX license; `distribution` is how it reaches people.
 */
export function assess(pkg: Package, project: string, distribution: Distribution): Assessed {
  const { category, chosen } = evaluate(parseExpression(pkg.license));
  const own = evaluate(parseExpression(project)).category;
  const ownIsCopyleft = own === "strong-copyleft" || own === "network-copyleft";
  let concern: string | null = null;
  if (pkg.dev) return { ...pkg, category, chosen, concern: null };
  switch (category) {
    case "network-copyleft":
      if (own !== "network-copyleft") concern = "Network copyleft: even offering the software over a network obliges you to publish your source under the same license.";
      break;
    case "strong-copyleft":
      if (!ownIsCopyleft && distribution !== "service") concern = `Strong copyleft: distributing it inside your ${distribution === "library" ? "library" : "app"} requires releasing your code under the GPL.`;
      else if (/GPL-2\.0-only/.test(chosen) && /GPL-3|Apache-2\.0/.test(project)) concern = "GPL-2.0-only cannot be combined with GPL-3.0 or Apache-2.0 code.";
      break;
    case "weak-copyleft":
      if (!ownIsCopyleft && distribution !== "service") concern = "Weak copyleft: fine to use, but changes to this package itself must be shared, and LGPL code must stay replaceable (dynamic linking).";
      break;
    case "proprietary":
      concern = /^SEE LICENSE IN/i.test(pkg.license) ? "Custom license terms: read the license file." : "No open-source license: you may not have the right to use or ship it.";
      break;
    case "unknown":
      concern = pkg.license ? `“${pkg.license}” is not a license this tool recognises; read it.` : "No license declared: by default nobody may copy or ship it.";
      break;
    default:
      if (/Apache-2\.0/.test(chosen) && /GPL-2\.0-only/.test(project)) concern = "Apache-2.0 code cannot be included in a GPL-2.0-only project.";
  }
  return { ...pkg, category, chosen, concern };
}

export function summarize(list: Assessed[]): { category: Category; count: number }[] {
  const counts = new Map<Category, number>();
  for (const p of list) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  return [...counts].map(([category, count]) => ({ category, count })).sort((a, b) => RANK[a.category] - RANK[b.category]);
}

/** A THIRD-PARTY-NOTICES text, grouped by license, with license texts where they were found. */
export function noticesText(list: Assessed[], texts: Map<string, string>, projectName: string): string {
  const shipped = list.filter((p) => !p.dev).sort((a, b) => a.name.localeCompare(b.name));
  const byLicense = new Map<string, Assessed[]>();
  for (const p of shipped) {
    const key = p.chosen || p.license || "Unknown";
    byLicense.set(key, [...(byLicense.get(key) ?? []), p]);
  }
  const out: string[] = [`Third-party software in ${projectName}`, "", `${projectName} includes the following ${shipped.length} packages. Their licenses are reproduced below.`, ""];
  for (const [lic, pkgs] of [...byLicense].sort((a, b) => b[1].length - a[1].length)) {
    out.push("=".repeat(72), `${lic} (${pkgs.length})`, "=".repeat(72), "");
    for (const p of pkgs) {
      out.push(`${p.name} ${p.version}`);
      const t = texts.get(`${p.ecosystem}:${p.name}@${p.version}`);
      if (t) out.push("", t.trim(), "");
    }
    out.push("");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

export function toCsv(list: Assessed[]): string {
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return ["ecosystem,name,version,license,category,dev,concern", ...list.map((p) => [p.ecosystem, p.name, p.version, p.license, CATEGORY_LABEL[p.category], p.dev ? "yes" : "no", p.concern ?? ""].map(q).join(","))].join("\n");
}
