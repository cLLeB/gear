// Organize imports for JS/TS and Python without a language server.
//
// JS/TS: the leading import block is parsed (multi-line specifiers, default +
// named + namespace, `import type`), duplicate sources merged, specifiers
// sorted, and statements grouped: node builtins, packages, aliases (@/, ~/,
// #), then relative paths. Side-effect imports (`import "./polyfill"`) are
// order-sensitive, so they split the block into independently sorted runs.
//
// Python: `import x` / `from x import a, b` grouped stdlib, third-party,
// local (relative), as isort's default profile does.

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
const cmp = (a: string, b: string) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);

// ------------------------------------------------------------------ JS/TS

interface JsImport {
  source: string;
  typeOnly: boolean;
  defaultName: string | null;
  namespace: string | null;
  named: string[]; // "a", "b as c", "type T"
  sideEffect: boolean;
  quote: string;
  semi: boolean;
}

const NODE_BUILTINS = new Set(
  "assert buffer child_process cluster crypto dgram dns events fs http http2 https net os path perf_hooks process querystring readline stream string_decoder timers tls tty url util v8 vm worker_threads zlib".split(
    " ",
  ),
);

function jsGroup(source: string): number {
  if (source.startsWith("node:") || NODE_BUILTINS.has(source.split("/")[0])) return 0;
  if (source.startsWith(".")) return 3;
  if (/^(@\/|~\/|#)/.test(source)) return 2;
  return 1;
}

function parseJsImport(stmt: string): JsImport | null {
  const s = stmt.trim();
  const semi = s.endsWith(";");
  const body = semi ? s.slice(0, -1).trim() : s;
  const side = /^import\s+(["'])([^"']+)\1$/.exec(body);
  if (side) return { source: side[2], typeOnly: false, defaultName: null, namespace: null, named: [], sideEffect: true, quote: side[1], semi };
  const m = /^import\s+(type\s+)?([\s\S]+?)\s+from\s+(["'])([^"']+)\3$/.exec(body);
  if (!m) return null;
  let clause = m[2].trim();
  let defaultName: string | null = null;
  let namespace: string | null = null;
  let named: string[] = [];
  const braces = /\{([\s\S]*)\}/.exec(clause);
  if (braces) {
    named = braces[1]
      .split(",")
      .map((x) => x.trim().replace(/\s+/g, " "))
      .filter(Boolean);
    clause = clause.replace(braces[0], "").replace(/,\s*$/, "").trim();
  }
  const ns = /\*\s+as\s+([\w$]+)/.exec(clause);
  if (ns) {
    namespace = ns[1];
    clause = clause.replace(ns[0], "").replace(/,/g, "").trim();
  }
  if (clause) defaultName = clause.replace(/,$/, "").trim() || null;
  return { source: m[4], typeOnly: !!m[1], defaultName, namespace, named, sideEffect: false, quote: m[3], semi };
}

function printJsImport(imp: JsImport, maxWidth = 100): string {
  const end = imp.semi ? ";" : "";
  const q = imp.quote;
  if (imp.sideEffect) return `import ${q}${imp.source}${q}${end}`;
  const head = `import ${imp.typeOnly ? "type " : ""}`;
  const parts: string[] = [];
  if (imp.defaultName) parts.push(imp.defaultName);
  if (imp.namespace) parts.push(`* as ${imp.namespace}`);
  const named = [...new Set(imp.named)].sort((a, b) => cmp(a.replace(/^type /, ""), b.replace(/^type /, "")));
  const tail = ` from ${q}${imp.source}${q}${end}`;
  if (named.length > 0) {
    const one = `${head}${[...parts, `{ ${named.join(", ")} }`].join(", ")}${tail}`;
    if (one.length <= maxWidth) return one;
    return `${head}${[...parts, `{\n${named.map((n) => `  ${n},`).join("\n")}\n}`].join(", ")}${tail}`;
  }
  return `${head}${parts.join(", ")}${tail}`;
}

/** Split the leading import block into statements; returns null when there is none. */
function leadingJsImports(src: string): { start: number; end: number; statements: string[] } | null {
  // Skip shebang, leading comments, "use client"-style directives and blank lines.
  const prologue = /^(?:#![^\n]*\n)?(?:\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/|(["'])use [\w ]+\1;?))*\s*/.exec(src);
  let pos = prologue ? prologue[0].length : 0;
  const start = pos;
  const statements: string[] = [];
  const re = /import\s+(?:type\s+)?(?:[\w$*{}\s,]+?\s+from\s+)?(["'])[^"']+\1\s*;?/y;
  for (;;) {
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m || m.index !== pos) break;
    statements.push(m[0].trim());
    pos = re.lastIndex;
    const ws = /^[ \t]*(\n|$)\s*/.exec(src.slice(pos));
    if (!ws) break;
    pos += ws[0].length;
  }
  if (statements.length === 0) return null;
  // `end` excludes the trailing blank lines so they are kept.
  let end = pos;
  while (end > start && /\s/.test(src[end - 1])) end--;
  return { start, end, statements };
}

export function sortJsImports(src: string): string {
  const block = leadingJsImports(src);
  if (!block) return src;
  const parsed = block.statements.map(parseJsImport);
  if (parsed.some((p) => p === null)) return src; // unknown syntax: leave alone
  const runs: JsImport[][] = [[]];
  const sideEffects: JsImport[] = [];
  for (const imp of parsed as JsImport[]) {
    if (imp.sideEffect) {
      sideEffects.push(imp);
      runs.push([]);
    } else runs[runs.length - 1].push(imp);
  }
  const printRun = (run: JsImport[]): string[] => {
    // Merge same-source, same-kind imports.
    const merged = new Map<string, JsImport>();
    for (const imp of run) {
      const key = `${imp.typeOnly}|${imp.source}`;
      const prev = merged.get(key);
      if (prev && !(prev.defaultName && imp.defaultName) && !(prev.namespace || imp.namespace)) {
        prev.defaultName ??= imp.defaultName;
        prev.named.push(...imp.named);
      } else merged.set(prev ? `${key}|${merged.size}` : key, { ...imp, named: [...imp.named] });
    }
    const list = [...merged.values()].sort(
      (a, b) => jsGroup(a.source) - jsGroup(b.source) || cmp(a.source, b.source) || Number(a.typeOnly) - Number(b.typeOnly),
    );
    const lines: string[] = [];
    let lastGroup = -1;
    for (const imp of list) {
      const g = jsGroup(imp.source);
      if (lastGroup !== -1 && g !== lastGroup) lines.push("");
      lastGroup = g;
      lines.push(printJsImport(imp));
    }
    return lines;
  };
  const out: string[] = [];
  runs.forEach((run, i) => {
    out.push(...printRun(run));
    if (i < sideEffects.length) out.push(printJsImport(sideEffects[i]));
  });
  return src.slice(0, block.start) + out.join("\n") + src.slice(block.end);
}

// ----------------------------------------------------------------- Python

const PY_STDLIB = new Set(
  (
    "abc argparse array ast asyncio base64 bisect builtins calendar collections concurrent contextlib copy csv ctypes " +
    "dataclasses datetime decimal difflib dis email enum errno functools gc getpass glob gzip hashlib heapq hmac html http " +
    "importlib inspect io ipaddress itertools json logging lzma math mimetypes multiprocessing numbers operator os pathlib " +
    "pickle platform pprint queue random re secrets select shelve shlex shutil signal socket sqlite3 ssl stat statistics " +
    "string struct subprocess sys tempfile textwrap threading time timeit tkinter token tokenize traceback types typing " +
    "unicodedata unittest urllib uuid warnings weakref xml zipfile zlib zoneinfo __future__"
  ).split(" "),
);

function pyGroup(module: string): number {
  if (module === "__future__") return -1;
  if (module.startsWith(".")) return 2;
  return PY_STDLIB.has(module.split(".")[0]) ? 0 : 1;
}

export function sortPythonImports(src: string): string {
  const lines = src.split("\n");
  let i = 0;
  // Skip shebang, encoding line, module docstring and comments.
  while (i < lines.length && /^\s*(#.*)?$/.test(lines[i])) i++;
  if (/^\s*("""|''')/.test(lines[i] ?? "")) {
    const q = lines[i].trim().slice(0, 3);
    if (lines[i].trim().length > 3 && lines[i].trim().endsWith(q)) i++;
    else {
      i++;
      while (i < lines.length && !lines[i].includes(q)) i++;
      i++;
    }
    while (i < lines.length && lines[i].trim() === "") i++;
  }
  const start = i;
  type PyImp = { module: string; names: string[] | null; text: string };
  const imports: PyImp[] = [];
  while (i < lines.length) {
    let line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    // Join parenthesised or backslash-continued imports.
    let j = i;
    while ((/\($/.test(line.trim()) || (line.includes("(") && !line.includes(")")) || /\\$/.test(line)) && j + 1 < lines.length) {
      j++;
      line = `${line.replace(/\\$/, "")} ${lines[j].trim()}`;
    }
    const plain = /^import\s+(.+)$/.exec(line.trim());
    const from = /^from\s+(\S+)\s+import\s+\(?\s*(.+?)\s*\)?\s*(#.*)?$/.exec(line.trim());
    if (plain && !plain[1].includes("#")) {
      for (const mod of plain[1].split(",").map((x) => x.trim())) imports.push({ module: mod.split(/\s+as\s+/)[0], names: null, text: `import ${mod}` });
    } else if (from) {
      const names = from[2].split(",").map((x) => x.trim()).filter(Boolean);
      imports.push({ module: from[1], names, text: "" });
    } else break;
    i = j + 1;
  }
  if (imports.length === 0) return src;
  let end = i;
  while (end > start && lines[end - 1].trim() === "") end--;

  const byModule = new Map<string, PyImp>();
  const plainImports: PyImp[] = [];
  for (const imp of imports) {
    if (imp.names === null) {
      if (!plainImports.some((p) => p.text === imp.text)) plainImports.push(imp);
      continue;
    }
    const prev = byModule.get(imp.module);
    if (prev) prev.names!.push(...imp.names);
    else byModule.set(imp.module, { ...imp, names: [...imp.names] });
  }
  const render = (imp: PyImp): string => {
    if (imp.names === null) return imp.text;
    const names = [...new Set(imp.names)].sort((a, b) => cmp(a, b));
    const one = `from ${imp.module} import ${names.join(", ")}`;
    return one.length <= 88 ? one : `from ${imp.module} import (\n${names.map((n) => `    ${n},`).join("\n")}\n)`;
  };
  const all = [...plainImports, ...byModule.values()].sort(
    (a, b) =>
      pyGroup(a.module) - pyGroup(b.module) ||
      // isort: plain "import x" before "from x import" within a group
      Number(a.names !== null) - Number(b.names !== null) ||
      cmp(a.module, b.module),
  );
  const out: string[] = [];
  let last: number | null = null;
  for (const imp of all) {
    const g = pyGroup(imp.module);
    if (last !== null && g !== last) out.push("");
    last = g;
    out.push(render(imp));
  }
  return [...lines.slice(0, start), ...out, ...lines.slice(end)].join("\n");
}
