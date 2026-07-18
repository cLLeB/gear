// Structural JSON diffing and patching, following the JSON Patch (RFC 6902) and
// JSON Pointer (RFC 6901) formats. Line-based diffs are the wrong tool for
// structured data — reordering two object keys or reindenting shows up as noise.
// This computes the minimal *semantic* change set between two JSON values:
// object keys added / removed / replaced, and array elements inserted / removed
// (aligned by a longest-common-subsequence pass so an insertion in the middle
// doesn't cascade into "everything after changed"). `applyPatch` replays a patch
// onto a document immutably, so it round-trips: applying `diff(a, b)` to `a`
// always yields `b`.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type Operation =
  | { op: "add"; path: string; value: Json }
  | { op: "remove"; path: string }
  | { op: "replace"; path: string; value: Json }
  | { op: "move"; from: string; path: string };

// --- JSON Pointer ----------------------------------------------------------

/** Encode a single path segment per RFC 6901 (`~` -> `~0`, `/` -> `~1`). */
export function encodePointerSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

function decodePointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function parsePointer(pointer: string): string[] {
  if (pointer === "") return [];
  return pointer.slice(1).split("/").map(decodePointerSegment);
}

function join(path: string, segment: string | number): string {
  return `${path}/${encodePointerSegment(String(segment))}`;
}

// --- Equality --------------------------------------------------------------

function isObject(v: Json): v is { [key: string]: Json } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Structural deep equality over JSON values. */
export function deepEqual(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isObject(a) && isObject(b)) {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    return ak.length === bk.length && ak.every((k) => k in b && deepEqual(a[k], b[k]));
  }
  return false;
}

// --- Diff ------------------------------------------------------------------

/** Compute a JSON Patch that transforms `a` into `b`. */
export function diff(a: Json, b: Json): Operation[] {
  const ops: Operation[] = [];
  diffValue("", a, b, ops);
  return ops;
}

function diffValue(path: string, a: Json, b: Json, ops: Operation[]): void {
  if (deepEqual(a, b)) return;
  if (Array.isArray(a) && Array.isArray(b)) { diffArray(path, a, b, ops); return; }
  if (isObject(a) && isObject(b)) { diffObject(path, a, b, ops); return; }
  ops.push({ op: "replace", path: path === "" ? "" : path, value: b });
}

function diffObject(path: string, a: { [k: string]: Json }, b: { [k: string]: Json }, ops: Operation[]): void {
  for (const key of Object.keys(a)) {
    if (!(key in b)) ops.push({ op: "remove", path: join(path, key) });
  }
  for (const key of Object.keys(b)) {
    if (!(key in a)) ops.push({ op: "add", path: join(path, key), value: b[key] });
    else diffValue(join(path, key), a[key], b[key], ops);
  }
}

function diffArray(path: string, a: Json[], b: Json[], ops: Operation[]): void {
  const matches = lcsMatches(a, b);
  let ai = 0;
  let bi = 0;
  let pos = 0;
  let mk = 0;
  while (ai < a.length || bi < b.length) {
    const m = mk < matches.length ? matches[mk] : null;
    if (m && ai === m[0] && bi === m[1]) {
      diffValue(join(path, pos), a[ai], b[bi], ops);
      ai++; bi++; pos++; mk++;
    } else if (ai < a.length && (!m || ai < m[0])) {
      ops.push({ op: "remove", path: join(path, pos) });
      ai++; // element removed — `pos` stays put
    } else {
      ops.push({ op: "add", path: join(path, pos), value: b[bi] });
      bi++; pos++;
    }
  }
}

/** Indices of a longest common subsequence, as [aIndex, bIndex] pairs. */
function lcsMatches(a: Json[], b: Json[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = deepEqual(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (deepEqual(a[i], b[j])) { out.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return out;
}

// --- Apply -----------------------------------------------------------------

/** Apply a JSON Patch to a document, returning a new value (input untouched). */
export function applyPatch<T extends Json>(doc: T, ops: Operation[]): Json {
  const holder: { value: Json } = { value: structuredClone(doc) as Json };
  for (const op of ops) applyOne(holder, op);
  return holder.value;
}

function applyOne(holder: { value: Json }, op: Operation): void {
  switch (op.op) {
    case "add": setAt(holder, parsePointer(op.path), op.value, "add"); break;
    case "replace": setAt(holder, parsePointer(op.path), op.value, "replace"); break;
    case "remove": removeAt(holder, parsePointer(op.path)); break;
    case "move": {
      const value = getAt(holder, parsePointer(op.from));
      removeAt(holder, parsePointer(op.from));
      setAt(holder, parsePointer(op.path), value, "add");
      break;
    }
  }
}

function getAt(holder: { value: Json }, tokens: string[]): Json {
  let node: Json = holder.value;
  for (const t of tokens) node = (node as Record<string, Json>)[t] as Json;
  return node;
}

function parentOf(holder: { value: Json }, tokens: string[]): { container: Record<string, Json> | Json[] | { value: Json }; key: string } {
  if (tokens.length === 0) return { container: holder, key: "value" };
  let node: Json = holder.value;
  for (let i = 0; i < tokens.length - 1; i++) node = (node as Record<string, Json>)[tokens[i]] as Json;
  return { container: node as Record<string, Json> | Json[], key: tokens[tokens.length - 1] };
}

function setAt(holder: { value: Json }, tokens: string[], value: Json, mode: "add" | "replace"): void {
  const { container, key } = parentOf(holder, tokens);
  if (Array.isArray(container)) {
    const idx = key === "-" ? container.length : Number(key);
    if (mode === "add") container.splice(idx, 0, value);
    else container[idx] = value;
  } else {
    (container as Record<string, Json>)[key] = value;
  }
}

function removeAt(holder: { value: Json }, tokens: string[]): void {
  const { container, key } = parentOf(holder, tokens);
  if (Array.isArray(container)) container.splice(Number(key), 1);
  else delete (container as Record<string, Json>)[key];
}
