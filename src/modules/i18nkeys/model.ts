// Translation files (JSON, nested or flat): finding the sets of locale files
// in a workspace, comparing their keys, and editing them without disturbing
// key order or formatting.

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

const LOCALE = /^[a-z]{2,3}([-_][A-Za-z]{2,4})?([-_][A-Za-z0-9]{2,8})?$/;
const LOCALE_DIRS = /(^|\/)(locales?|i18n|lang|langs|languages|translations?|messages|intl|l10n)(\/|$)/i;

export interface LocaleSet {
  /** Shown to the user: the folder, plus the namespace when locales are folders. */
  label: string;
  /** locale code -> file path (relative to the workspace). */
  files: Record<string, string>;
}

/**
 * Groups JSON files into sets of translations. Two layouts are recognised:
 * `locales/en.json`, `locales/fr.json` and `locales/en/common.json`,
 * `locales/fr/common.json`.
 */
export function findLocaleSets(paths: string[]): LocaleSet[] {
  const sets = new Map<string, LocaleSet>();
  const add = (label: string, locale: string, path: string) => {
    const s = sets.get(label) ?? { label, files: {} };
    s.files[locale] = path;
    sets.set(label, s);
  };
  for (const raw of paths) {
    const path = raw.replace(/\\/g, "/");
    if (!/\.json$/i.test(path) || /(^|\/)(node_modules|dist|build|target|\.git)\//.test(path)) continue;
    const parts = path.split("/");
    const stem = parts[parts.length - 1].replace(/\.json$/i, "");
    const dir = parts.slice(0, -1).join("/");
    const parent = parts[parts.length - 2] ?? "";
    if (LOCALE.test(stem) && LOCALE_DIRS.test(`${dir}/`)) add(dir || ".", stem, path);
    else if (LOCALE.test(parent) && LOCALE_DIRS.test(`${parts.slice(0, -2).join("/")}/`)) add(`${parts.slice(0, -2).join("/")}/*/${stem}.json`, parent, path);
  }
  // One file on its own is not a set of translations.
  return [...sets.values()].filter((s) => Object.keys(s.files).length >= 2).sort((a, b) => a.label.localeCompare(b.label));
}

/** `{ a: { b: "x" } }` -> `{ "a.b": "x" }`. Arrays and non-string leaves are kept as JSON text. */
export function flatten(value: Json, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (!keys.length && prefix) out[prefix] = "{}";
    for (const k of keys) flatten(value[k], prefix ? `${prefix}.${k}` : k, out);
  } else if (prefix) out[prefix] = typeof value === "string" ? value : JSON.stringify(value);
  return out;
}

/** True when the file keeps dotted keys at the top level instead of nesting. */
export function isFlat(value: Json): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).some((k) => k.includes(".")) && Object.values(value).every((v) => typeof v !== "object" || v === null);
}

function clone(value: Json): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

/** Sets a key (dotted path, unless the file is flat), creating objects on the way. Returns a new value. */
export function setKey(root: Json, key: string, text: string, flat = isFlat(root)): Json {
  const out = clone(root !== null && typeof root === "object" && !Array.isArray(root) ? root : {}) as { [k: string]: Json };
  if (flat) {
    out[key] = text;
    return out;
  }
  const parts = key.split(".");
  let node = out;
  for (const part of parts.slice(0, -1)) {
    const next = node[part];
    if (next === null || typeof next !== "object" || Array.isArray(next)) node[part] = {};
    node = node[part] as { [k: string]: Json };
  }
  node[parts[parts.length - 1]] = text;
  return out;
}

/** Removes a key and any objects left empty by it. Returns a new value. */
export function deleteKey(root: Json, key: string, flat = isFlat(root)): Json {
  if (root === null || typeof root !== "object" || Array.isArray(root)) return root;
  const out = clone(root) as { [k: string]: Json };
  if (flat || key in out) {
    delete out[key];
    return out;
  }
  const parts = key.split(".");
  const chain: { [k: string]: Json }[] = [out];
  for (const part of parts.slice(0, -1)) {
    const next = chain[chain.length - 1][part];
    if (next === null || typeof next !== "object" || Array.isArray(next)) return out;
    chain.push(next as { [k: string]: Json });
  }
  delete chain[chain.length - 1][parts[parts.length - 1]];
  for (let i = chain.length - 1; i > 0; i--) if (Object.keys(chain[i]).length === 0) delete chain[i - 1][parts[i - 1]];
  return out;
}

export interface Format {
  indent: string;
  eol: string;
  finalNewline: boolean;
}

export function detectFormat(text: string): Format {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const indent = /\n([ \t]+)"/.exec(text)?.[1] ?? "  ";
  return { indent, eol, finalNewline: /\n$/.test(text) || text.trim() === "" };
}

export function serialize(value: Json, format: Format): string {
  const body = JSON.stringify(value, null, format.indent).replace(/\n/g, format.eol);
  return body + (format.finalNewline ? format.eol : "");
}

/** `{name}`, `{{name}}`, `%s` / `%d` / `%1$s`, `$t(key)` and `<0>` tags in a message, sorted. */
export function placeholders(text: string): string[] {
  // The ICU forms `{count, plural, one {…} other {…}}` open a brace that closes much later; only the name matters.
  const found = text.match(/\{\{\s*[\w.]+\s*\}\}|\{\s*[\w.]+\s*,\s*(?:plural|select|selectordinal)\s*,|\{\s*[\w.]+\s*(?:,[^{}]*)?\}|%(?:\d+\$)?[sdif@]|\$t\([^)]+\)|<\/?\d+\/?>/g) ?? [];
  return found.map((p) => p.replace(/\s+/g, "").replace(/^\{([\w.]+),.*$/, "{$1}")).sort();
}

export type Problem = "missing" | "empty" | "same" | "placeholders";

export interface Row {
  key: string;
  /** locale -> text; undefined when the locale lacks the key. */
  values: Record<string, string | undefined>;
  problems: Record<string, Problem | undefined>;
}

/**
 * One row per key found in any locale, in the base locale's order (keys the
 * base lacks come last).
 */
export function compare(locales: Record<string, Record<string, string>>, base: string): Row[] {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const loc of [base, ...Object.keys(locales).filter((l) => l !== base)])
    for (const key of Object.keys(locales[loc] ?? {}))
      if (!seen.has(key)) {
        seen.add(key);
        order.push(key);
      }
  return order.map((key) => {
    const values: Row["values"] = {};
    const problems: Row["problems"] = {};
    const baseText = locales[base]?.[key];
    for (const loc of Object.keys(locales)) {
      const text = locales[loc][key];
      values[loc] = text;
      if (text === undefined) problems[loc] = "missing";
      else if (text.trim() === "") problems[loc] = "empty";
      else if (loc !== base && baseText !== undefined) {
        if (placeholders(text).join("|") !== placeholders(baseText).join("|")) problems[loc] = "placeholders";
        // The same text as the base usually means "not translated yet" — unless it has no letters to translate.
        else if (text === baseText && /\p{L}{3,}/u.test(text)) problems[loc] = "same";
      }
    }
    return { key, values, problems };
  });
}

export function countProblems(rows: Row[], locale: string): Record<Problem, number> {
  const out: Record<Problem, number> = { missing: 0, empty: 0, same: 0, placeholders: 0 };
  for (const r of rows) {
    const p = r.problems[locale];
    if (p) out[p]++;
  }
  return out;
}

/** How much of the base locale's keys a locale covers with non-empty text, 0–100. */
export function coverage(rows: Row[], locale: string, base: string): number {
  const baseKeys = rows.filter((r) => r.values[base] !== undefined);
  if (!baseKeys.length) return 100;
  const done = baseKeys.filter((r) => (r.values[locale] ?? "").trim() !== "").length;
  return Math.round((done / baseKeys.length) * 100);
}

export type Filter = "all" | "problems" | Problem;

export function filterRows(rows: Row[], filter: Filter, query: string): Row[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => {
    if (q && !r.key.toLowerCase().includes(q) && !Object.values(r.values).some((v) => v?.toLowerCase().includes(q))) return false;
    if (filter === "all") return true;
    const ps = Object.values(r.problems).filter(Boolean);
    return filter === "problems" ? ps.length > 0 : ps.includes(filter);
  });
}

/** Why a new key name cannot be used, or null. */
export function keyProblem(key: string, existing: string[]): string | null {
  const k = key.trim();
  if (!k) return "Enter a key.";
  if (/\s/.test(k)) return "A key cannot contain spaces.";
  if (k.startsWith(".") || k.endsWith(".") || k.includes("..")) return "A key cannot start or end with a dot, or contain two in a row.";
  if (existing.includes(k)) return "That key already exists.";
  if (existing.some((e) => e.startsWith(`${k}.`))) return "That name is already a group of keys.";
  if (existing.some((e) => k.startsWith(`${e}.`))) return "Part of that name is already a key with a text.";
  return null;
}
