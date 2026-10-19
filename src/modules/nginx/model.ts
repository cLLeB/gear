// nginx configuration read the way nginx reads it: directives and blocks
// across include files, which server block a request lands in, which
// location then handles it after rewrites, what it finally serves or
// proxies to — and the configuration mistakes that are easy to miss.

export interface Directive {
  name: string;
  args: string[];
  file: string;
  line: number;
  /** Present for blocks (`server { … }`). */
  children?: Directive[];
}

export class NginxSyntaxError extends Error {
  constructor(
    message: string,
    readonly file: string,
    readonly line: number,
  ) {
    super(`${file}:${line}: ${message}`);
  }
}

/** Parses one file into directives; `include` stays a directive for `loadConfig` to expand. */
export function parseNginx(text: string, file: string): Directive[] {
  let i = 0;
  let line = 1;
  const word = (): { value: string; line: number } | null => {
    for (;;) {
      while (i < text.length && /\s/.test(text[i])) {
        if (text[i] === "\n") line++;
        i++;
      }
      if (text[i] === "#") {
        while (i < text.length && text[i] !== "\n") i++;
        continue;
      }
      break;
    }
    if (i >= text.length) return null;
    const start = line;
    const ch = text[i];
    if (ch === ";" || ch === "{" || ch === "}") {
      i++;
      return { value: ch, line: start };
    }
    let v = "";
    if (ch === '"' || ch === "'") {
      i++;
      while (i < text.length && text[i] !== ch) {
        if (text[i] === "\\" && i + 1 < text.length) {
          v += text[i + 1];
          i += 2;
          continue;
        }
        if (text[i] === "\n") line++;
        v += text[i++];
      }
      i++;
      return { value: v, line: start };
    }
    // Unquoted: up to whitespace, ; or a brace that is not part of ${var}.
    while (i < text.length && !/\s/.test(text[i]) && text[i] !== ";") {
      if (text[i] === "{" && text[i - 1] !== "$") break;
      if (text[i] === "}" && !/\$\{[^}]*$/.test(v)) break;
      v += text[i++];
    }
    return { value: v, line: start };
  };
  const block = (closing: boolean): Directive[] => {
    const out: Directive[] = [];
    for (;;) {
      const w = word();
      if (!w) {
        if (closing) throw new NginxSyntaxError('unexpected end of file, expecting "}"', file, line);
        return out;
      }
      if (w.value === "}") {
        if (!closing) throw new NginxSyntaxError('unexpected "}"', file, w.line);
        return out;
      }
      if (w.value === ";" || w.value === "{") throw new NginxSyntaxError(`unexpected "${w.value}"`, file, w.line);
      const d: Directive = { name: w.value, args: [], file, line: w.line };
      for (;;) {
        const a = word();
        if (!a) throw new NginxSyntaxError(`unexpected end of file after "${d.name}"`, file, line);
        if (a.value === ";") break;
        if (a.value === "{") {
          d.children = block(true);
          break;
        }
        if (a.value === "}") throw new NginxSyntaxError(`directive "${d.name}" is not terminated by ";"`, file, a.line);
        d.args.push(a.value);
      }
      out.push(d);
    }
  };
  return block(false);
}

export interface Loader {
  read: (path: string) => Promise<string | null>;
  /** File names in a directory. */
  list: (dir: string) => Promise<string[]>;
}

const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, "");
const isAbs = (p: string) => /^([a-zA-Z]:)?[\\/]/.test(p);

/** Loads `entry` and expands `include` directives (globs in the last segment), relative to the entry's folder like nginx's prefix. */
export async function loadConfig(entry: string, loader: Loader): Promise<{ tree: Directive[]; files: string[]; missing: { file: string; line: number; pattern: string }[] }> {
  const prefix = dirOf(entry);
  const files: string[] = [];
  const missing: { file: string; line: number; pattern: string }[] = [];
  const loadFile = async (path: string, depth: number): Promise<Directive[]> => {
    const text = await loader.read(path);
    if (text === null) return [];
    files.push(path);
    return expand(parseNginx(text, path), depth);
  };
  const expand = async (ds: Directive[], depth: number): Promise<Directive[]> => {
    const out: Directive[] = [];
    for (const d of ds) {
      if (d.name === "include" && d.args[0] && depth < 12) {
        const pattern = isAbs(d.args[0]) ? d.args[0] : `${prefix}/${d.args[0]}`;
        const dir = dirOf(pattern);
        const last = pattern.slice(dir.length + 1);
        let targets: string[];
        if (/[*?[]/.test(last)) {
          const re = new RegExp(`^${last.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
          targets = (await loader.list(dir)).filter((n) => re.test(n)).sort().map((n) => `${dir}/${n}`);
        } else targets = [pattern];
        let found = 0;
        for (const t of targets) {
          const children = await loadFile(t, depth + 1);
          if (files.includes(t)) found++;
          out.push(...children);
        }
        // A glob that matches nothing is fine for nginx; a plain path that is missing is an error.
        if (!found && !/[*?[]/.test(last)) missing.push({ file: d.file, line: d.line, pattern: d.args[0] });
        continue;
      }
      out.push(d.children ? { ...d, children: await expand(d.children, depth) } : d);
    }
    return out;
  };
  const tree = await loadFile(entry, 0);
  return { tree, files, missing };
}

// ---------------------------------------------------------------- model of servers and locations

export interface Listen {
  address: string | null;
  port: number;
  defaultServer: boolean;
  ssl: boolean;
}

export interface Location {
  modifier: "=" | "^~" | "~" | "~*" | "" | "@";
  path: string;
  regex: RegExp | null;
  directive: Directive;
  locations: Location[];
}

export interface Server {
  directive: Directive;
  listens: Listen[];
  names: string[];
  locations: Location[];
}

const find = (ds: Directive[] | undefined, name: string) => (ds ?? []).filter((d) => d.name === name);

export function parseListen(args: string[]): Listen {
  const a = args[0] ?? "80";
  let address: string | null = null;
  let port = 80;
  if (/^unix:/.test(a)) address = a;
  else if (/^\d+$/.test(a)) port = Number(a);
  else {
    const m = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(a);
    if (m) {
      address = m[1] === "*" ? null : m[1];
      port = m[2] ? Number(m[2]) : 80;
    }
  }
  const flags = args.slice(1);
  return { address, port, defaultServer: flags.includes("default_server") || flags.includes("default"), ssl: flags.includes("ssl") };
}

function locationsOf(ds: Directive[] | undefined): Location[] {
  return find(ds, "location").map((d) => {
    const [first, second] = d.args;
    let modifier: Location["modifier"] = "";
    let path = first ?? "";
    if (first === "=" || first === "^~" || first === "~" || first === "~*") {
      modifier = first;
      path = second ?? "";
    } else if (first?.startsWith("@")) modifier = "@";
    else if (/^(=|\^~|~\*?)/.test(first ?? "") && first !== "~") {
      // location =/exact, location ~\.php$ written without a space.
      const m = /^(=|\^~|~\*|~)(.*)$/.exec(first as string) as RegExpExecArray;
      modifier = m[1] as Location["modifier"];
      path = m[2];
    }
    let regex: RegExp | null = null;
    if (modifier === "~" || modifier === "~*") {
      try {
        regex = new RegExp(pcreToJs(path), modifier === "~*" ? "i" : "");
      } catch {
        regex = null;
      }
    }
    return { modifier, path, regex, directive: d, locations: locationsOf(d.children) };
  });
}

/** PCRE features JavaScript spells differently: named groups `(?P<n>…)`, `(?<n>…)` stay. */
export function pcreToJs(re: string): string {
  return re.replace(/\(\?P<([A-Za-z_]\w*)>/g, "(?<$1>").replace(/\(\?P=([A-Za-z_]\w*)\)/g, "\\k<$1>");
}

export function serversOf(tree: Directive[]): Server[] {
  const http = find(tree, "http");
  const blocks = http.length ? http.flatMap((h) => find(h.children, "server")) : find(tree, "server");
  return blocks.map((d) => ({
    directive: d,
    listens: find(d.children, "listen").map((l) => parseListen(l.args)).concat(find(d.children, "listen").length ? [] : [parseListen(["80"])]),
    names: find(d.children, "server_name").flatMap((n) => n.args),
    locations: locationsOf(d.children),
  }));
}

/** The server block nginx picks for a request on `port` with this Host header. */
export function selectServer(servers: Server[], host: string, port: number, address: string | null = null): { server: Server | null; why: string } {
  const h = host.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  const onPort = servers.filter((s) => s.listens.some((l) => l.port === port && (!l.address || !address || l.address === address)));
  if (!onPort.length) return { server: null, why: `no server listens on port ${port}` };
  const exact = onPort.find((s) => s.names.some((n) => n.toLowerCase() === h));
  if (exact) return { server: exact, why: `exact server_name ${h}` };
  let best: { s: Server; len: number; name: string } | null = null;
  for (const s of onPort)
    for (const n of s.names) {
      const name = n.toLowerCase();
      const suffix = name.startsWith("*.") ? name.slice(1) : name.startsWith(".") ? name : null;
      if (suffix && (h.endsWith(suffix) || (name.startsWith(".") && h === name.slice(1))) && (!best || suffix.length > best.len)) best = { s, len: suffix.length, name: n };
    }
  if (best) return { server: best.s, why: `wildcard server_name ${best.name}` };
  for (const s of onPort)
    for (const n of s.names) {
      const name = n.toLowerCase();
      if (name.endsWith(".*") && h.startsWith(name.slice(0, -1)) && (!best || name.length > best.len)) best = { s, len: name.length, name: n };
    }
  if (best) return { server: best.s, why: `wildcard server_name ${best.name}` };
  for (const s of onPort)
    for (const n of s.names)
      if (n.startsWith("~")) {
        try {
          if (new RegExp(pcreToJs(n.slice(1)), "i").test(h)) return { server: s, why: `regex server_name ${n}` };
        } catch {
          /* invalid regex: nginx would refuse to start */
        }
      }
  const dflt = onPort.find((s) => s.listens.some((l) => l.port === port && l.defaultServer));
  if (dflt) return { server: dflt, why: `no name matched ${h}; default_server for port ${port}` };
  return { server: onPort[0], why: `no name matched ${h}; first server on port ${port} is the default` };
}

export interface LocationMatch {
  location: Location | null;
  captures: string[];
  why: string;
}

/** nginx's location search: exact, longest prefix (with its nested locations), ^~, then regexes in order. */
export function selectLocation(locations: Location[], uri: string): LocationMatch {
  const exact = locations.find((l) => l.modifier === "=" && l.path === uri);
  if (exact) return { location: exact, captures: [], why: `exact match = ${exact.path}` };
  let best: Location | null = null;
  for (const l of locations) if ((l.modifier === "" || l.modifier === "^~") && uri.startsWith(l.path) && (!best || l.path.length > best.path.length)) best = l;
  let nested: LocationMatch | null = null;
  if (best && best.locations.length) {
    const n = selectLocation(best.locations, uri);
    if (n.location) nested = { ...n, why: `${n.why}, nested in ${best.path}` };
  }
  if (best?.modifier === "^~") return nested ?? { location: best, captures: [], why: `longest prefix ^~ ${best.path} (regexes skipped)` };
  if (nested && (nested.location?.regex || nested.location?.modifier === "=")) return nested;
  for (const l of locations) {
    if (!l.regex) continue;
    const m = l.regex.exec(uri);
    if (m) return { location: l, captures: m.slice(1).map((c) => c ?? ""), why: `first matching regex ${l.modifier} ${l.path}` };
  }
  if (nested) return nested;
  if (best) return { location: best, captures: [], why: `longest prefix ${best.path}` };
  return { location: null, captures: [], why: "no location matches" };
}

export interface Request {
  host: string;
  port: number;
  uri: string;
  args: string;
  scheme: "http" | "https";
}

export interface Outcome {
  server: Server | null;
  serverWhy: string;
  location: Location | null;
  locationWhy: string;
  /** Rewrites applied, in order. */
  steps: string[];
  /** The final URI after internal rewrites. */
  uri: string;
  result: { kind: "return"; status: number; body: string } | { kind: "proxy"; target: string; upstream: string[] | null } | { kind: "file"; paths: string[]; fallback: string | null } | { kind: "fastcgi"; target: string } | { kind: "none"; detail: string };
  headers: { name: string; value: string; from: string }[];
}

const inherited = (chain: Directive[][], name: string) => {
  for (let k = chain.length - 1; k >= 0; k--) {
    const ds = find(chain[k], name);
    if (ds.length) return ds;
  }
  return [];
};

function substitute(s: string, vars: Record<string, string>, captures: string[]): string {
  return s.replace(/\$(\d)|\$\{?([A-Za-z_]\w*)\}?/g, (all, n: string | undefined, v: string | undefined) => (n !== undefined ? (captures[Number(n) - 1] ?? "") : v !== undefined && v in vars ? vars[v] : all));
}

/** Follows a request through server selection, rewrites and location matching to what nginx does with it. */
export function route(tree: Directive[], req: Request): Outcome {
  const servers = serversOf(tree);
  const { server, why } = selectServer(servers, req.host, req.port);
  const steps: string[] = [];
  const empty: Outcome = { server, serverWhy: why, location: null, locationWhy: "", steps, uri: req.uri, result: { kind: "none", detail: why }, headers: [] };
  if (!server) return empty;
  const http = find(tree, "http")[0]?.children ?? [];
  let uri = req.uri;
  const vars = () => ({ uri, request_uri: req.uri + (req.args ? `?${req.args}` : ""), host: req.host.replace(/:\d+$/, ""), http_host: req.host, server_name: server.names[0] ?? "", scheme: req.scheme, args: req.args, query_string: req.args, is_args: req.args ? "?" : "", document_uri: uri, server_port: String(req.port) });
  const ret = (d: Directive, captures: string[]): Outcome["result"] => {
    const [a, b] = d.args;
    if (/^\d{3}$/.test(a)) return { kind: "return", status: Number(a), body: substitute(b ?? "", vars(), captures) };
    return { kind: "return", status: 302, body: substitute(a ?? "", vars(), captures) };
  };
  // Rewrite-module directives run in order; returns true when it ends the request.
  const runRewrites = (ds: Directive[], where: string, captures: string[]): { stop: Outcome["result"] | null; restart: boolean; brk: boolean } => {
    for (const d of ds) {
      if (d.name === "return") return { stop: ret(d, captures), restart: false, brk: false };
      if (d.name === "rewrite" && d.args.length >= 2) {
        let re: RegExp;
        try {
          re = new RegExp(pcreToJs(d.args[0]));
        } catch {
          continue;
        }
        const m = re.exec(uri);
        if (!m) continue;
        const caps = m.slice(1).map((c) => c ?? "");
        const target = substitute(d.args[1], vars(), caps);
        const flag = d.args[2] ?? "";
        steps.push(`${where} rewrite ${d.args[0]} → ${target}${flag ? ` (${flag})` : ""} [${d.file.split(/[\\/]/).pop()}:${d.line}]`);
        if (flag === "redirect" || flag === "permanent" || /^https?:\/\//.test(target)) return { stop: { kind: "return", status: flag === "permanent" ? 301 : 302, body: target }, restart: false, brk: false };
        uri = target.split("?")[0];
        if (flag === "last") return { stop: null, restart: true, brk: false };
        if (flag === "break") return { stop: null, restart: false, brk: true };
      }
    }
    return { stop: null, restart: false, brk: false };
  };
  const serverRw = runRewrites(server.directive.children?.filter((d) => d.name === "rewrite" || d.name === "return") ?? [], "server", []);
  if (serverRw.stop) return { ...empty, steps, uri, result: serverRw.stop };
  let match: LocationMatch = { location: null, captures: [], why: "" };
  for (let round = 0; round < 10; round++) {
    match = selectLocation(server.locations, uri);
    if (!match.location) break;
    const rw = runRewrites(match.location.directive.children?.filter((d) => d.name === "rewrite" || d.name === "return") ?? [], `location ${match.location.modifier} ${match.location.path}`.replace("  ", " "), match.captures);
    if (rw.stop) return { ...empty, location: match.location, locationWhy: match.why, steps, uri, result: rw.stop, headers: headersFor(http, server, match.location) };
    if (!rw.restart) break;
    if (round === 9) return { ...empty, steps, uri, result: { kind: "none", detail: "rewrite cycle: nginx gives up after 10 internal redirects (500)" } };
  }
  const loc = match.location;
  if (!loc) return { ...empty, steps, uri, locationWhy: match.why, result: { kind: "none", detail: "no location matches; nginx serves files from the server's root" } };
  const chain = [http, server.directive.children ?? [], ...locationChain(server.locations, loc).map((l) => l.directive.children ?? [])];
  const own = loc.directive.children ?? [];
  const base = { ...empty, location: loc, locationWhy: match.why, steps, uri, headers: headersFor(http, server, loc) };
  const proxy = find(own, "proxy_pass")[0];
  if (proxy) {
    const target = substitute(proxy.args[0] ?? "", vars(), match.captures);
    const m = /^(https?:\/\/)([^/]+)(\/.*)?$/.exec(target);
    const upstreamName = m?.[2] ?? "";
    const up = find(http, "upstream").find((u) => u.args[0] === upstreamName);
    let full = target;
    // With a URI part, the matched prefix is replaced by it; without, the request URI passes unchanged.
    if (m && m[3] !== undefined && !loc.regex && !/\$/.test(proxy.args[0])) full = `${m[1]}${m[2]}${m[3]}${uri.slice(loc.path.length)}`;
    else if (m && m[3] === undefined) full = `${target}${uri}`;
    return { ...base, result: { kind: "proxy", target: full + (req.args ? `?${req.args}` : ""), upstream: up ? find(up.children, "server").map((s) => s.args.join(" ")) : null } };
  }
  const fcgi = find(own, "fastcgi_pass")[0] ?? find(own, "uwsgi_pass")[0] ?? find(own, "grpc_pass")[0];
  if (fcgi) return { ...base, result: { kind: "fastcgi", target: `${fcgi.name} ${fcgi.args[0]}` } };
  const alias = find(own, "alias")[0];
  const root = inherited(chain, "root")[0];
  const fileFor = (u: string) => {
    if (alias) {
      const a = substitute(alias.args[0] ?? "", vars(), match.captures);
      return loc.regex ? a : a + u.slice(loc.path.length);
    }
    return `${(root ? substitute(root.args[0], vars(), match.captures) : "html").replace(/\/$/, "")}${u}`;
  };
  const tryFiles = inherited(chain, "try_files")[0];
  if (tryFiles) {
    const options = tryFiles.args.slice(0, -1).map((a) => substitute(a, vars(), match.captures));
    const last = tryFiles.args[tryFiles.args.length - 1];
    return { ...base, result: { kind: "file", paths: options.map((o) => fileFor(o.replace(/\/$/, "/"))), fallback: last ? substitute(last, vars(), match.captures) : null } };
  }
  const index = inherited(chain, "index")[0]?.args ?? ["index.html"];
  return { ...base, result: { kind: "file", paths: uri.endsWith("/") ? index.map((i) => fileFor(uri + i)) : [fileFor(uri)], fallback: null } };
}

function locationChain(locations: Location[], target: Location, trail: Location[] = []): Location[] {
  for (const l of locations) {
    if (l === target) return [...trail, l];
    const r = locationChain(l.locations, target, [...trail, l]);
    if (r.length) return r;
  }
  return [];
}

/** add_header is inherited only by levels that set none of their own. */
function headersFor(http: Directive[], server: Server, loc: Location | null): Outcome["headers"] {
  const levels: { ds: Directive[]; from: string }[] = [
    { ds: http, from: "http" },
    { ds: server.directive.children ?? [], from: "server" },
    ...(loc ? locationChain(server.locations, loc).map((l) => ({ ds: l.directive.children ?? [], from: `location ${l.path}` })) : []),
  ];
  for (let k = levels.length - 1; k >= 0; k--) {
    const hs = find(levels[k].ds, "add_header");
    if (hs.length) return hs.map((h) => ({ name: h.args[0] ?? "", value: h.args[1] ?? "", from: levels[k].from }));
  }
  return [];
}

// ---------------------------------------------------------------- lint

export interface Issue {
  severity: "danger" | "warning" | "info";
  file: string;
  line: number;
  message: string;
}

const SECURITY_HEADERS = /^(strict-transport-security|content-security-policy|x-frame-options|x-content-type-options|referrer-policy|permissions-policy)$/i;

export function lintNginx(tree: Directive[]): Issue[] {
  const issues: Issue[] = [];
  const at = (d: Directive, severity: Issue["severity"], message: string) => issues.push({ severity, file: d.file, line: d.line, message });
  const anyDirective = (ds: Directive[], name: string): boolean => ds.some((d) => d.name === name || (d.children ? anyDirective(d.children, name) : false));
  const hasResolver = anyDirective(tree, "resolver");
  const walk = (ds: Directive[], parentHeaders: Directive[], ctx: string) => {
    const own = find(ds, "add_header");
    const inheritedHeaders = own.length ? own : parentHeaders;
    if (own.length && parentHeaders.length) {
      const lost = parentHeaders.filter((p) => SECURITY_HEADERS.test(p.args[0] ?? "") && !own.some((o) => (o.args[0] ?? "").toLowerCase() === (p.args[0] ?? "").toLowerCase()));
      if (lost.length) at(own[0], "warning", `add_header here replaces every inherited add_header, so ${lost.map((l) => l.args[0]).join(", ")} ${lost.length === 1 ? "is" : "are"} no longer sent from this ${ctx}.`);
    }
    for (const d of ds) {
      if (d.name === "location") {
        const pathArg = d.args[d.args.length - 1] ?? "";
        const isRegex = d.args[0] === "~" || d.args[0] === "~*";
        const alias = find(d.children, "alias")[0];
        if (alias && !isRegex && !pathArg.endsWith("/") && (alias.args[0] ?? "").endsWith("/")) at(alias, "danger", `location ${pathArg} has no trailing slash but its alias does: /${pathArg.replace(/^\//, "")}../ reaches the parent of ${alias.args[0]} (path traversal). Add the slash to the location, or remove it from the alias.`);
        if (find(d.children, "if").length) at(find(d.children, "if")[0], "info", "if inside a location is evaluated by the rewrite module and mixes badly with other directives (\"if is evil\"); only return and rewrite … last are reliable inside it.");
        if (isRegex) {
          try {
            new RegExp(pcreToJs(pathArg));
          } catch {
            at(d, "warning", `This regex cannot be checked here (${pathArg}); it uses PCRE syntax JavaScript lacks.`);
          }
        }
        walk(d.children ?? [], inheritedHeaders, `location ${pathArg}`);
      } else if (d.name === "server" || d.name === "http") walk(d.children ?? [], inheritedHeaders, d.name);
      else if (d.name === "server_tokens" && d.args[0] === "on") at(d, "info", "server_tokens on shows the nginx version in error pages and the Server header.");
      else if (d.name === "ssl_protocols") {
        const old = d.args.filter((p) => /^(SSLv2|SSLv3|TLSv1|TLSv1\.1)$/.test(p));
        if (old.length) at(d, "warning", `ssl_protocols allows ${old.join(", ")}, which are broken or deprecated; use TLSv1.2 TLSv1.3.`);
      } else if (d.name === "autoindex" && d.args[0] === "on") at(d, "info", "autoindex on lists directory contents to anyone.");
      else if (d.name === "proxy_pass" && /^https?:\/\/[^/]*\$/.test(d.args[0] ?? "") && !hasResolver) at(d, "danger", `proxy_pass ${d.args[0]} names its host with a variable, so nginx resolves it at request time — and with no resolver directive configured those requests fail with 502.`);
    }
  };
  walk(tree, [], "http");
  // Same name on the same port in two servers: nginx warns "conflicting server name" and ignores the second.
  const servers = serversOf(tree);
  const seen = new Map<string, Server>();
  for (const s of servers)
    for (const l of s.listens)
      for (const n of s.names) {
        const key = `${l.port}|${n.toLowerCase()}`;
        const prev = seen.get(key);
        if (prev && prev !== s) at(s.directive, "warning", `server_name ${n} on port ${l.port} is also used by the server at ${prev.directive.file.split(/[\\/]/).pop()}:${prev.directive.line}; nginx ignores this one for that name.`);
        else seen.set(key, s);
      }
  const ports = new Map<number, Server[]>();
  for (const s of servers) for (const l of s.listens) ports.set(l.port, [...(ports.get(l.port) ?? []), s]);
  for (const [port, list] of ports) {
    const defaults = list.filter((s) => s.listens.some((l) => l.port === port && l.defaultServer));
    if (defaults.length > 1) at(defaults[1].directive, "danger", `A second default_server for port ${port}; nginx refuses to start ("a duplicate default server").`);
  }
  for (const s of servers) {
    const cert = find(s.directive.children, "ssl_certificate")[0];
    if (cert && !s.listens.some((l) => l.ssl) && !find(s.directive.children, "ssl").some((d) => d.args[0] === "on")) at(cert, "warning", "This server has a certificate but no listen … ssl, so it never speaks TLS.");
    if (s.listens.some((l) => l.ssl) && !cert && !find(find(tree, "http")[0]?.children, "ssl_certificate").length) at(s.directive, "danger", "listen … ssl without an ssl_certificate: TLS handshakes fail.");
  }
  return issues.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}
