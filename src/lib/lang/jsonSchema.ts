// A JSON Schema validator (a practical draft-07 subset). Config files, settings,
// and API payloads are all validated against schemas; having an in-house
// validator means the editor can surface precise, path-anchored errors
// ("/servers/0/port must be an integer") without pulling in a heavyweight
// dependency. It supports the keywords that matter in practice: type/enum/const,
// object properties/required/additionalProperties, array items/length/unique,
// numeric bounds and multipleOf, string length/pattern, the combinators
// allOf/anyOf/oneOf/not, and local `$ref` resolution.

export type Schema = boolean | { [keyword: string]: unknown };

export interface ValidationError {
  /** JSON Pointer to the offending instance location. */
  path: string;
  keyword: string;
  message: string;
}

type JsonType = "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";

/** Validate `value` against `schema`. Returns [] when valid. */
export function validate(schema: Schema, value: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  validateNode(schema, value, "", schema, errors);
  return errors;
}

/** Convenience: whether `value` satisfies `schema`. */
export function isValid(schema: Schema, value: unknown): boolean {
  return validate(schema, value).length === 0;
}

// Bounds recursion so a cyclic `$ref` (a -> b -> a) or absurd nesting reports a
// schema error instead of overflowing the stack.
const MAX_DEPTH = 512;

function validateNode(
  schema: Schema,
  value: unknown,
  path: string,
  root: Schema,
  errors: ValidationError[],
  depth = 0,
): void {
  if (depth > MAX_DEPTH) {
    errors.push({ path, keyword: "recursion", message: "schema is too deeply nested or has a cyclic $ref" });
    return;
  }
  if (schema === true) return;
  if (schema === false) { errors.push({ path, keyword: "false", message: "no value is allowed here" }); return; }

  const s = schema as { [k: string]: unknown };

  if (typeof s.$ref === "string") {
    const resolved = resolveRef(s.$ref, root);
    if (resolved !== undefined) validateNode(resolved, value, path, root, errors, depth + 1);
    return;
  }

  if (s.type !== undefined && !matchesType(s.type, value)) {
    errors.push({ path, keyword: "type", message: `expected ${describeType(s.type)}` });
    return; // further keyword checks assume the coarse type is right
  }

  if (Array.isArray(s.enum) && !s.enum.some((e) => deepEqual(e, value))) {
    errors.push({ path, keyword: "enum", message: "value is not one of the allowed values" });
  }
  if ("const" in s && !deepEqual(s.const, value)) {
    errors.push({ path, keyword: "const", message: "value does not equal the required constant" });
  }

  if (typeof value === "number") validateNumber(s, value, path, errors);
  if (typeof value === "string") validateString(s, value, path, errors);
  if (Array.isArray(value)) validateArray(s, value, path, root, errors, depth);
  if (isPlainObject(value)) validateObject(s, value, path, root, errors, depth);

  validateCombinators(s, value, path, root, errors, depth);
}

function validateNumber(s: Record<string, unknown>, value: number, path: string, errors: ValidationError[]): void {
  if (typeof s.minimum === "number" && value < s.minimum) push(errors, path, "minimum", `must be >= ${s.minimum}`);
  if (typeof s.maximum === "number" && value > s.maximum) push(errors, path, "maximum", `must be <= ${s.maximum}`);
  if (typeof s.exclusiveMinimum === "number" && value <= s.exclusiveMinimum) push(errors, path, "exclusiveMinimum", `must be > ${s.exclusiveMinimum}`);
  if (typeof s.exclusiveMaximum === "number" && value >= s.exclusiveMaximum) push(errors, path, "exclusiveMaximum", `must be < ${s.exclusiveMaximum}`);
  if (typeof s.multipleOf === "number" && s.multipleOf > 0 && !isMultiple(value, s.multipleOf)) push(errors, path, "multipleOf", `must be a multiple of ${s.multipleOf}`);
}

function validateString(s: Record<string, unknown>, value: string, path: string, errors: ValidationError[]): void {
  const len = [...value].length;
  if (typeof s.minLength === "number" && len < s.minLength) push(errors, path, "minLength", `must be at least ${s.minLength} characters`);
  if (typeof s.maxLength === "number" && len > s.maxLength) push(errors, path, "maxLength", `must be at most ${s.maxLength} characters`);
  if (typeof s.pattern === "string") {
    let re: RegExp | null = null;
    try {
      re = new RegExp(s.pattern);
    } catch {
      push(errors, path, "pattern", `schema has an invalid pattern /${s.pattern}/`);
    }
    if (re && !re.test(value)) push(errors, path, "pattern", `must match /${s.pattern}/`);
  }
  if (s.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) push(errors, path, "format", "must be a valid email address");
}

function validateArray(s: Record<string, unknown>, value: unknown[], path: string, root: Schema, errors: ValidationError[], depth: number): void {
  if (typeof s.minItems === "number" && value.length < s.minItems) push(errors, path, "minItems", `must have at least ${s.minItems} items`);
  if (typeof s.maxItems === "number" && value.length > s.maxItems) push(errors, path, "maxItems", `must have at most ${s.maxItems} items`);
  if (s.uniqueItems === true && hasDuplicates(value)) push(errors, path, "uniqueItems", "items must be unique");

  if (Array.isArray(s.items)) {
    // Tuple validation: each schema applies to the item at its index.
    s.items.forEach((itemSchema, i) => {
      if (i < value.length) validateNode(itemSchema as Schema, value[i], `${path}/${i}`, root, errors, depth + 1);
    });
  } else if (s.items !== undefined) {
    value.forEach((item, i) => validateNode(s.items as Schema, item, `${path}/${i}`, root, errors, depth + 1));
  }
}

function validateObject(s: Record<string, unknown>, value: Record<string, unknown>, path: string, root: Schema, errors: ValidationError[], depth: number): void {
  const properties = (s.properties as Record<string, Schema>) ?? {};
  const keys = Object.keys(value);

  if (Array.isArray(s.required)) {
    for (const key of s.required) {
      if (typeof key === "string" && !(key in value)) push(errors, path, "required", `missing required property "${key}"`);
    }
  }
  if (typeof s.minProperties === "number" && keys.length < s.minProperties) push(errors, path, "minProperties", `must have at least ${s.minProperties} properties`);
  if (typeof s.maxProperties === "number" && keys.length > s.maxProperties) push(errors, path, "maxProperties", `must have at most ${s.maxProperties} properties`);

  for (const key of keys) {
    const encoded = `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
    if (key in properties) {
      validateNode(properties[key], value[key], encoded, root, errors, depth + 1);
    } else if (s.additionalProperties === false) {
      push(errors, encoded, "additionalProperties", `unexpected property "${key}"`);
    } else if (typeof s.additionalProperties === "object" && s.additionalProperties !== null) {
      validateNode(s.additionalProperties as Schema, value[key], encoded, root, errors, depth + 1);
    }
  }
}

function validateCombinators(s: Record<string, unknown>, value: unknown, path: string, root: Schema, errors: ValidationError[], depth: number): void {
  if (Array.isArray(s.allOf)) {
    for (const sub of s.allOf) validateNode(sub as Schema, value, path, root, errors, depth + 1);
  }
  if (Array.isArray(s.anyOf)) {
    const ok = s.anyOf.some((sub) => validateSubtree(sub as Schema, value, path, root, depth + 1).length === 0);
    if (!ok) push(errors, path, "anyOf", "value does not match any of the allowed schemas");
  }
  if (Array.isArray(s.oneOf)) {
    const matches = s.oneOf.filter((sub) => validateSubtree(sub as Schema, value, path, root, depth + 1).length === 0).length;
    if (matches !== 1) push(errors, path, "oneOf", `value must match exactly one schema (matched ${matches})`);
  }
  if (s.not !== undefined && validateSubtree(s.not as Schema, value, path, root, depth + 1).length === 0) {
    push(errors, path, "not", "value must not match the schema");
  }
}

function validateSubtree(schema: Schema, value: unknown, path: string, root: Schema, depth = 0): ValidationError[] {
  const errors: ValidationError[] = [];
  validateNode(schema, value, path, root, errors, depth);
  return errors;
}

// --- Helpers ---------------------------------------------------------------

function push(errors: ValidationError[], path: string, keyword: string, message: string): void {
  errors.push({ path, keyword, message });
}

function matchesType(type: unknown, value: unknown): boolean {
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => matchesSingleType(t as JsonType, value));
}

function matchesSingleType(type: JsonType, value: unknown): boolean {
  switch (type) {
    case "string": return typeof value === "string";
    case "number": return typeof value === "number";
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "boolean": return typeof value === "boolean";
    case "null": return value === null;
    case "array": return Array.isArray(value);
    case "object": return isPlainObject(value);
    default: return false;
  }
}

function describeType(type: unknown): string {
  return Array.isArray(type) ? type.join(" or ") : String(type);
}

function resolveRef(ref: string, root: Schema): Schema | undefined {
  if (!ref.startsWith("#")) return undefined; // only local refs supported
  const tokens = ref.slice(1).split("/").filter((t) => t !== "").map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"));
  let node: unknown = root;
  for (const t of tokens) {
    if (node && typeof node === "object" && t in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[t];
    } else {
      return undefined;
    }
  }
  return node as Schema;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isMultiple(value: number, base: number): boolean {
  const ratio = value / base;
  return Math.abs(ratio - Math.round(ratio)) < 1e-9;
}

function hasDuplicates(items: unknown[]): boolean {
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) if (deepEqual(items[i], items[j])) return true;
  }
  return false;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (isPlainObject(a) && isPlainObject(b)) {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    return ak.length === bk.length && ak.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}
