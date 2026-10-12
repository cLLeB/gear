// Import graph: which file imports which. Reads import statements from
// JavaScript / TypeScript and Python, resolves the relative ones (and the
// `@/…` alias) to files in the workspace, and answers the questions people
// ask of such a graph: cycles, files nothing imports, the most depended-on.

const JS = /\.(m?[jt]sx?|c[jt]s|vue|svelte)$/i;
const PY = /\.py$/i;

export function isSourceFile(path: string): boolean {
  return (JS.test(path) || PY.test(path)) && !/\.d\.ts$/i.test(path) && !/(^|\/)(node_modules|dist|build|\.next|target|__pycache__|\.venv|venv)\//.test(path);
}

/** Module specifiers a file imports, in order of appearance, without duplicates. */
export function extractImports(path: string, source: string): string[] {
  const found: string[] = [];
  const add = (s: string | undefined) => {
    if (s && !found.includes(s)) found.push(s);
  };
  if (PY.test(path)) {
    // Triple-quoted strings and comments are dropped first so their text is not read as code.
    const code = source.replace(/("""|''')[\s\S]*?\1/g, "").replace(/#.*$/gm, "");
    for (const m of code.matchAll(/^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+([^\n#]+)/gm)) {
      const base = m[1];
      // `from . import a, b` names sibling modules.
      if (/^\.+$/.test(base)) for (const name of m[2].replace(/[()]/g, "").split(",")) add(`${base}${name.trim().split(/\s+as\s+/)[0]}`);
      else add(base);
    }
    for (const m of code.matchAll(/^[ \t]*import[ \t]+([^\n#]+)/gm)) for (const name of m[1].split(",")) add(name.trim().split(/\s+as\s+/)[0]);
    return found.filter(Boolean);
  }
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"`\\])\/\/.*$/gm, "$1");
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[\w*${},\s]+\s+from\s+)?(['"])([^'"\n]+)\1/g,
    /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+(['"])([^'"\n]+)\1/g,
    /\bimport\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g,
    /\brequire\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g,
  ];
  const hits: { at: number; spec: string }[] = [];
  for (const p of patterns) for (const m of code.matchAll(p)) hits.push({ at: m.index ?? 0, spec: m[2] });
  for (const h of hits.sort((a, b) => a.at - b.at)) add(h.spec);
  return found;
}

function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const JS_EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue", ".svelte"];

/**
 * The workspace file a specifier refers to, or null for packages and anything
 * that cannot be found. `aliasRoot` is what `@/` stands for (usually "src").
 */
export function resolveImport(from: string, spec: string, files: Set<string>, aliasRoot = "src"): string | null {
  if (PY.test(from)) {
    const dots = /^\.+/.exec(spec)?.[0].length ?? 0;
    const rest = spec.slice(dots).split(".").filter(Boolean).join("/");
    const bases: string[] = [];
    if (dots) {
      let dir = dirOf(from);
      for (let i = 1; i < dots; i++) dir = dirOf(dir);
      bases.push(dir);
    } else {
      // An absolute import may be relative to the workspace root or to any parent package of the file.
      let dir = dirOf(from);
      bases.push("");
      while (dir) {
        bases.push(dir);
        dir = dirOf(dir);
      }
    }
    for (const base of bases) {
      const stem = normalize(`${base}/${rest}`);
      for (const cand of [`${stem}.py`, `${stem}/__init__.py`]) if (stem && files.has(cand)) return cand;
    }
    return null;
  }
  let target: string;
  if (spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..") target = normalize(`${dirOf(from)}/${spec}`);
  else if (spec.startsWith("@/")) target = normalize(`${aliasRoot}/${spec.slice(2)}`);
  else if (spec.startsWith("~/")) target = normalize(`${aliasRoot}/${spec.slice(2)}`);
  else return null;
  if (files.has(target)) return target;
  // TypeScript sources are often imported with a ".js" extension.
  const bare = target.replace(/\.(m?js|cjs|jsx)$/, "");
  for (const stem of bare === target ? [target] : [target, bare]) {
    for (const ext of JS_EXT) if (files.has(stem + ext)) return stem + ext;
    for (const ext of JS_EXT) if (files.has(`${stem}/index${ext}`)) return `${stem}/index${ext}`;
  }
  return null;
}

export interface Graph {
  files: string[];
  /** file -> files it imports (workspace files only). */
  out: Map<string, string[]>;
  /** file -> files that import it. */
  into: Map<string, string[]>;
  /** file -> package names it imports. */
  packages: Map<string, string[]>;
}

/** The package a bare specifier belongs to: "react/jsx-runtime" -> "react", "@a/b/c" -> "@a/b". */
export function packageOf(spec: string): string {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0].split(".")[0];
}

export function buildGraph(sources: { path: string; source: string }[], aliasRoot = "src"): Graph {
  const files = sources.map((s) => s.path).sort();
  const set = new Set(files);
  const out = new Map<string, string[]>(files.map((f) => [f, []]));
  const into = new Map<string, string[]>(files.map((f) => [f, []]));
  const packages = new Map<string, string[]>();
  for (const { path, source } of sources) {
    const pkgs: string[] = [];
    for (const spec of extractImports(path, source)) {
      const target = resolveImport(path, spec, set, aliasRoot);
      if (target && target !== path) {
        if (!out.get(path)?.includes(target)) {
          out.get(path)?.push(target);
          into.get(target)?.push(path);
        }
      } else if (!target && !spec.startsWith(".") && !spec.startsWith("@/") && !spec.startsWith("~/")) {
        const p = packageOf(spec);
        if (p && !pkgs.includes(p)) pkgs.push(p);
      }
    }
    if (pkgs.length) packages.set(path, pkgs);
  }
  for (const list of into.values()) list.sort();
  return { files, out, into, packages };
}

/** Groups of files that import each other in a loop (Tarjan), largest first. */
export function findCycles(g: Graph): string[][] {
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  // Iterative, so a long import chain cannot overflow the call stack.
  for (const root of g.files) {
    if (index.has(root)) continue;
    const work: { node: string; next: number }[] = [{ node: root, next: 0 }];
    index.set(root, counter);
    low.set(root, counter++);
    stack.push(root);
    onStack.add(root);
    while (work.length) {
      const frame = work[work.length - 1];
      const edges = g.out.get(frame.node) ?? [];
      if (frame.next < edges.length) {
        const to = edges[frame.next++];
        if (!index.has(to)) {
          index.set(to, counter);
          low.set(to, counter++);
          stack.push(to);
          onStack.add(to);
          work.push({ node: to, next: 0 });
        } else if (onStack.has(to)) low.set(frame.node, Math.min(low.get(frame.node) ?? 0, index.get(to) ?? 0));
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.node, Math.min(low.get(parent.node) ?? 0, low.get(frame.node) ?? 0));
      if (low.get(frame.node) === index.get(frame.node)) {
        const group: string[] = [];
        for (;;) {
          const n = stack.pop() as string;
          onStack.delete(n);
          group.push(n);
          if (n === frame.node) break;
        }
        if (group.length > 1) cycles.push(group.sort());
      }
    }
  }
  return cycles.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

const ENTRY = /(^|\/)(index|main|app|cli|server|setup|manage|conftest|__init__|__main__|vite\.config|vitest\.config|tailwind\.config|next\.config|eslint\.config)\.[\w.]+$|\.(test|spec|stories|e2e)\.[\w]+$|(^|\/)test_[^/]+\.py$|_test\.py$/i;

/** Files nothing imports that do not look like an entry point, a test or a config file. */
export function findOrphans(g: Graph): string[] {
  return g.files.filter((f) => (g.into.get(f)?.length ?? 0) === 0 && !ENTRY.test(f));
}

/** Everything reachable from `start` along `edges`, not counting `start` itself. */
export function reachable(start: string, edges: Map<string, string[]>): string[] {
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length) {
    const n = queue.shift() as string;
    for (const m of edges.get(n) ?? [])
      if (!seen.has(m)) {
        seen.add(m);
        queue.push(m);
      }
  }
  seen.delete(start);
  return [...seen].sort();
}

/** Files ranked by how many others import them. */
export function mostImported(g: Graph, top = 20): [string, number][] {
  return g.files
    .map((f): [string, number] => [f, g.into.get(f)?.length ?? 0])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, top);
}

/** Package -> number of files importing it, most used first. */
export function packageUse(g: Graph): [string, number][] {
  const count = new Map<string, number>();
  for (const pkgs of g.packages.values()) for (const p of pkgs) count.set(p, (count.get(p) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** The shortest chain of imports from one file to another, or null when there is none. */
export function importPath(g: Graph, from: string, to: string): string[] | null {
  if (from === to) return [from];
  const prev = new Map<string, string>();
  const queue = [from];
  const seen = new Set([from]);
  while (queue.length) {
    const n = queue.shift() as string;
    for (const m of g.out.get(n) ?? []) {
      if (seen.has(m)) continue;
      seen.add(m);
      prev.set(m, n);
      if (m === to) {
        const path = [to];
        while (path[0] !== from) path.unshift(prev.get(path[0]) as string);
        return path;
      }
      queue.push(m);
    }
  }
  return null;
}

/** Graphviz DOT for the whole graph, for rendering elsewhere. */
export function toDot(g: Graph): string {
  const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
  const lines = ["digraph imports {", "  rankdir=LR;", "  node [shape=box, fontsize=10];"];
  for (const f of g.files) for (const t of g.out.get(f) ?? []) lines.push(`  ${q(f)} -> ${q(t)};`);
  lines.push("}");
  return lines.join("\n");
}
