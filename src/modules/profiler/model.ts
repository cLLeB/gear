// CPU profiles from V8 / Node (.cpuprofile), speedscope JSON (py-spy, rbspy,
// many exporters) and collapsed stacks (perf / py-spy raw / inferno) turned
// into one call tree, plus per-function totals for the table view.

export interface Frame {
  name: string;
  file: string | null;
  /** 1-based line, when known. */
  line: number | null;
}

export interface CallNode {
  id: number;
  frame: Frame;
  /** Time (or samples) spent in this node itself. */
  self: number;
  /** Self plus all descendants. */
  total: number;
  children: CallNode[];
  parent: CallNode | null;
  depth: number;
}

export interface Profile {
  root: CallNode;
  /** "ms", "samples", "bytes"… */
  unit: string;
  name: string;
  /** Deepest stack. */
  maxDepth: number;
}

const IDLE = /^\((idle|program|garbage collector|root)\)$/;

class Builder {
  private nextId = 1;
  root: CallNode = { id: 0, frame: { name: "(all)", file: null, line: null }, self: 0, total: 0, children: [], parent: null, depth: 0 };
  private index = new Map<CallNode, Map<string, CallNode>>();

  /** Add one stack (outermost first) with a weight. */
  add(stack: Frame[], weight: number): void {
    if (weight <= 0) return;
    let node = this.root;
    node.total += weight;
    for (const f of stack) {
      let kids = this.index.get(node);
      if (!kids) this.index.set(node, (kids = new Map()));
      const key = `${f.name}\u0000${f.file ?? ""}\u0000${f.line ?? ""}`;
      let child = kids.get(key);
      if (!child) {
        child = { id: this.nextId++, frame: f, self: 0, total: 0, children: [], parent: node, depth: node.depth + 1 };
        kids.set(key, child);
        node.children.push(child);
      }
      child.total += weight;
      node = child;
    }
    node.self += weight;
  }

  finish(unit: string, name: string): Profile {
    let maxDepth = 0;
    const sort = (n: CallNode) => {
      if (n.depth > maxDepth) maxDepth = n.depth;
      n.children.sort((a, b) => b.total - a.total);
      n.children.forEach(sort);
    };
    sort(this.root);
    return { root: this.root, unit, name, maxDepth };
  }
}

function fileFromUrl(url: string): string | null {
  if (!url) return null;
  if (url.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(url).pathname).replace(/^\/([a-zA-Z]:)/, "$1");
    } catch {
      return url.slice(7);
    }
  }
  return url;
}

/** V8 / Chrome DevTools .cpuprofile. */
export function parseCpuProfile(json: unknown, name = "profile"): Profile {
  const p = json as {
    nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[] }[];
    samples?: number[];
    timeDeltas?: number[];
  };
  if (!Array.isArray(p.nodes)) throw new Error("Not a .cpuprofile (no nodes)");
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const parent = new Map<number, number>();
  for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  // Time per node: each sample's duration is the delta to the next sample.
  const time = new Map<number, number>();
  const samples = p.samples ?? [];
  const deltas = p.timeDeltas ?? [];
  for (let i = 0; i < samples.length; i++) {
    const dt = (deltas[i + 1] ?? deltas[i] ?? 0) / 1000;
    time.set(samples[i], (time.get(samples[i]) ?? 0) + Math.max(0, dt));
  }
  const b = new Builder();
  const stackCache = new Map<number, Frame[]>();
  const stackOf = (id: number): Frame[] => {
    const hit = stackCache.get(id);
    if (hit) return hit;
    const out: Frame[] = [];
    for (let cur: number | undefined = id; cur !== undefined; cur = parent.get(cur)) {
      const n = byId.get(cur);
      if (!n) break;
      const cf = n.callFrame;
      if (cf.functionName === "(root)") continue;
      out.unshift({ name: cf.functionName || "(anonymous)", file: fileFromUrl(cf.url), line: cf.lineNumber >= 0 ? cf.lineNumber + 1 : null });
    }
    stackCache.set(id, out);
    return out;
  };
  for (const [id, t] of time) {
    const stack = stackOf(id);
    if (stack.length === 1 && IDLE.test(stack[0].name) && stack[0].name !== "(garbage collector)") continue;
    b.add(stack, t);
  }
  return b.finish("ms", name);
}

/** speedscope file format (sampled and evented profiles). */
export function parseSpeedscope(json: unknown): Profile {
  const s = json as {
    shared: { frames: { name: string; file?: string; line?: number }[] };
    profiles: ({ type: "sampled"; unit: string; name: string; samples: number[][]; weights: number[] } | { type: "evented"; unit: string; name: string; events: { type: "O" | "C"; at: number; frame: number }[] })[];
    activeProfileIndex?: number;
    name?: string;
  };
  if (!s?.shared?.frames || !Array.isArray(s.profiles)) throw new Error("Not a speedscope file");
  const frames: Frame[] = s.shared.frames.map((f) => ({ name: f.name, file: f.file ?? null, line: f.line ?? null }));
  const b = new Builder();
  const prof = s.profiles[s.activeProfileIndex ?? 0] ?? s.profiles[0];
  if (prof.type === "sampled") {
    prof.samples.forEach((stack, i) => b.add(stack.map((k) => frames[k]), prof.weights[i] ?? 1));
  } else {
    const open: number[] = [];
    let last = prof.events[0]?.at ?? 0;
    for (const e of prof.events) {
      if (open.length && e.at > last) b.add(open.map((k) => frames[k]), e.at - last);
      last = e.at;
      if (e.type === "O") open.push(e.frame);
      else open.splice(open.lastIndexOf(e.frame), 1);
    }
  }
  const unit = prof.unit === "milliseconds" ? "ms" : prof.unit === "seconds" ? "s" : prof.unit === "nanoseconds" ? "ns" : prof.unit === "microseconds" ? "µs" : prof.unit === "none" ? "samples" : prof.unit;
  return b.finish(unit, prof.name || s.name || "profile");
}

/** Collapsed stacks: "a;b;c 12" per line (frames may carry "(file:line)" or " [file:line]"). */
export function parseCollapsed(text: string, name = "profile"): Profile {
  const b = new Builder();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const m = /^(.*\S)\s+(\d+(?:\.\d+)?)$/.exec(line);
    if (!m) continue;
    const stack = m[1].split(";").map((f) => {
      const loc = /^(.*?)\s*[([]([^()[\]]+?):(\d+)[)\]]$/.exec(f);
      return loc ? { name: loc[1].trim() || f, file: loc[2], line: Number(loc[3]) } : { name: f, file: null, line: null };
    });
    b.add(stack, Number(m[2]));
  }
  return b.finish("samples", name);
}

/** Detect the format from the file name / content. */
export function parseProfile(text: string, fileName: string): Profile {
  const base = fileName.replace(/^.*[\\/]/, "");
  if (/^\s*[{[]/.test(text)) {
    const json = JSON.parse(text);
    if (json && typeof json === "object" && "shared" in json && "profiles" in json) return parseSpeedscope(json);
    if (json && typeof json === "object" && "nodes" in json) return parseCpuProfile(json, base);
    throw new Error("Unrecognized JSON profile (expected .cpuprofile or speedscope)");
  }
  return parseCollapsed(text, base);
}

// ── analysis ──────────────────────────────────────────────────────────────

export interface FunctionStat {
  key: string;
  frame: Frame;
  self: number;
  /** Total without double counting recursion. */
  total: number;
  calls: number;
}

export function functionStats(profile: Profile): FunctionStat[] {
  const stats = new Map<string, FunctionStat>();
  const walk = (n: CallNode, onStack: Set<string>) => {
    if (n.depth > 0) {
      const key = `${n.frame.name}\u0000${n.frame.file ?? ""}`;
      let s = stats.get(key);
      if (!s) stats.set(key, (s = { key, frame: n.frame, self: 0, total: 0, calls: 0 }));
      s.self += n.self;
      s.calls++;
      // Recursive frames are counted once, at their outermost occurrence.
      if (!onStack.has(key)) s.total += n.total;
      onStack = new Set(onStack).add(key);
    }
    for (const c of n.children) walk(c, onStack);
  };
  walk(profile.root, new Set());
  return [...stats.values()].sort((a, b) => b.self - a.self);
}

/** The heaviest root-to-leaf path (follow the biggest child while it holds most of the time). */
export function hotPath(profile: Profile, threshold = 0.5): CallNode[] {
  const out: CallNode[] = [];
  let n = profile.root;
  while (n.children.length) {
    const c = n.children[0];
    if (c.total < n.total * threshold) break;
    out.push(c);
    n = c;
  }
  return out;
}

/** Merge every node of a function into one tree rooted at it (the "callees" view). */
export function focusFunction(profile: Profile, key: string): Profile {
  const b = new Builder();
  const walk = (n: CallNode, stack: Frame[] | null) => {
    const k = `${n.frame.name}\u0000${n.frame.file ?? ""}`;
    let s = stack;
    if (n.depth > 0) {
      if (s) s = [...s, n.frame];
      else if (k === key) s = [n.frame];
    }
    if (s && n.self > 0) b.add(s, n.self);
    for (const c of n.children) walk(c, s);
  };
  walk(profile.root, null);
  return b.finish(profile.unit, profile.name);
}

export function formatValue(v: number, unit: string): string {
  if (unit === "ms") return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v.toFixed(v < 10 ? 2 : 1)} ms`;
  if (unit === "bytes") return v > 1 << 20 ? `${(v / (1 << 20)).toFixed(1)} MB` : `${(v / 1024).toFixed(1)} KB`;
  return `${Math.round(v)} ${unit}`;
}

/** Stable colour per file / package so related frames share a hue. */
export function frameColor(frame: Frame, dark: boolean): string {
  const key = frame.file?.replace(/^.*node_modules\/((@[^/]+\/)?[^/]+).*/, "$1").replace(/[^/\\]*$/, "") ?? frame.name;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const native = !frame.file || /^(node:|<|\(|internal)/.test(frame.file);
  const hue = native ? 30 : 160 + (h % 160);
  return dark ? `hsl(${hue} ${native ? 45 : 50}% ${native ? 38 : 34}%)` : `hsl(${hue} ${native ? 70 : 60}% ${native ? 72 : 76}%)`;
}
