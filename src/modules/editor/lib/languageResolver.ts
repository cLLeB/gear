import {
  Language,
  LanguageDescription,
  LanguageSupport,
} from "@codemirror/language";
import type { Extension } from "@codemirror/state";

type LoaderResult = Extension | { token: unknown };
type LanguageLoader = () => Promise<LoaderResult>;

const rubyLoader: LanguageLoader = () =>
  import("@codemirror/legacy-modes/mode/ruby").then((m) => m.ruby);

const jsonLoader: LanguageLoader = () =>
  import("@codemirror/lang-json").then((m) => m.json());

const sqlLoader: LanguageLoader = () =>
  import("@codemirror/legacy-modes/mode/sql").then((m) => m.standardSQL);
const pgsqlLoader: LanguageLoader = () =>
  import("@codemirror/legacy-modes/mode/sql").then((m) => m.pgSQL);
const mysqlLoader: LanguageLoader = () =>
  import("@codemirror/legacy-modes/mode/sql").then((m) => m.mySQL);
const sqliteLoader: LanguageLoader = () =>
  import("@codemirror/legacy-modes/mode/sql").then((m) => m.sqlite);
const mariadbLoader: LanguageLoader = () =>
  import("@codemirror/legacy-modes/mode/sql").then((m) => m.mariaDB);
const mssqlLoader: LanguageLoader = () =>
  import("@codemirror/legacy-modes/mode/sql").then((m) => m.msSQL);
const plsqlLoader: LanguageLoader = () =>
  import("@codemirror/legacy-modes/mode/sql").then((m) => m.plSQL);

/**
 * Extension → loader. Each loader is a dynamic import so language packs
 * only enter the bundle when a matching file is opened.
 *
 * Loaders may return either a ready Extension (lang-* packages) or a raw
 * StreamParser (legacy-modes). `resolveLanguage` wraps the latter in
 * StreamLanguage before returning.
 */
const loaders: Record<string, LanguageLoader> = {
  // JavaScript / TypeScript family
  js: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
  jsx: () =>
    import("@codemirror/lang-javascript").then((m) =>
      m.javascript({ jsx: true }),
    ),
  mjs: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
  cjs: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
  ts: () =>
    import("@codemirror/lang-javascript").then((m) =>
      m.javascript({ typescript: true }),
    ),
  tsx: () =>
    import("@codemirror/lang-javascript").then((m) =>
      m.javascript({ jsx: true, typescript: true }),
    ),

  rs: () => import("@codemirror/lang-rust").then((m) => m.rust()),
  go: () => import("@codemirror/lang-go").then((m) => m.go()),
  py: () => import("@codemirror/lang-python").then((m) => m.python()),
  json: jsonLoader,
  jsonc: jsonLoader,
  json5: jsonLoader,

  sql: sqlLoader,
  psql: pgsqlLoader,
  pgsql: pgsqlLoader,
  mysql: mysqlLoader,
  sqlite: sqliteLoader,
  mariadb: mariadbLoader,
  mssql: mssqlLoader,
  plsql: plsqlLoader,

  // markdownLanguage = GFM (tables, task lists, strikethrough, autolinks);
  // fenced code blocks highlight through the shared lazy language registry,
  // plus clickable task checkboxes and Cmd/Ctrl+click links.
  md: () =>
    Promise.all([
      import("@codemirror/lang-markdown"),
      import("./markdownExtras"),
    ]).then(([m, extras]) => [
      m.markdown({
        base: m.markdownLanguage,
        codeLanguages: extras.markdownCodeLanguages(),
      }),
      extras.markdownExtras(),
    ]),
  markdown: () =>
    Promise.all([
      import("@codemirror/lang-markdown"),
      import("./markdownExtras"),
    ]).then(([m, extras]) => [
      m.markdown({
        base: m.markdownLanguage,
        codeLanguages: extras.markdownCodeLanguages(),
      }),
      extras.markdownExtras(),
    ]),

  html: () => import("@codemirror/lang-html").then((m) => m.html()),
  htm: () => import("@codemirror/lang-html").then((m) => m.html()),
  astro: () =>
    import("@codemirror/lang-html").then((m) =>
      m.html({ selfClosingTags: true }),
    ),
  css: () => import("@codemirror/lang-css").then((m) => m.css()),

  php: () => import("@codemirror/lang-php").then((m) => m.php({ plain: true })),
  rb: rubyLoader,
  rake: rubyLoader,
  gemspec: rubyLoader,
  ru: rubyLoader,

  // C / C++ family
  c: () => import("@codemirror/legacy-modes/mode/clike").then((m) => m.c),
  h: () => import("@codemirror/legacy-modes/mode/clike").then((m) => m.c),
  cpp: () => import("@codemirror/legacy-modes/mode/clike").then((m) => m.cpp),
  cc: () => import("@codemirror/legacy-modes/mode/clike").then((m) => m.cpp),
  cxx: () => import("@codemirror/legacy-modes/mode/clike").then((m) => m.cpp),
  hpp: () => import("@codemirror/legacy-modes/mode/clike").then((m) => m.cpp),
  hxx: () => import("@codemirror/legacy-modes/mode/clike").then((m) => m.cpp),

  // Java
  java: () => import("@codemirror/legacy-modes/mode/clike").then((m) => m.java),

  // C#
  cs: () => import("@codemirror/legacy-modes/mode/clike").then((m) => m.csharp),

  // Legacy-modes: loaders return the raw StreamParser; wrapped below.
  sh: () => import("@codemirror/legacy-modes/mode/shell").then((m) => m.shell),
  bash: () =>
    import("@codemirror/legacy-modes/mode/shell").then((m) => m.shell),
  zsh: () => import("@codemirror/legacy-modes/mode/shell").then((m) => m.shell),
  toml: () => import("@codemirror/legacy-modes/mode/toml").then((m) => m.toml),
  yaml: () => import("@codemirror/legacy-modes/mode/yaml").then((m) => m.yaml),
  yml: () => import("@codemirror/legacy-modes/mode/yaml").then((m) => m.yaml),
  dockerfile: () =>
    import("@codemirror/legacy-modes/mode/dockerfile").then(
      (m) => m.dockerFile,
    ),

  // Swift
  swift: () =>
    import("@codemirror/legacy-modes/mode/swift").then((m) => m.swift),

  // Vue single-file components and Twig templates use the HTML grammar.
  vue: () => import("@codemirror/lang-html").then((m) => m.html()),
  twig: () => import("@codemirror/lang-html").then((m) => m.html()),

  // LaTeX / TeX
  tex: () => import("@codemirror/legacy-modes/mode/stex").then((m) => m.stex),
  latex: () =>
    import("@codemirror/legacy-modes/mode/stex").then((m) => m.stex),
  sty: () => import("@codemirror/legacy-modes/mode/stex").then((m) => m.stex),
  cls: () => import("@codemirror/legacy-modes/mode/stex").then((m) => m.stex),

  // .env files: shell mode highlights KEY=value and $VAR references well.
  env: () => import("@codemirror/legacy-modes/mode/shell").then((m) => m.shell),
};

const filenameOverrides: Record<string, LanguageLoader> = {
  dockerfile: loaders.dockerfile!,
  "dockerfile.dev": loaders.dockerfile!,
  gemfile: rubyLoader,
  rakefile: rubyLoader,
  podfile: rubyLoader,
  fastfile: rubyLoader,
  guardfile: rubyLoader,
  brewfile: rubyLoader,
};

function extOf(name: string): string | null {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot === -1 || dot === lower.length - 1) return null;
  return lower.slice(dot + 1);
}

function isStreamParser(v: unknown): boolean {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { token?: unknown }).token === "function"
  );
}

const cache = new Map<string, Extension | null>();

function cacheKey(filename: string): string | null {
  const lower = filename.toLowerCase();
  const base = lower.split("/").pop() ?? lower;
  if (filenameOverrides[base]) return `name:${base}`;
  // Any Dockerfile variant: Dockerfile.dev, Dockerfile.prod, Dockerfile.web…
  if (base.startsWith("dockerfile.")) return "name:dockerfile";
  const ext = extOf(base);
  return ext ? `ext:${ext}` : null;
}

export function resolveLanguageSync(filename: string): Extension | null {
  const key = cacheKey(filename);
  return key ? (cache.get(key) ?? null) : null;
}

export async function resolveLanguage(
  filename: string,
): Promise<Extension | null> {
  const key = cacheKey(filename);
  if (!key) return null;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const lower = filename.toLowerCase();
  const base = lower.split("/").pop() ?? lower;
  const loader =
    filenameOverrides[base] ??
    (base.startsWith("dockerfile.")
      ? loaders.dockerfile
      : loaders[extOf(base) ?? ""]);
  if (!loader) {
    cache.set(key, null);
    return null;
  }

  const result = await loader();
  let ext: Extension;
  if (isStreamParser(result)) {
    const { StreamLanguage } = await import("@codemirror/language");
    ext = StreamLanguage.define(
      result as Parameters<typeof StreamLanguage.define>[0],
    );
  } else {
    ext = result as Extension;
  }
  cache.set(key, ext);
  return ext;
}

// Fence languages for markdown code blocks (```ts, ```python). Each lazily
// loads through the same loaders as file extensions; nothing loads until a
// fence names it. Missing loaders are skipped.
const FENCE_LANGS: readonly { name: string; keys: readonly string[] }[] = [
  { name: "JavaScript", keys: ["js", "jsx", "mjs", "cjs"] },
  { name: "TypeScript", keys: ["ts", "tsx"] },
  { name: "Python", keys: ["py"] },
  { name: "Rust", keys: ["rs"] },
  { name: "Go", keys: ["go"] },
  { name: "JSON", keys: ["json"] },
  { name: "HTML", keys: ["html", "htm"] },
  { name: "CSS", keys: ["css"] },
  { name: "PHP", keys: ["php"] },
  { name: "Ruby", keys: ["rb"] },
  { name: "C", keys: ["c", "h"] },
  { name: "C++", keys: ["cpp", "cc", "cxx", "hpp"] },
  { name: "Java", keys: ["java"] },
  { name: "SQL", keys: ["sql"] },
  { name: "Shell", keys: ["sh", "bash", "zsh"] },
  { name: "YAML", keys: ["yaml", "yml"] },
];

let fenceCache: LanguageDescription[] | null = null;
export function codeLanguageDescriptions(): LanguageDescription[] {
  if (fenceCache) return fenceCache;
  fenceCache = FENCE_LANGS.filter((l) => loaders[l.keys[0]]).map((l) =>
    LanguageDescription.of({
      name: l.name,
      alias: [...l.keys],
      extensions: [...l.keys],
      load: async () => {
        const result = await loaders[l.keys[0]]();
        if (result instanceof LanguageSupport) return result;
        if (result instanceof Language) return new LanguageSupport(result);
        if (isStreamParser(result)) {
          const { StreamLanguage } = await import("@codemirror/language");
          return new LanguageSupport(
            StreamLanguage.define(
              result as Parameters<typeof StreamLanguage.define>[0],
            ),
          );
        }
        throw new Error(`${l.name} not usable inside markdown fences`);
      },
    }),
  );
  return fenceCache;
}

export function preloadLanguages(filenames: string[]): void {
  for (const f of filenames) {
    void resolveLanguage(f).catch(() => {});
  }
}
