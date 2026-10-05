// The model behind the 3-way merge editor: split base / ours / theirs into
// regions (unchanged, changed on one side, changed identically, conflicting)
// using a line-level Myers diff, then render a result with standard conflict
// markers for the regions that still need a decision.

import { diff } from "@codemirror/merge";

export type Side = "ours" | "theirs";

export type Region =
  | { kind: "same"; lines: string[] }
  | {
      kind: "change";
      base: string[];
      ours: string[];
      theirs: string[];
      /** Who changed it: one side, both identically, or a conflict. */
      who: "ours" | "theirs" | "both" | "conflict";
    };

/** Encode each distinct line as one character so a char diff becomes a line diff. */
function encode(lines: string[], table: Map<string, string>): string {
  let s = "";
  for (const l of lines) {
    let c = table.get(l);
    if (c === undefined) {
      // Skip surrogates so every code unit is a standalone character.
      let code = table.size + 0x100;
      if (code >= 0xd800) code += 0x800;
      c = String.fromCharCode(code);
      table.set(l, c);
    }
    s += c;
  }
  return s;
}

/** base line index → other line index for lines common to both (in order). */
export function lineMatches(base: string[], other: string[]): Map<number, number> {
  const table = new Map<string, string>();
  const a = encode(base, table);
  const b = encode(other, table);
  const m = new Map<number, number>();
  let i = 0;
  let j = 0;
  for (const ch of diff(a, b, { scanLimit: 20_000 })) {
    while (i < ch.fromA && j < ch.fromB) m.set(i++, j++);
    i = ch.toA;
    j = ch.toB;
  }
  while (i < base.length && j < other.length) m.set(i++, j++);
  return m;
}

export function splitLines(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

const eq = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Diff3 regions for a three-way merge. */
export function mergeRegions(baseText: string, oursText: string, theirsText: string): Region[] {
  const base = splitLines(baseText);
  const ours = splitLines(oursText);
  const theirs = splitLines(theirsText);
  const toO = lineMatches(base, ours);
  const toT = lineMatches(base, theirs);
  const out: Region[] = [];
  let pb = 0;
  let po = 0;
  let pt = 0;
  const pushSame = (line: string) => {
    const last = out[out.length - 1];
    if (last?.kind === "same") last.lines.push(line);
    else out.push({ kind: "same", lines: [line] });
  };
  const flush = (b: number, o: number, t: number) => {
    const rb = base.slice(pb, b);
    const ro = ours.slice(po, o);
    const rt = theirs.slice(pt, t);
    if (!rb.length && !ro.length && !rt.length) return;
    const oChanged = !eq(rb, ro);
    const tChanged = !eq(rb, rt);
    if (!oChanged && !tChanged) {
      for (const l of rb) pushSame(l);
      return;
    }
    const who = oChanged && tChanged ? (eq(ro, rt) ? "both" : "conflict") : oChanged ? "ours" : "theirs";
    out.push({ kind: "change", base: rb, ours: ro, theirs: rt, who });
  };
  for (let b = 0; b < base.length; b++) {
    const o = toO.get(b);
    const t = toT.get(b);
    // An anchor must be unchanged on both sides and keep both sides moving forward.
    if (o === undefined || t === undefined || o < po || t < pt) continue;
    flush(b, o, t);
    pushSame(base[b]);
    pb = b + 1;
    po = o + 1;
    pt = t + 1;
  }
  flush(base.length, ours.length, theirs.length);
  return out;
}

export type Choice = "ours" | "theirs" | "ours+theirs" | "theirs+ours" | "base";

/** Lines a region contributes to the result for a choice. */
export function pick(r: Extract<Region, { kind: "change" }>, c: Choice): string[] {
  switch (c) {
    case "ours":
      return r.ours;
    case "theirs":
      return r.theirs;
    case "ours+theirs":
      return [...r.ours, ...r.theirs];
    case "theirs+ours":
      return [...r.theirs, ...r.ours];
    default:
      return r.base;
  }
}

export interface Rendered {
  text: string;
  conflicts: number;
}

/**
 * Result text: non-conflicting changes applied, conflicts written with
 * diff3-style markers (or resolved by `choices[conflictIndex]`).
 */
export function renderResult(regions: Region[], labels: { ours: string; theirs: string }, choices: (Choice | undefined)[] = [], eol = "\n"): Rendered {
  const lines: string[] = [];
  let k = 0;
  let open = 0;
  for (const r of regions) {
    if (r.kind === "same") lines.push(...r.lines);
    else if (r.who !== "conflict") lines.push(...(r.who === "theirs" ? r.theirs : r.ours));
    else {
      const c = choices[k++];
      if (c) lines.push(...pick(r, c));
      else {
        open++;
        lines.push(`<<<<<<< ${labels.ours}`, ...r.ours, `||||||| base`, ...r.base, "=======", ...r.theirs, `>>>>>>> ${labels.theirs}`);
      }
    }
  }
  return { text: lines.length ? lines.join(eol) + eol : "", conflicts: open };
}

/** Line spans (0-based, end exclusive) of each change region within ours / theirs, for decorations. */
export function regionSpans(regions: Region[]): { ours: [number, number]; theirs: [number, number]; who: Extract<Region, { kind: "change" }>["who"]; conflictIndex: number }[] {
  const spans: { ours: [number, number]; theirs: [number, number]; who: Extract<Region, { kind: "change" }>["who"]; conflictIndex: number }[] = [];
  let o = 0;
  let t = 0;
  let k = 0;
  for (const r of regions) {
    if (r.kind === "same") {
      o += r.lines.length;
      t += r.lines.length;
      continue;
    }
    spans.push({ ours: [o, o + r.ours.length], theirs: [t, t + r.theirs.length], who: r.who, conflictIndex: r.who === "conflict" ? k++ : -1 });
    o += r.ours.length;
    t += r.theirs.length;
  }
  return spans;
}

/** Recover base / ours / theirs from a file that already contains conflict markers. */
export function sidesFromMarkers(text: string): { base: string; ours: string; theirs: string; hasBase: boolean } | null {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const base: string[] = [];
  const ours: string[] = [];
  const theirs: string[] = [];
  let state: "none" | "ours" | "base" | "theirs" = "none";
  let seen = false;
  let hasBase = false;
  for (const l of lines) {
    if (/^<{7}( |$)/.test(l)) {
      state = "ours";
      seen = true;
    } else if (/^\|{7}( |$)/.test(l) && state === "ours") {
      state = "base";
      hasBase = true;
    } else if (/^={7}$/.test(l) && (state === "ours" || state === "base")) state = "theirs";
    else if (/^>{7}( |$)/.test(l) && state === "theirs") state = "none";
    else if (state === "none") {
      base.push(l);
      ours.push(l);
      theirs.push(l);
    } else if (state === "ours") ours.push(l);
    else if (state === "base") base.push(l);
    else theirs.push(l);
  }
  if (!seen) return null;
  const j = (a: string[]) => a.join("\n");
  // Without a diff3 base section the best base is "neither side", which makes every block a conflict.
  return { base: j(base), ours: j(ours), theirs: j(theirs), hasBase };
}

/** In-progress operation, from the files git leaves in its git dir. */
export function operationFrom(files: Set<string>): "merge" | "rebase" | "cherry-pick" | "revert" | null {
  if (files.has("rebase-merge") || files.has("rebase-apply")) return "rebase";
  if (files.has("MERGE_HEAD")) return "merge";
  if (files.has("CHERRY_PICK_HEAD")) return "cherry-pick";
  if (files.has("REVERT_HEAD")) return "revert";
  return null;
}
