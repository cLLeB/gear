// What a JavaScript bundle is made of: every byte of the generated file
// attributed, through its source map, to the source file and npm package it
// came from — like source-map-explorer, without leaving the editor.

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX = new Int8Array(128).fill(-1);
for (let i = 0; i < B64.length; i++) B64_INDEX[B64.charCodeAt(i)] = i;

export interface Segment {
  /** 0-based column in the generated line. */
  column: number;
  /** Index into `sources`, or -1 for an unmapped segment. */
  source: number;
}

/** Decodes the `mappings` field into segments per generated line. */
export function decodeMappings(mappings: string): Segment[][] {
  const lines: Segment[][] = [[]];
  let source = 0;
  let column = 0;
  let i = 0;
  const vlq = (): number => {
    let result = 0;
    let shift = 0;
    for (;;) {
      const d = B64_INDEX[mappings.charCodeAt(i++)];
      if (d === undefined || d < 0) throw new Error("The source map's mappings are damaged.");
      result += (d & 31) << shift;
      if (!(d & 32)) break;
      shift += 5;
    }
    return result & 1 ? -(result >>> 1) : result >>> 1;
  };
  while (i < mappings.length) {
    const ch = mappings[i];
    if (ch === ";") {
      lines.push([]);
      column = 0;
      i++;
      continue;
    }
    if (ch === ",") {
      i++;
      continue;
    }
    column += vlq();
    const seg: Segment = { column, source: -1 };
    if (i < mappings.length && mappings[i] !== "," && mappings[i] !== ";") {
      source += vlq();
      seg.source = source;
      vlq(); // original line
      vlq(); // original column
      if (i < mappings.length && mappings[i] !== "," && mappings[i] !== ";") vlq(); // name
    }
    lines[lines.length - 1].push(seg);
  }
  return lines;
}

export interface SourceMap {
  version: number;
  sources: string[];
  mappings: string;
  sourceRoot?: string;
  file?: string;
  sections?: { offset: { line: number; column: number }; map: SourceMap }[];
}

export interface Attribution {
  /** Bytes per source path (UTF-8 of the generated code). */
  bySource: Map<string, number>;
  /** Bytes no mapping covers (bundler glue, comments). */
  unmapped: number;
  total: number;
}

const encoder = new TextEncoder();
const utf8Len = (s: string) => {
  // Fast path for ASCII.
  let ascii = true;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) (ascii = false), (i = s.length);
  return ascii ? s.length : encoder.encode(s).length;
};

/**
 * Splits the generated code's bytes between the sources: each segment owns
 * the text up to the next segment on its line; line breaks go to the
 * segment before them.
 */
export function attribute(code: string, map: SourceMap): Attribution {
  const bySource = new Map<string, number>();
  const add = (src: string | null, n: number) => {
    if (n > 0 && src !== null) bySource.set(src, (bySource.get(src) ?? 0) + n);
  };
  const lines = code.split("\n");
  const flat = flatten(map);
  for (const part of flat) {
    const segs = decodeMappings(part.map.mappings);
    const sources = part.map.sources.map((s) => (part.map.sourceRoot && !/^[a-z]+:/i.test(s) ? `${part.map.sourceRoot.replace(/\/?$/, "/")}${s}` : s));
    for (let li = 0; li < segs.length; li++) {
      const line = lines[li + part.line];
      if (line === undefined) break;
      const startCol = li === 0 ? part.column : 0;
      const row = segs[li].map((s) => ({ ...s, column: s.column + startCol })).sort((a, b) => a.column - b.column);
      // Text before a line's first segment, and lines without segments, stay unmapped.
      if (row.length === 0) continue;
      row.forEach((s, k) => {
        const end = k + 1 < row.length ? row[k + 1].column : line.length;
        add(s.source >= 0 ? (sources[s.source] ?? null) : null, utf8Len(line.slice(s.column, end)) + (k + 1 === row.length && li + part.line < lines.length - 1 ? 1 : 0));
      });
    }
  }
  const total = utf8Len(code);
  const mapped = [...bySource.values()].reduce((a, b) => a + b, 0);
  return { bySource, unmapped: Math.max(0, total - mapped), total };
}

/** Index maps (with `sections`) flattened into maps with an offset. */
function flatten(map: SourceMap): { map: SourceMap; line: number; column: number }[] {
  if (!map.sections) return [{ map, line: 0, column: 0 }];
  return map.sections.flatMap((s) => flatten(s.map).map((p) => ({ map: p.map, line: p.line + s.offset.line, column: p.line === 0 ? p.column + s.offset.column : p.column })));
}

/** A readable path: bundler prefixes, `./` and query strings removed. */
export function cleanSource(src: string): string {
  return src
    .replace(/^(webpack|turbopack|rollup|vite|esbuild|parcel):\/\/\/?(_N_E\/)?/, "")
    .replace(/^\/@fs\//, "/")
    .replace(/^\0/, "")
    .replace(/\?.*$/, "")
    .replace(/^(\.\.?\/)+/, "")
    .replace(/\\/g, "/");
}

export interface PackageInfo {
  name: string;
  version: string | null;
  /** Path inside the package. */
  inner: string;
}

/** The npm package a source path belongs to, from its last `node_modules/` segment (pnpm layouts included). */
export function packageOf(path: string): PackageInfo | null {
  const p = cleanSource(path);
  const idx = p.lastIndexOf("node_modules/");
  if (idx < 0) return null;
  const rest = p.slice(idx + "node_modules/".length);
  const parts = rest.split("/");
  const name = parts[0].startsWith("@") ? `${parts[0]}/${parts[1] ?? ""}` : parts[0];
  const inner = parts.slice(name.split("/").length).join("/");
  // pnpm: node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/…
  const pnpm = /\.pnpm\/((?:@[^+/]+\+)?[^@/]+)@([^_/]+)/.exec(p);
  let version: string | null = null;
  if (pnpm && pnpm[1].replace("+", "/") === name) version = pnpm[2];
  return { name, version, inner };
}

export interface Group {
  name: string;
  bytes: number;
  /** `path` is cleaned for display; `source` is the path as the map wrote it. */
  files: { path: string; source: string; bytes: number }[];
  versions: string[];
}

/** Bytes grouped by package; your own code is grouped by top folder. */
export function groupByPackage(a: Attribution): Group[] {
  const groups = new Map<string, Group>();
  for (const [src, bytes] of a.bySource) {
    const clean = cleanSource(src);
    const pkg = packageOf(clean);
    const key = pkg ? pkg.name : `(your code) ${clean.includes("/") ? clean.slice(0, clean.indexOf("/")) : "."}`;
    const g = groups.get(key) ?? { name: key, bytes: 0, files: [], versions: [] };
    g.bytes += bytes;
    g.files.push({ path: clean, source: src, bytes });
    if (pkg?.version && !g.versions.includes(pkg.version)) g.versions.push(pkg.version);
    groups.set(key, g);
  }
  for (const g of groups.values()) g.files.sort((x, y) => y.bytes - x.bytes);
  return [...groups.values()].sort((x, y) => y.bytes - x.bytes);
}

/**
 * Packages bundled more than once: several versions, or the same version
 * from several install paths (two copies of the same file).
 */
export function duplicates(a: Attribution): { name: string; copies: string[]; bytes: number }[] {
  const byPkg = new Map<string, Map<string, number>>();
  for (const [src, bytes] of a.bySource) {
    const clean = cleanSource(src);
    const pkg = packageOf(clean);
    if (!pkg) continue;
    const root = clean.slice(0, clean.length - pkg.inner.length).replace(/\/$/, "");
    const m = byPkg.get(pkg.name) ?? new Map<string, number>();
    m.set(pkg.version ? `${pkg.version}` : root, (m.get(pkg.version ? `${pkg.version}` : root) ?? 0) + bytes);
    byPkg.set(pkg.name, m);
  }
  return [...byPkg]
    .filter(([, m]) => m.size > 1)
    .map(([name, m]) => {
      const sizes = [...m.values()].sort((x, y) => y - x);
      return { name, copies: [...m.keys()], bytes: sizes.slice(1).reduce((s, b) => s + b, 0) };
    })
    .sort((x, y) => y.bytes - x.bytes);
}

/** Where the map for a bundle lives: the `sourceMappingURL` comment, else `<file>.map`. */
export function mapUrlOf(code: string, file: string): { kind: "inline"; json: string } | { kind: "file"; path: string } {
  const m = /\/\/[#@]\s*sourceMappingURL=([^\s'"]+)\s*$/m.exec(code.slice(-4096));
  if (m) {
    const url = m[1];
    const inline = /^data:application\/json[^,]*?(;base64)?,(.*)$/.exec(url);
    if (inline) {
      const raw = inline[1] ? new TextDecoder().decode(Uint8Array.from(atob(inline[2]), (c) => c.charCodeAt(0))) : decodeURIComponent(inline[2]);
      return { kind: "inline", json: raw };
    }
    const dir = file.replace(/[\\/][^\\/]*$/, "");
    return { kind: "file", path: /^[a-z]:|^\//i.test(url) ? url : `${dir}/${decodeURIComponent(url)}` };
  }
  return { kind: "file", path: `${file}.map` };
}
