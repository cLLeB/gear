// Dragging a selection onto a folder in the tree: which items actually move,
// which would collide with an existing name, and which can't move at all.

export interface DragMovePlan {
  /** Sources that move cleanly. */
  moves: string[];
  /** Sources whose name already exists in the destination. */
  conflicts: string[];
  /** Sources that are already in the destination (no-op). */
  unchanged: string[];
  /** Folders dropped into themselves or their own subfolders. */
  invalid: string[];
}

const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");

export function baseName(p: string): string {
  const n = norm(p);
  return n.slice(n.lastIndexOf("/") + 1);
}

export function parentDir(p: string): string {
  const n = norm(p);
  const i = n.lastIndexOf("/");
  return i <= 0 ? n.slice(0, i + 1) || "/" : n.slice(0, i);
}

/**
 * `existing` holds the names already in `destDir`. Paths inside another
 * selected folder are dropped: moving the folder carries them along.
 */
export function planDragMove(sources: readonly string[], destDir: string, existing: ReadonlySet<string>, caseInsensitive = false): DragMovePlan {
  const dest = norm(destDir);
  const key = (s: string) => (caseInsensitive ? s.toLowerCase() : s);
  const srcs = [...new Set(sources.map(norm))];
  const roots = srcs.filter((s) => !srcs.some((o) => o !== s && key(s).startsWith(`${key(o)}/`)));
  const taken = new Set([...existing].map(key));
  const plan: DragMovePlan = { moves: [], conflicts: [], unchanged: [], invalid: [] };
  for (const s of roots) {
    if (key(parentDir(s)) === key(dest)) plan.unchanged.push(s);
    else if (key(dest) === key(s) || key(dest).startsWith(`${key(s)}/`)) plan.invalid.push(s);
    else if (taken.has(key(baseName(s)))) plan.conflicts.push(s);
    else {
      plan.moves.push(s);
      // Two dragged items with the same name: the second one collides with the first.
      taken.add(key(baseName(s)));
    }
  }
  return plan;
}

/** Group moved paths by their original folder, for undo. */
export function undoGroups(moved: { from: string; to: string }[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const m of moved) {
    const dir = parentDir(m.from);
    groups.set(dir, [...(groups.get(dir) ?? []), m.to]);
  }
  return groups;
}

export interface MoveOps {
  /** Moves `source` into `destDir`, returning where it landed. */
  move(source: string, destDir: string): Promise<string>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface MoveOutcome {
  moved: { from: string; to: string }[];
  failed: { path: string; reason: string }[];
  /** Set-aside copies of replaced items that could not be removed or put back. */
  stranded: string[];
}

/**
 * Moves each source on its own, so one failure neither hides nor undoes the
 * others. A replaced item is set aside first and only deleted once its
 * replacement has landed; if the move fails it is put back. Only names in
 * `existing` are replaced: two dragged items sharing a name keep both.
 */
export async function runDragMove(
  sources: readonly string[],
  replace: ReadonlySet<string>,
  destDir: string,
  existing: readonly string[],
  ops: MoveOps,
  token: string,
  caseInsensitive = false,
): Promise<MoveOutcome> {
  const key = (s: string) => (caseInsensitive ? s.toLowerCase() : s);
  const dest = norm(destDir);
  const out: MoveOutcome = { moved: [], failed: [], stranded: [] };
  for (const src of sources) {
    const current = replace.has(src) ? existing.find((n) => key(n) === key(baseName(src))) : undefined;
    let parked: { target: string; aside: string } | null = null;
    if (current !== undefined) {
      const target = `${dest}/${current}`;
      const aside = `${target}.replaced-${token}`;
      try {
        await ops.rename(target, aside);
        parked = { target, aside };
      } catch (e) {
        out.failed.push({ path: src, reason: String(e) });
        continue;
      }
    }
    try {
      out.moved.push({ from: src, to: await ops.move(src, destDir) });
      if (parked) await ops.remove(parked.aside).catch(() => out.stranded.push(parked!.aside));
    } catch (e) {
      out.failed.push({ path: src, reason: String(e) });
      if (parked) await ops.rename(parked.aside, parked.target).catch(() => out.stranded.push(parked!.aside));
    }
  }
  return out;
}
