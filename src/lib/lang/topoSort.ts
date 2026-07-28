// Topological sorting with cycle detection over a dependency graph. Ordering
// build steps, resolving module/import order, sequencing tasks, or laying out a
// migration chain all reduce to "given that X depends on Y, produce an order
// where every dependency comes before its dependent — or tell me precisely which
// dependencies form a cycle." This uses Kahn's algorithm for a deterministic
// (alphabetically stable) order, and when the graph is not a DAG it runs a DFS
// to return an actual cycle path so the error can point at the real culprits.

export interface TopoResult {
  /** A valid topological order (empty if there is a cycle). */
  order: string[];
  /** The nodes forming a cycle, or null if the graph is acyclic. */
  cycle: string[] | null;
}

/**
 * Topologically sort a dependency map where `dependencies.get(x)` lists the
 * nodes `x` depends on (which must come before `x`). Nodes referenced only as
 * dependencies are included automatically.
 */
export function topologicalSort(dependencies: Map<string, string[]>): TopoResult {
  const nodes = collectNodes(dependencies);
  const deps = new Map<string, string[]>();
  const dependents = new Map<string, string[]>();
  for (const node of nodes) { deps.set(node, []); dependents.set(node, []); }

  for (const [node, list] of dependencies) {
    for (const dep of list) {
      deps.get(node)!.push(dep);
      dependents.get(dep)!.push(node);
    }
  }

  const inDegree = new Map<string, number>();
  for (const node of nodes) inDegree.set(node, deps.get(node)!.length);

  // Ready set: nodes with all dependencies satisfied. Kept sorted for a
  // deterministic result.
  const ready = [...nodes].filter((n) => inDegree.get(n) === 0).sort();
  const order: string[] = [];

  while (ready.length > 0) {
    const node = ready.shift()!;
    order.push(node);
    for (const dependent of dependents.get(node)!.slice().sort()) {
      const remaining = inDegree.get(dependent)! - 1;
      inDegree.set(dependent, remaining);
      if (remaining === 0) insertSorted(ready, dependent);
    }
  }

  if (order.length !== nodes.size) {
    return { order: [], cycle: findCycle(deps) };
  }
  return { order, cycle: null };
}

function collectNodes(dependencies: Map<string, string[]>): Set<string> {
  const nodes = new Set<string>();
  for (const [node, list] of dependencies) {
    nodes.add(node);
    for (const dep of list) nodes.add(dep);
  }
  return nodes;
}

function insertSorted(arr: string[], value: string): void {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  arr.splice(lo, 0, value);
}

/** Find one cycle in the dependency graph via DFS, or null if acyclic. */
function findCycle(deps: Map<string, string[]>): string[] | null {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const node of deps.keys()) color.set(node, WHITE);
  const stack: string[] = [];

  const visit = (node: string): string[] | null => {
    color.set(node, GRAY);
    stack.push(node);
    for (const dep of deps.get(node) ?? []) {
      if (color.get(dep) === GRAY) {
        // Found a back edge — extract the cycle from the DFS stack.
        const start = stack.indexOf(dep);
        return stack.slice(start);
      }
      if (color.get(dep) === WHITE) {
        const found = visit(dep);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(node, BLACK);
    return null;
  };

  for (const node of [...deps.keys()].sort()) {
    if (color.get(node) === WHITE) {
      const found = visit(node);
      if (found) return found;
    }
  }
  return null;
}
