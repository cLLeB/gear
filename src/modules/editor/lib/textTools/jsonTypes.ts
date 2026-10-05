// Generate type definitions from a JSON sample (quicktype-style): TypeScript
// interfaces, Zod schemas, Go structs, Rust serde structs, Python dataclasses.
// Array elements are merged, so a key missing from some objects becomes
// optional and a key that is sometimes null becomes nullable.

export type TypeTarget = "typescript" | "zod" | "go" | "rust" | "python";

type Prim = "string" | "integer" | "number" | "boolean" | "null" | "any";
type Field = { type: T; optional: boolean };
type T =
  | { kind: Prim }
  | { kind: "array"; of: T }
  | { kind: "object"; hint: string; fields: Map<string, Field> }
  | { kind: "union"; of: T[] };

function infer(v: unknown, hint: string): T {
  if (v === null) return { kind: "null" };
  if (Array.isArray(v)) {
    const item = singular(hint);
    return { kind: "array", of: v.length ? v.map((x) => infer(x, item)).reduce(merge) : { kind: "any" } };
  }
  switch (typeof v) {
    case "string":
      return { kind: "string" };
    case "number":
      return { kind: Number.isInteger(v) ? "integer" : "number" };
    case "boolean":
      return { kind: "boolean" };
    case "object": {
      const fields = new Map<string, Field>();
      for (const [k, x] of Object.entries(v as object)) fields.set(k, { type: infer(x, k), optional: false });
      return { kind: "object", hint, fields };
    }
    default:
      return { kind: "any" };
  }
}

function members(t: T): T[] {
  return t.kind === "union" ? t.of : [t];
}

function merge(a: T, b: T): T {
  if (a.kind === "any") return b;
  if (b.kind === "any") return a;
  if (a.kind === "object" && b.kind === "object") {
    const fields = new Map<string, Field>();
    for (const [k, f] of a.fields) {
      const other = b.fields.get(k);
      fields.set(k, other ? { type: merge(f.type, other.type), optional: f.optional || other.optional } : { ...f, optional: true });
    }
    for (const [k, f] of b.fields) if (!a.fields.has(k)) fields.set(k, { ...f, optional: true });
    return { kind: "object", hint: a.hint, fields };
  }
  if (a.kind === "array" && b.kind === "array") return { kind: "array", of: merge(a.of, b.of) };
  if ((a.kind === "integer" && b.kind === "number") || (a.kind === "number" && b.kind === "integer")) return { kind: "number" };
  if (a.kind === b.kind && a.kind !== "union") return a;
  // Union: fold each member into a compatible existing one.
  let out = members(a);
  for (const m of members(b)) {
    const i = out.findIndex(
      (x) => x.kind === m.kind || (x.kind === "integer" && m.kind === "number") || (x.kind === "number" && m.kind === "integer"),
    );
    out = i >= 0 ? out.map((x, j) => (j === i ? merge(x, m) : x)) : [...out, m];
  }
  return out.length === 1 ? out[0] : { kind: "union", of: out };
}

function singular(name: string): string {
  if (/ies$/i.test(name)) return name.slice(0, -3) + "y";
  if (/(ss|us|is)$/i.test(name)) return name;
  if (/(x|ch|sh|ss)es$/i.test(name)) return name.slice(0, -2);
  if (/s$/i.test(name) && name.length > 1) return name.slice(0, -1);
  return `${name}Item`;
}

function pascal(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean);
  const s = words.map((w) => w[0].toUpperCase() + w.slice(1)).join("");
  return /^[0-9]/.test(s) ? `T${s}` : s || "Root";
}

function snake(name: string): string {
  const s = name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return /^[0-9]/.test(s) ? `_${s}` : s || "field";
}

/** Assigns a unique type name to each distinct object shape, in emit order. */
class Namer {
  private names = new Map<string, string>(); // signature → name
  private used = new Set<string>();
  readonly order: { name: string; t: Extract<T, { kind: "object" }> }[] = [];

  /** Map every named shape, including ones first referenced while mapping. */
  drain(fn: (name: string, t: Extract<T, { kind: "object" }>) => string): string[] {
    const out: string[] = [];
    for (let i = 0; i < this.order.length; i++) out.push(fn(this.order[i].name, this.order[i].t));
    return out;
  }

  nameOf(t: Extract<T, { kind: "object" }>): string {
    const sig = signature(t);
    const known = this.names.get(sig);
    if (known) return known;
    let name = pascal(t.hint);
    for (let n = 2; this.used.has(name); n++) name = `${pascal(t.hint)}${n}`;
    this.used.add(name);
    this.names.set(sig, name);
    this.order.push({ name, t });
    return name;
  }
}

function signature(t: T): string {
  switch (t.kind) {
    case "array":
      return `[${signature(t.of)}]`;
    case "union":
      return t.of.map(signature).sort().join("|");
    case "object":
      return `{${[...t.fields].map(([k, f]) => `${k}${f.optional ? "?" : ""}:${signature(f.type)}`).join(",")}}`;
    default:
      return t.kind;
  }
}

const TS_IDENT = /^[A-Za-z_$][\w$]*$/;

function nullable(t: T): { inner: T; isNull: boolean } {
  if (t.kind !== "union") return { inner: t, isNull: t.kind === "null" };
  const rest = t.of.filter((m) => m.kind !== "null");
  const isNull = rest.length !== t.of.length;
  return { inner: rest.length === 1 ? rest[0] : { kind: "union", of: rest }, isNull };
}

function emitTs(root: T, rootName: string, zod: boolean): string {
  const namer = new Namer();
  const ref = (t: T): string => {
    switch (t.kind) {
      case "string":
      case "boolean":
      case "null":
        return zod ? `z.${t.kind}()` : t.kind;
      case "integer":
        return zod ? "z.number().int()" : "number";
      case "number":
        return zod ? "z.number()" : "number";
      case "any":
        return zod ? "z.unknown()" : "unknown";
      case "array":
        return zod ? `z.array(${ref(t.of)})` : t.of.kind === "union" ? `(${ref(t.of)})[]` : `${ref(t.of)}[]`;
      case "union":
        return zod ? `z.union([${t.of.map(ref).join(", ")}])` : t.of.map(ref).join(" | ");
      case "object":
        return zod ? `${namer.nameOf(t)}Schema` : namer.nameOf(t);
    }
  };
  if (root.kind === "object") root.hint = rootName;
  const top = ref(root);
  const blocks: string[] = [];
  for (let i = 0; i < namer.order.length; i++) {
    const { name, t } = namer.order[i];
    const lines = [...t.fields].map(([k, f]) => {
      const key = TS_IDENT.test(k) ? k : JSON.stringify(k);
      if (zod) return `  ${key}: ${ref(f.type)}${f.optional ? ".optional()" : ""},`;
      return `  ${key}${f.optional ? "?" : ""}: ${ref(f.type)};`;
    });
    blocks.push(
      zod
        ? `export const ${name}Schema = z.object({\n${lines.join("\n")}\n});\nexport type ${name} = z.infer<typeof ${name}Schema>;`
        : `export interface ${name} {\n${lines.join("\n")}\n}`,
    );
  }
  // Zod schemas must be declared before use: emit dependencies first.
  if (zod) blocks.reverse();
  if (root.kind !== "object") blocks.push(zod ? `export const ${rootName}Schema = ${top};` : `export type ${rootName} = ${top};`);
  return (zod ? 'import { z } from "zod";\n\n' : "") + blocks.join("\n\n") + "\n";
}

function emitGo(root: T, rootName: string): string {
  const namer = new Namer();
  const ref = (t: T, optional = false): string => {
    const { inner, isNull } = nullable(t);
    const ptr = isNull || optional ? "*" : "";
    switch (inner.kind) {
      case "string":
        return `${ptr}string`;
      case "integer":
        return `${ptr}int64`;
      case "number":
        return `${ptr}float64`;
      case "boolean":
        return `${ptr}bool`;
      case "array":
        return `[]${ref(inner.of)}`;
      case "object":
        return `${ptr}${namer.nameOf(inner)}`;
      default:
        return "any";
    }
  };
  if (root.kind === "object") root.hint = rootName;
  const top = ref(root);
  const blocks = namer.drain((name, t) => {
    const fields = [...t.fields].map(([k, f]) => `\t${pascal(k)} ${ref(f.type, f.optional)} \`json:"${k}${f.optional ? ",omitempty" : ""}"\``);
    return `type ${name} struct {\n${fields.join("\n")}\n}`;
  });
  if (root.kind !== "object") blocks.unshift(`type ${rootName} ${top}`);
  return blocks.join("\n\n") + "\n";
}

function emitRust(root: T, rootName: string): string {
  const namer = new Namer();
  const ref = (t: T): string => {
    const { inner, isNull } = nullable(t);
    const wrap = (s: string) => (isNull ? `Option<${s}>` : s);
    switch (inner.kind) {
      case "string":
        return wrap("String");
      case "integer":
        return wrap("i64");
      case "number":
        return wrap("f64");
      case "boolean":
        return wrap("bool");
      case "array":
        return wrap(`Vec<${ref(inner.of)}>`);
      case "object":
        return wrap(namer.nameOf(inner));
      default:
        return "serde_json::Value";
    }
  };
  if (root.kind === "object") root.hint = rootName;
  const top = ref(root);
  const blocks = namer.drain((name, t) => {
    const fields = [...t.fields].map(([k, f]) => {
      const field = snake(k);
      const attrs: string[] = [];
      if (field !== k) attrs.push(`    #[serde(rename = "${k}")]`);
      let type = ref(f.type);
      if (f.optional) {
        if (!type.startsWith("Option<")) type = `Option<${type}>`;
        attrs.push(`    #[serde(default, skip_serializing_if = "Option::is_none")]`);
      }
      const name = ["type", "match", "fn", "struct", "enum", "ref", "mod", "use", "move", "loop", "impl", "self", "crate", "where", "async", "await", "dyn"].includes(field) ? `r#${field}` : field;
      return [...attrs, `    pub ${name}: ${type},`].join("\n");
    });
    return `#[derive(Debug, Clone, Serialize, Deserialize)]\npub struct ${name} {\n${fields.join("\n")}\n}`;
  });
  if (root.kind !== "object") blocks.unshift(`pub type ${rootName} = ${top};`);
  return `use serde::{Deserialize, Serialize};\n\n${blocks.join("\n\n")}\n`;
}

function emitPython(root: T, rootName: string): string {
  const namer = new Namer();
  const ref = (t: T): string => {
    const { inner, isNull } = nullable(t);
    const wrap = (s: string) => (isNull ? `Optional[${s}]` : s);
    switch (inner.kind) {
      case "string":
        return wrap("str");
      case "integer":
        return wrap("int");
      case "number":
        return wrap("float");
      case "boolean":
        return wrap("bool");
      case "array":
        return wrap(`List[${ref(inner.of)}]`);
      case "object":
        return wrap(`"${namer.nameOf(inner)}"`);
      case "union":
        return wrap(`Union[${inner.of.map(ref).join(", ")}]`);
      default:
        return "Any";
    }
  };
  if (root.kind === "object") root.hint = rootName;
  const top = ref(root);
  const blocks = namer.drain((name, t) => {
    // Dataclass fields with defaults must come after the required ones.
    const entries = [...t.fields].sort((a, b) => Number(a[1].optional) - Number(b[1].optional));
    const fields = entries.map(([k, f]) => {
      const field = snake(k);
      const type = f.optional && !ref(f.type).startsWith("Optional[") ? `Optional[${ref(f.type)}]` : ref(f.type);
      const note = field !== k ? `  # "${k}"` : "";
      return `    ${field}: ${type}${f.optional ? " = None" : ""}${note}`;
    });
    return `@dataclass\nclass ${name}:\n${fields.length ? fields.join("\n") : "    pass"}`;
  });
  if (root.kind !== "object") blocks.unshift(`${rootName} = ${top}`);
  return `from __future__ import annotations\n\nfrom dataclasses import dataclass\nfrom typing import Any, List, Optional, Union\n\n\n${blocks.join("\n\n\n")}\n`;
}

export function jsonToTypes(value: unknown, target: TypeTarget, rootName = "Root"): string {
  const root = infer(value, rootName);
  const name = pascal(rootName);
  switch (target) {
    case "typescript":
      return emitTs(root, name, false);
    case "zod":
      return emitTs(root, name, true);
    case "go":
      return emitGo(root, name);
    case "rust":
      return emitRust(root, name);
    case "python":
      return emitPython(root, name);
  }
}
