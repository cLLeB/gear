// A trie-based route matcher — the pattern-matching core of a web/router layer.
// Routes are registered as path patterns with static segments, named parameters
// (`/users/:id`), and catch-all wildcards (`/files/*`), and a lookup returns the
// matching route plus the extracted parameters. Matching honors the priority
// developers expect: a static segment beats a `:param`, which beats a `*`, so
// `/users/me` matches a literal `/users/me` route even when `/users/:id` also
// exists. Backtracking ensures a path still matches a `:param` route when a more
// specific static branch dead-ends.

export interface RouteMatch {
  route: string;
  params: Record<string, string>;
}

interface TrieNode {
  statics: Map<string, TrieNode>;
  param?: { name: string; node: TrieNode };
  wildcard?: { name: string; route: string };
  route?: string;
}

function newNode(): TrieNode {
  return { statics: new Map() };
}

export class Router {
  private readonly root = newNode();

  /** Register a route pattern (e.g. "/users/:id", "/files/*"). */
  add(pattern: string): void {
    const segments = split(pattern);
    let node = this.root;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.startsWith("*")) {
        node.wildcard = { name: seg.slice(1) || "*", route: pattern };
        return; // catch-all consumes the rest
      }
      if (seg.startsWith(":")) {
        const name = seg.slice(1);
        if (!node.param) node.param = { name, node: newNode() };
        node = node.param.node;
      } else {
        let next = node.statics.get(seg);
        if (!next) { next = newNode(); node.statics.set(seg, next); }
        node = next;
      }
    }
    node.route = pattern;
  }

  /** Match a concrete path, returning the route and its params, or null. */
  match(path: string): RouteMatch | null {
    return this.walk(this.root, split(path), 0, {});
  }

  private walk(node: TrieNode, segments: string[], i: number, params: Record<string, string>): RouteMatch | null {
    if (i === segments.length) {
      return node.route !== undefined ? { route: node.route, params } : null;
    }
    const seg = segments[i];

    // 1. Static (most specific).
    const staticChild = node.statics.get(seg);
    if (staticChild) {
      const found = this.walk(staticChild, segments, i + 1, params);
      if (found) return found;
    }

    // 2. Named parameter.
    if (node.param) {
      const found = this.walk(node.param.node, segments, i + 1, { ...params, [node.param.name]: seg });
      if (found) return found;
    }

    // 3. Catch-all wildcard (least specific).
    if (node.wildcard) {
      return {
        route: node.wildcard.route,
        params: { ...params, [node.wildcard.name]: segments.slice(i).join("/") },
      };
    }

    return null;
  }
}

/** Build a router from a list of route patterns. */
export function createRouter(routes: readonly string[]): Router {
  const router = new Router();
  for (const route of routes) router.add(route);
  return router;
}

function split(path: string): string[] {
  return path.split("/").filter((s) => s !== "");
}
