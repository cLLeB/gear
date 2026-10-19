// Test datasets: tables of typed columns (with ranges, enums, patterns,
// uniqueness, nulls and foreign keys between tables), generated from a
// seed so the same settings give the same rows, and written as JSON,
// NDJSON, CSV or SQL INSERTs. A schema can start from a JSON sample or a
// CREATE TABLE statement.

export type ColumnType =
  | "id"
  | "uuid"
  | "int"
  | "float"
  | "bool"
  | "firstName"
  | "lastName"
  | "fullName"
  | "email"
  | "username"
  | "phone"
  | "company"
  | "street"
  | "city"
  | "country"
  | "zip"
  | "date"
  | "datetime"
  | "words"
  | "sentence"
  | "paragraph"
  | "enum"
  | "pattern"
  | "url"
  | "ipv4"
  | "color"
  | "price"
  | "ref";

export interface Column {
  name: string;
  type: ColumnType;
  /** int / float / price / date range; dates as ISO strings. */
  min?: number | string;
  max?: number | string;
  decimals?: number;
  /** enum values, optionally `value:weight`. */
  values?: string[];
  /** pattern: `#` digit, `A` capital letter, `a` small letter, `?` letter or digit, `\` escapes. */
  pattern?: string;
  /** ref: `table.column`. */
  ref?: string;
  unique?: boolean;
  /** 0–1 share of rows left empty. */
  nullRatio?: number;
  /** bool: share of true. */
  trueRatio?: number;
}

export interface Table {
  name: string;
  rows: number;
  columns: Column[];
}

export type Value = string | number | boolean | null;
export type Row = Record<string, Value>;

export const TYPE_LABEL: Record<ColumnType, string> = {
  id: "Sequence (1, 2, 3…)",
  uuid: "UUID",
  int: "Whole number",
  float: "Decimal number",
  bool: "True / false",
  firstName: "First name",
  lastName: "Last name",
  fullName: "Full name",
  email: "Email",
  username: "Username",
  phone: "Phone",
  company: "Company",
  street: "Street address",
  city: "City",
  country: "Country",
  zip: "Postcode",
  date: "Date",
  datetime: "Date and time",
  words: "A few words",
  sentence: "Sentence",
  paragraph: "Paragraph",
  enum: "One of a list",
  pattern: "Pattern (AA-####)",
  url: "URL",
  ipv4: "IPv4 address",
  color: "Colour (hex)",
  price: "Price",
  ref: "Reference to another table",
};

/** mulberry32: small, fast, and the same everywhere for a given seed. */
export function rngFrom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Ada", "Alan", "Grace", "Linus", "Margaret", "Dennis", "Barbara", "Ken", "Radia", "Tim", "Hedy", "Guido", "Frances", "Edsger", "Katherine", "Donald", "Shafi", "Yukihiro", "Anita", "Bjarne", "Amara", "Kofi", "Mei", "Ravi", "Sofia", "Mateo", "Leila", "Jonas", "Aisha", "Noah", "Elena", "Omar", "Priya", "Lucas", "Zara", "Kwame"];
const LAST = ["Lovelace", "Turing", "Hopper", "Torvalds", "Hamilton", "Ritchie", "Liskov", "Thompson", "Perlman", "Lamarr", "Allen", "Dijkstra", "Johnson", "Knuth", "Goldwasser", "Matsumoto", "Borg", "Stroustrup", "Mensah", "Boateng", "Chen", "Patel", "Garcia", "Rossi", "Haddad", "Berg", "Okafor", "Nakamura", "Silva", "Kowalski", "Dubois", "Novak"];
const STREETS = ["Maple", "Oak", "Pine", "Cedar", "Elm", "Willow", "Harbor", "Mill", "Station", "Church", "Park", "Lake", "Hill", "River", "Market", "Bridge"];
const STREET_KIND = ["Street", "Avenue", "Road", "Lane", "Way", "Drive", "Court", "Place"];
const CITIES = ["Springfield", "Riverton", "Lakeview", "Fairview", "Kingsport", "Westbrook", "Ashford", "Bayside", "Northwood", "Millbrook", "Accra", "Lisbon", "Osaka", "Toronto", "Nairobi", "Lyon"];
const COUNTRIES = ["Ghana", "Portugal", "Japan", "Canada", "Kenya", "France", "Germany", "Brazil", "India", "Australia", "Mexico", "Norway", "Nigeria", "Spain", "Italy", "Netherlands"];
const COMPANY_A = ["Acme", "Globex", "Initech", "Umbrella", "Hooli", "Vandelay", "Stark", "Wayne", "Soylent", "Tyrell", "Cyberdyne", "Aperture"];
const COMPANY_B = ["Labs", "Systems", "Industries", "Group", "Technologies", "Holdings", "Works", "Dynamics"];
const DOMAINS = ["example.com", "example.org", "example.net", "test.dev"];
const LOREM = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum".split(" ");

type Rng = () => number;
const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)];
const int = (rng: Rng, min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function words(rng: Rng, n: number): string {
  return Array.from({ length: n }, () => pick(rng, LOREM)).join(" ");
}

function sentence(rng: Rng): string {
  const s = words(rng, int(rng, 6, 14));
  return `${s[0].toUpperCase()}${s.slice(1)}.`;
}

function fromPattern(rng: Rng, p: string): string {
  let out = "";
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === "\\" && i + 1 < p.length) out += p[++i];
    else if (ch === "#") out += int(rng, 0, 9);
    else if (ch === "A") out += String.fromCharCode(65 + int(rng, 0, 25));
    else if (ch === "a") out += String.fromCharCode(97 + int(rng, 0, 25));
    else if (ch === "?") out += pick(rng, [..."ABCDEFGHJKLMNPQRSTUVWXYZ23456789"]);
    else out += ch;
  }
  return out;
}

function weighted(rng: Rng, values: string[]): string {
  const items = values.map((v) => {
    const m = /^(.*):(\d+(?:\.\d+)?)$/.exec(v);
    return m ? { v: m[1], w: Number(m[2]) } : { v, w: 1 };
  });
  const total = items.reduce((a, x) => a + x.w, 0);
  let r = rng() * total;
  for (const x of items) {
    r -= x.w;
    if (r < 0) return x.v;
  }
  return items[items.length - 1]?.v ?? "";
}

const dateMs = (v: number | string | undefined, fallback: number) => (v === undefined || v === "" ? fallback : typeof v === "number" ? v : Date.parse(v) || fallback);
const slugName = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, ".");

/** One value for a column; `row` holds the row so far, so emails can follow names. */
export function valueFor(col: Column, rng: Rng, index: number, row: Row): Value {
  const num = (v: number | string | undefined, d: number) => (v === undefined || v === "" ? d : Number(v));
  switch (col.type) {
    case "id":
      return num(col.min, 1) + index;
    case "uuid": {
      const h = Array.from({ length: 32 }, () => int(rng, 0, 15).toString(16));
      h[12] = "4";
      h[16] = (8 + int(rng, 0, 3)).toString(16);
      const s = h.join("");
      return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
    }
    case "int":
      return int(rng, num(col.min, 0), num(col.max, 1000));
    case "float":
    case "price": {
      const lo = num(col.min, col.type === "price" ? 1 : 0);
      const hi = num(col.max, col.type === "price" ? 500 : 1);
      const d = col.decimals ?? 2;
      return Number((lo + rng() * (hi - lo)).toFixed(d));
    }
    case "bool":
      return rng() < (col.trueRatio ?? 0.5);
    case "firstName":
      return pick(rng, FIRST);
    case "lastName":
      return pick(rng, LAST);
    case "fullName":
      return `${pick(rng, FIRST)} ${pick(rng, LAST)}`;
    case "email": {
      const name = Object.values(row).find((v) => typeof v === "string" && /^[A-Z][a-z]+ [A-Z][\w-]+$/.test(v)) as string | undefined;
      const first = (row.first_name ?? row.firstName) as string | undefined;
      const last = (row.last_name ?? row.lastName) as string | undefined;
      const base = name ? slugName(name) : first && last ? slugName(`${first} ${last}`) : slugName(`${pick(rng, FIRST)} ${pick(rng, LAST)}`);
      return `${base}${col.unique ? index + 1 : rng() < 0.3 ? int(rng, 1, 99) : ""}@${pick(rng, DOMAINS)}`;
    }
    case "username":
      return `${pick(rng, FIRST).toLowerCase()}${pick(rng, ["_", ".", ""])}${pick(rng, LAST).toLowerCase().slice(0, int(rng, 3, 6))}${int(rng, 1, 999)}`;
    case "phone":
      return `+1 555 ${pad(int(rng, 100, 999), 3)} ${pad(int(rng, 0, 9999), 4)}`;
    case "company":
      return `${pick(rng, COMPANY_A)} ${pick(rng, COMPANY_B)}`;
    case "street":
      return `${int(rng, 1, 9999)} ${pick(rng, STREETS)} ${pick(rng, STREET_KIND)}`;
    case "city":
      return pick(rng, CITIES);
    case "country":
      return pick(rng, COUNTRIES);
    case "zip":
      return pad(int(rng, 1000, 99999), 5);
    case "date":
    case "datetime": {
      const now = Date.UTC(2026, 0, 1);
      const lo = dateMs(col.min, now - 3 * 365 * 86400000);
      const hi = dateMs(col.max, now);
      const d = new Date(lo + rng() * Math.max(0, hi - lo));
      return col.type === "date" ? d.toISOString().slice(0, 10) : `${d.toISOString().slice(0, 19)}Z`;
    }
    case "words":
      return words(rng, int(rng, 2, 4));
    case "sentence":
      return sentence(rng);
    case "paragraph":
      return Array.from({ length: int(rng, 3, 5) }, () => sentence(rng)).join(" ");
    case "enum":
      return col.values?.length ? weighted(rng, col.values) : null;
    case "pattern":
      return fromPattern(rng, col.pattern || "AA-####");
    case "url":
      return `https://${pick(rng, DOMAINS)}/${words(rng, int(rng, 1, 3)).replace(/ /g, "-")}`;
    case "ipv4":
      return `${int(rng, 1, 223)}.${int(rng, 0, 255)}.${int(rng, 0, 255)}.${int(rng, 1, 254)}`;
    case "color":
      return `#${Array.from({ length: 6 }, () => int(rng, 0, 15).toString(16)).join("")}`;
    case "ref":
      return null;
  }
}

export interface Generated {
  tables: Map<string, Row[]>;
  /** Problems that stopped a column from filling as asked. */
  warnings: string[];
}

/** Tables ordered so that a referenced table comes before the tables that point at it. */
export function order(tables: Table[]): { order: Table[]; error: string | null } {
  const byName = new Map(tables.map((t) => [t.name, t]));
  const out: Table[] = [];
  const state = new Map<string, "visiting" | "done">();
  let error: string | null = null;
  const visit = (t: Table, path: string[]) => {
    if (state.get(t.name) === "done") return;
    if (state.get(t.name) === "visiting") {
      error = `The tables reference each other in a loop: ${[...path, t.name].join(" → ")}.`;
      return;
    }
    state.set(t.name, "visiting");
    for (const c of t.columns) {
      if (c.type !== "ref" || !c.ref) continue;
      const target = byName.get(c.ref.split(".")[0]);
      if (target && target !== t) visit(target, [...path, t.name]);
    }
    state.set(t.name, "done");
    out.push(t);
  };
  for (const t of tables) visit(t, []);
  return { order: out, error };
}

export function generate(tables: Table[], seed: number): Generated {
  const rng = rngFrom(seed);
  const warnings: string[] = [];
  const result = new Map<string, Row[]>();
  const { order: sorted, error } = order(tables);
  if (error) warnings.push(error);
  for (const t of sorted) {
    const rows: Row[] = [];
    const seen = new Map<string, Set<string>>();
    // Columns whose unique values ran out; they carry on without the check.
    const exhausted = new Set<string>();
    for (let i = 0; i < Math.min(t.rows, 100000); i++) {
      const row: Row = {};
      for (const c of t.columns) {
        if (c.nullRatio && rng() < c.nullRatio && !c.unique) {
          row[c.name] = null;
          continue;
        }
        let v: Value;
        if (c.type === "ref") {
          const [table, column] = (c.ref ?? "").split(".");
          const parent = result.get(table) ?? (table === t.name ? rows : undefined);
          if (!parent?.length) {
            if (i === 0) warnings.push(`${t.name}.${c.name}: “${c.ref}” has no rows to point at.`);
            row[c.name] = null;
            continue;
          }
          v = pick(rng, parent)[column ?? "id"] ?? null;
        } else v = valueFor(c, rng, i, row);
        if (c.unique && !exhausted.has(c.name)) {
          const set = seen.get(c.name) ?? new Set<string>();
          let tries = 0;
          while (set.has(String(v)) && tries < 50) {
            v = valueFor(c, rng, i, row);
            tries++;
          }
          if (set.has(String(v))) {
            warnings.push(`${t.name}.${c.name}: ran out of unique values after ${i} rows.`);
            exhausted.add(c.name);
          }
          set.add(String(v));
          seen.set(c.name, set);
        }
        row[c.name] = v;
      }
      rows.push(row);
    }
    result.set(t.name, rows);
  }
  // Keep the caller's table order in the output.
  const ordered = new Map<string, Row[]>();
  for (const t of tables) ordered.set(t.name, result.get(t.name) ?? []);
  return { tables: ordered, warnings };
}

// --- Output ----------------------------------------------------------------

export function toJson(rows: Row[]): string {
  return JSON.stringify(rows, null, 2);
}

export function toNdjson(rows: Row[]): string {
  return rows.map((r) => JSON.stringify(r)).join("\n");
}

export function toCsv(rows: Row[], columns: string[]): string {
  const q = (v: Value) => {
    if (v === null) return "";
    const s = String(v);
    return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map((c) => q(c)).join(","), ...rows.map((r) => columns.map((c) => q(r[c] ?? null)).join(","))].join("\n");
}

export type Dialect = "postgres" | "mysql" | "sqlite";

const SQL_TYPE: Record<Dialect, Partial<Record<ColumnType, string>> & { text: string }> = {
  postgres: { id: "integer", uuid: "uuid", int: "integer", float: "double precision", price: "numeric(12,2)", bool: "boolean", date: "date", datetime: "timestamptz", text: "text" },
  mysql: { id: "int", uuid: "char(36)", int: "int", float: "double", price: "decimal(12,2)", bool: "tinyint(1)", date: "date", datetime: "datetime", text: "varchar(255)" },
  sqlite: { id: "integer", uuid: "text", int: "integer", float: "real", price: "real", bool: "integer", date: "text", datetime: "text", text: "text" },
};

export function sqlIdent(name: string, d: Dialect): string {
  return d === "mysql" ? `\`${name.replace(/`/g, "``")}\`` : `"${name.replace(/"/g, '""')}"`;
}

function sqlValue(v: Value, d: Dialect): string {
  if (v === null) return "NULL";
  if (typeof v === "boolean") return d === "postgres" ? (v ? "TRUE" : "FALSE") : v ? "1" : "0";
  if (typeof v === "number") return String(v);
  return `'${(d === "mysql" ? v.replace(/\\/g, "\\\\") : v).replace(/'/g, "''")}'`;
}

/** CREATE TABLE (optional) and INSERTs in batches of 500 rows. */
export function toSql(table: Table, rows: Row[], d: Dialect, create = true): string {
  const out: string[] = [];
  const cols = table.columns.map((c) => c.name);
  if (create) {
    const defs = table.columns.map((c) => {
      const base = c.type === "ref" ? (SQL_TYPE[d][refType(c, table)] ?? SQL_TYPE[d].text) : (SQL_TYPE[d][c.type] ?? SQL_TYPE[d].text);
      const parts = [sqlIdent(c.name, d), base];
      if (c.type === "id") parts.push("PRIMARY KEY");
      else if (c.unique) parts.push("UNIQUE");
      if (!c.nullRatio && c.type !== "ref" && c.type !== "id") parts.push("NOT NULL");
      if (c.type === "ref" && c.ref) {
        const [t, col] = c.ref.split(".");
        parts.push(`REFERENCES ${sqlIdent(t, d)}(${sqlIdent(col ?? "id", d)})`);
      }
      return `  ${parts.join(" ")}`;
    });
    out.push(`CREATE TABLE ${sqlIdent(table.name, d)} (\n${defs.join(",\n")}\n);`, "");
  }
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    out.push(`INSERT INTO ${sqlIdent(table.name, d)} (${cols.map((c) => sqlIdent(c, d)).join(", ")}) VALUES\n${chunk.map((r) => `  (${cols.map((c) => sqlValue(r[c] ?? null, d)).join(", ")})`).join(",\n")};`);
  }
  return out.join("\n");
}

/** The type a reference column takes: that of the column it points at (ids and uuids). */
function refType(c: Column, _t: Table): ColumnType {
  return /uuid/i.test(c.ref ?? "") ? "uuid" : "int";
}

// --- Schemas from samples --------------------------------------------------

/** A column type guessed from its name, then from a sample value. */
export function guessType(name: string, sample: unknown): Column {
  const n = name.toLowerCase();
  const col = (type: ColumnType, extra: Partial<Column> = {}): Column => ({ name, type, ...extra });
  if (/^id$/.test(n)) return typeof sample === "string" && /^[0-9a-f-]{36}$/i.test(sample) ? col("uuid", { unique: true }) : col("id");
  if (/(^|_)uuid$|guid/.test(n)) return col("uuid", { unique: true });
  if (/_id$|Id$/.test(name) && n !== "id") return col("ref", { ref: `${n.replace(/_id$|id$/, "")}s.id` });
  if (/e-?mail/.test(n)) return col("email", { unique: true });
  if (/^first_?name$/.test(n)) return col("firstName");
  if (/^last_?name$|surname/.test(n)) return col("lastName");
  if (/(^|_)name$|full_?name/.test(n)) return col("fullName");
  if (/user_?name|login|handle/.test(n)) return col("username", { unique: true });
  if (/phone|mobile|tel/.test(n)) return col("phone");
  if (/company|organi[sz]ation|employer/.test(n)) return col("company");
  if (/street|address/.test(n)) return col("street");
  if (/city|town/.test(n)) return col("city");
  if (/country/.test(n)) return col("country");
  if (/zip|postcode|postal/.test(n)) return col("zip");
  if (/url|website|link|href/.test(n)) return col("url");
  if (/(^|_)ip(_|$)|ip_?address/.test(n)) return col("ipv4");
  if (/colou?r/.test(n)) return col("color");
  if (/price|amount|total|cost|balance/.test(n)) return col("price");
  if (/description|bio|body|content|comment|notes?$/.test(n)) return col("paragraph");
  if (/title|subject|headline/.test(n)) return col("sentence");
  if (/(_at|_on|date|time)$/.test(n)) return col(typeof sample === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sample) ? "date" : "datetime");
  if (/^(is|has|can)_|active|enabled|verified|deleted/.test(n)) return col("bool");
  if (/status|state|role|type|kind|category|level/.test(n)) return col("enum", { values: typeof sample === "string" ? [sample, "other"] : ["active", "pending", "disabled"] });
  if (typeof sample === "boolean") return col("bool");
  if (typeof sample === "number") return Number.isInteger(sample) ? col("int", { min: 0, max: Math.max(100, sample * 2) }) : col("float", { min: 0, max: Math.max(1, sample * 2) });
  if (typeof sample === "string") {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(sample)) return col("uuid");
    if (/^\d{4}-\d{2}-\d{2}T/.test(sample)) return col("datetime");
    if (/^\d{4}-\d{2}-\d{2}$/.test(sample)) return col("date");
    if (/^https?:\/\//.test(sample)) return col("url");
    if (/@/.test(sample)) return col("email");
    if (sample.length > 80) return col("paragraph");
    if (sample.split(" ").length > 4) return col("sentence");
  }
  return col("words");
}

/** A table from a JSON sample: an array of objects (or one object). */
export function tableFromJson(json: string, name = "items"): Table {
  const doc = JSON.parse(json);
  const list = (Array.isArray(doc) ? doc : [doc]).filter((x) => x && typeof x === "object" && !Array.isArray(x)) as Record<string, unknown>[];
  if (!list.length) throw new Error("The JSON needs to be an object or an array of objects.");
  const keys: string[] = [];
  for (const o of list) for (const k of Object.keys(o)) if (!keys.includes(k)) keys.push(k);
  const columns = keys.map((k) => {
    const sample = list.map((o) => o[k]).find((v) => v !== null && v !== undefined);
    const c = guessType(k, sample);
    if (list.some((o) => o[k] === null || o[k] === undefined)) c.nullRatio = 0.1;
    return c;
  });
  return { name, rows: 50, columns };
}

/** Tables from CREATE TABLE statements, with REFERENCES turned into references. */
export function tablesFromSql(sql: string): Table[] {
  const out: Table[] = [];
  const clean = sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of clean.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([`"[\]\w.]+)\s*\(/gi)) {
    const name = m[1].replace(/[`"[\]]/g, "").split(".").pop() as string;
    // The body runs to the parenthesis that closes the one after the name.
    const open = (m.index ?? 0) + m[0].length;
    let level = 1;
    let close = open;
    while (close < clean.length && level > 0) {
      if (clean[close] === "(") level++;
      else if (clean[close] === ")") level--;
      close++;
    }
    const body = clean.slice(open, close - 1);
    // Split on commas that are not inside parentheses.
    const defs: string[] = [];
    let depth = 0;
    let cur = "";
    for (const ch of body) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) (defs.push(cur), (cur = ""));
      else cur += ch;
    }
    if (cur.trim()) defs.push(cur);
    const columns: Column[] = [];
    const fks = new Map<string, string>();
    for (const raw of defs) {
      const d = raw.trim();
      const fk = /^(?:constraint\s+\S+\s+)?foreign\s+key\s*\(([^)]+)\)\s*references\s+([`"[\]\w.]+)\s*\(([^)]+)\)/i.exec(d);
      if (fk) {
        fks.set(fk[1].replace(/[`"[\]\s]/g, ""), `${fk[2].replace(/[`"[\]]/g, "").split(".").pop()}.${fk[3].replace(/[`"[\]\s]/g, "")}`);
        continue;
      }
      if (/^(primary|unique|key|index|constraint|check)\b/i.test(d)) continue;
      const cm = /^([`"[\]\w]+)\s+([a-z]+(?:\s*\([^)]*\))?)(.*)$/i.exec(d);
      if (!cm) continue;
      const colName = cm[1].replace(/[`"[\]]/g, "");
      const sqlType = cm[2].toLowerCase();
      const rest = cm[3].toLowerCase();
      let col = guessType(colName, undefined);
      if (col.type === "words" || col.type === "ref") {
        if (/^(int|integer|bigint|smallint|serial|bigserial)/.test(sqlType)) col = { name: colName, type: /serial/.test(sqlType) || /primary key/.test(rest) ? "id" : "int", min: 0, max: 1000 };
        else if (/^(numeric|decimal|real|double|float)/.test(sqlType)) col = { name: colName, type: "float", min: 0, max: 1000 };
        else if (/^(bool|boolean|bit)/.test(sqlType)) col = { name: colName, type: "bool" };
        else if (/^(timestamp|datetime)/.test(sqlType)) col = { name: colName, type: "datetime" };
        else if (/^date/.test(sqlType)) col = { name: colName, type: "date" };
        else if (/^uuid/.test(sqlType)) col = { name: colName, type: "uuid", unique: true };
        else if (/^text/.test(sqlType)) col = { name: colName, type: "sentence" };
      }
      if (/primary key/.test(rest) && /int|serial/.test(sqlType)) col = { name: colName, type: "id" };
      if (/\bunique\b/.test(rest)) col.unique = true;
      if (!/not null|primary key/.test(rest) && col.type !== "id") col.nullRatio = col.nullRatio ?? 0;
      const ref = /references\s+([`"[\]\w.]+)\s*\(([^)]+)\)/i.exec(rest);
      if (ref) col = { name: colName, type: "ref", ref: `${ref[1].replace(/[`"[\]]/g, "").split(".").pop()}.${ref[2].replace(/[`"[\]\s]/g, "")}` };
      columns.push(col);
    }
    for (const c of columns) if (fks.has(c.name)) Object.assign(c, { type: "ref", ref: fks.get(c.name) });
    out.push({ name, rows: 50, columns });
  }
  return out;
}
