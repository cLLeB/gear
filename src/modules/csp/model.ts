// Content-Security-Policy, read by the CSP Level 3 rules browsers apply:
// directives with their fallbacks, the weaknesses that let script
// injection through, and a matcher that answers "would this resource load
// on this page?".

export type Severity = "high" | "medium" | "low" | "info";

export interface Policy {
  /** Directive → source list, first occurrence only (browsers ignore repeats). */
  directives: Map<string, string[]>;
  reportOnly: boolean;
  problems: string[];
}

export interface Finding {
  severity: Severity;
  directive: string;
  message: string;
}

const FETCH = ["default-src", "script-src", "script-src-elem", "script-src-attr", "style-src", "style-src-elem", "style-src-attr", "img-src", "font-src", "connect-src", "media-src", "object-src", "frame-src", "child-src", "worker-src", "manifest-src", "prefetch-src", "fenced-frame-src"];
const OTHER = ["base-uri", "form-action", "frame-ancestors", "sandbox", "upgrade-insecure-requests", "block-all-mixed-content", "report-uri", "report-to", "require-trusted-types-for", "trusted-types", "plugin-types", "navigate-to", "referrer", "require-sri-for"];
const DEPRECATED: Record<string, string> = {
  "block-all-mixed-content": "is obsolete; browsers already block mixed content (use upgrade-insecure-requests to fix it)",
  "plugin-types": "was removed from browsers",
  referrer: "was removed; use the Referrer-Policy header",
  "require-sri-for": "was never shipped by browsers",
  "navigate-to": "was removed from the specification",
  "prefetch-src": "was removed from the specification",
  "report-uri": "is deprecated in favour of report-to, but still the only one Firefox supports — keep both",
};
const KEYWORDS = ["'self'", "'none'", "'unsafe-inline'", "'unsafe-eval'", "'strict-dynamic'", "'unsafe-hashes'", "'report-sample'", "'wasm-unsafe-eval'", "'unsafe-allow-redirects'", "'inline-speculation-rules'"];

/** Fallback chain for each fetch directive, most specific first. */
export const FALLBACK: Record<string, string[]> = {
  "script-src-elem": ["script-src-elem", "script-src", "default-src"],
  "script-src-attr": ["script-src-attr", "script-src", "default-src"],
  "script-src": ["script-src", "default-src"],
  "style-src-elem": ["style-src-elem", "style-src", "default-src"],
  "style-src-attr": ["style-src-attr", "style-src", "default-src"],
  "style-src": ["style-src", "default-src"],
  "worker-src": ["worker-src", "child-src", "script-src", "default-src"],
  "frame-src": ["frame-src", "child-src", "default-src"],
  "child-src": ["child-src", "default-src"],
  "img-src": ["img-src", "default-src"],
  "font-src": ["font-src", "default-src"],
  "connect-src": ["connect-src", "default-src"],
  "media-src": ["media-src", "default-src"],
  "object-src": ["object-src", "default-src"],
  "manifest-src": ["manifest-src", "default-src"],
  "fenced-frame-src": ["fenced-frame-src", "frame-src", "child-src", "default-src"],
};

/** Parses one policy (a header may hold several, separated by commas: see `parsePolicies`). */
export function parsePolicy(text: string, reportOnly = false): Policy {
  const directives = new Map<string, string[]>();
  const problems: string[] = [];
  for (const raw of text.split(";")) {
    const tokens = raw.trim().split(/[\t\n\f\r ]+/).filter(Boolean);
    if (!tokens.length) continue;
    const name = tokens[0].toLowerCase();
    if (!/^[a-z0-9-]+$/.test(name)) {
      problems.push(`“${tokens[0]}” is not a directive name.`);
      continue;
    }
    if (directives.has(name)) {
      problems.push(`${name} appears twice; browsers use the first and ignore “${raw.trim()}”.`);
      continue;
    }
    if (!FETCH.includes(name) && !OTHER.includes(name)) problems.push(`${name} is not a CSP directive; browsers ignore it.`);
    directives.set(name, tokens.slice(1));
  }
  return { directives, reportOnly, problems };
}

/** A header value may carry several policies separated by commas; all of them apply. */
export function parsePolicies(header: string, reportOnly = false): Policy[] {
  // Source expressions never contain commas (report-to takes a token), so splitting on them is safe.
  return header
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => parsePolicy(p, reportOnly));
}

/** The source list that governs `directive`, and the directive it came from (null: no restriction). */
export function effective(policy: Policy, directive: string): { from: string | null; sources: string[] | null } {
  for (const d of FALLBACK[directive] ?? [directive]) {
    const s = policy.directives.get(d);
    if (s) return { from: d, sources: s };
  }
  return { from: null, sources: null };
}

const lower = (s: string[]) => s.map((x) => x.toLowerCase());
const hasNonceOrHash = (s: string[]) => s.some((x) => /^'(nonce|sha256|sha384|sha512)-/i.test(x));

/** Script hosts known to serve JSONP endpoints or old AngularJS, which turn an allowlist into a bypass. */
const BYPASS_HOSTS = [/(^|\.)googleapis\.com$/, /(^|\.)gstatic\.com$/, /(^|\.)google\.com$/, /^cdnjs\.cloudflare\.com$/, /^cdn\.jsdelivr\.net$/, /^unpkg\.com$/, /(^|\.)googletagmanager\.com$/, /(^|\.)google-analytics\.com$/, /(^|\.)facebook\.(com|net)$/, /^cdn\.ampproject\.org$/, /(^|\.)yandex\.(ru|net)$/, /(^|\.)twitter\.com$/, /(^|\.)github\.io$/, /(^|\.)herokuapp\.com$/, /(^|\.)firebaseapp\.com$/, /(^|\.)appspot\.com$/, /(^|\.)azurewebsites\.net$/, /(^|\.)cloudfront\.net$/, /(^|\.)amazonaws\.com$/];

const hostOf = (src: string) => /^(?:[a-z][a-z0-9+.-]*:\/\/)?(\*\.)?([^/:]+)/i.exec(src)?.[2]?.toLowerCase() ?? "";

export function evaluate(policy: Policy): Finding[] {
  const out: Finding[] = [];
  const add = (severity: Severity, directive: string, message: string) => out.push({ severity, directive, message });
  for (const p of policy.problems) add("low", "", p);
  for (const [name, why] of Object.entries(DEPRECATED)) if (policy.directives.has(name)) add(name === "report-uri" ? "info" : "low", name, `${name} ${why}.`);

  // Unquoted keywords are read as host names.
  for (const [name, sources] of policy.directives)
    for (const s of sources) {
      if (/^(self|none|unsafe-inline|unsafe-eval|strict-dynamic|unsafe-hashes|report-sample|wasm-unsafe-eval)$/i.test(s)) add("medium", name, `${s} without quotes is a host named “${s}”, not the keyword; write '${s.toLowerCase()}'.`);
      if (/^'[^']*'$/.test(s) && !KEYWORDS.includes(s.toLowerCase()) && !/^'(nonce|sha256|sha384|sha512)-/i.test(s)) add("low", name, `${s} is not a CSP keyword; browsers ignore it.`);
      if (/^'none'$/i.test(s) && sources.length > 1) add("low", name, `'none' is ignored when ${name} lists other sources too.`);
      const nonce = /^'nonce-([^']*)'$/i.exec(s);
      if (nonce && (nonce[1].length < 16 || /^(abc|test|nonce|random|123)/i.test(nonce[1]))) add("medium", name, `The nonce ${s} looks short or fixed; a nonce must be at least 128 bits of fresh randomness on every response.`);
      if (/^https?:\/\/\d{1,3}(\.\d{1,3}){3}/.test(s) || /^\d{1,3}(\.\d{1,3}){3}/.test(s)) add("low", name, `${s} is an IP address; certificates and ownership of IPs change, prefer host names.`);
      if (/^http:/i.test(s)) add("medium", name, `${s} allows loading over plain HTTP, which anyone on the network can change.`);
    }

  const script = effective(policy, "script-src");
  if (!script.sources) add("high", "script-src", "No script-src or default-src: scripts from anywhere, inline scripts and eval are all allowed. The policy does not stop script injection.");
  else {
    const s = lower(script.sources);
    const strict = s.includes("'strict-dynamic'");
    const noncey = hasNonceOrHash(script.sources);
    if (s.includes("'unsafe-inline'") && !noncey && !strict) add("high", script.from as string, "'unsafe-inline' lets any injected <script> and on* handler run; this cancels most of CSP's protection. Use nonces or hashes.");
    else if (s.includes("'unsafe-inline'")) add("info", script.from as string, "'unsafe-inline' is ignored by browsers that support nonces/hashes; it is only a fallback for very old ones.");
    if (s.includes("'unsafe-eval'")) add("medium", script.from as string, "'unsafe-eval' allows eval(), new Function() and string timers, so injected strings can become code.");
    if (strict && !noncey) add("high", script.from as string, "'strict-dynamic' with no nonce or hash blocks every script, since nothing is trusted to load the rest.");
    if (!strict) {
      for (const src of s) {
        if (src === "*") add("high", script.from as string, "* allows scripts from any host.");
        else if (/^(https?|data|blob|filesystem):$/.test(src)) add("high", script.from as string, `${src} allows scripts from ${src === "data:" ? "data: URLs, which an attacker can write inline" : `any ${src.replace(":", "")} URL`}.`);
        else if (!src.startsWith("'")) {
          const host = hostOf(src);
          if (src.startsWith("*.") || src.includes("://*.")) add("medium", script.from as string, `${src} trusts every subdomain of ${host}; any one of them that serves user content or JSONP becomes a bypass.`);
          else if (BYPASS_HOSTS.some((re) => re.test(host))) add("medium", script.from as string, `${src} hosts JSONP endpoints or libraries (such as old AngularJS) that run attacker-chosen code, so allowing it can bypass the policy. Prefer nonces with 'strict-dynamic'.`);
        }
      }
      if (!noncey && script.sources.some((x) => !x.startsWith("'"))) add("info", script.from as string, "An allowlist of hosts is hard to keep safe; a nonce-based policy with 'strict-dynamic' is more robust.");
    } else if (script.sources.some((x) => !x.startsWith("'") || x === "'self'")) add("info", script.from as string, "With 'strict-dynamic', host sources and 'self' are ignored by modern browsers (kept only as a fallback for old ones).");
  }

  const object = effective(policy, "object-src");
  if (!object.sources) add("high", "object-src", "No object-src (or default-src): <object> and <embed> can load plugins that run script. Add object-src 'none'.");
  else if (!lower(object.sources).includes("'none'")) add("medium", object.from as string, `object-src allows ${object.sources.join(" ")}; set it to 'none' unless you need plugins.`);

  if (!policy.directives.has("base-uri")) add(hasNonceOrHash(script.sources ?? []) ? "high" : "medium", "base-uri", "No base-uri: an injected <base href> redirects every relative script URL to the attacker's server, even with nonces. Add base-uri 'none' (or 'self').");
  if (!policy.directives.has("frame-ancestors")) add("low", "frame-ancestors", "No frame-ancestors: any site can frame this page (clickjacking) unless X-Frame-Options is set. Add frame-ancestors 'none' or 'self'.");
  if (!policy.directives.has("form-action")) add("info", "form-action", "No form-action: an injected <form> can post data anywhere. Add form-action 'self'.");
  if (!policy.directives.has("report-uri") && !policy.directives.has("report-to")) add("info", "report-to", "No reporting: violations happen silently. Add report-to (and report-uri for Firefox).");

  const style = effective(policy, "style-src");
  if (style.sources && lower(style.sources).includes("'unsafe-inline'") && !hasNonceOrHash(style.sources)) add("low", style.from as string, "style 'unsafe-inline' lets injected CSS restyle the page and, with attribute selectors, read values out of it.");
  if (policy.reportOnly) add("info", "", "This is a Report-Only policy: violations are reported but nothing is blocked.");
  const order: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function grade(findings: Finding[]): "A" | "B" | "C" | "D" | "F" {
  const high = findings.filter((f) => f.severity === "high").length;
  const medium = findings.filter((f) => f.severity === "medium").length;
  if (high >= 2) return "F";
  if (high === 1) return "D";
  if (medium >= 2) return "C";
  if (medium === 1) return "B";
  return "A";
}

// ---------------------------------------------------------------- matching

export type ResourceKind = "script" | "inline-script" | "event-handler" | "eval" | "style" | "inline-style" | "img" | "font" | "connect" | "media" | "object" | "frame" | "worker" | "manifest" | "form-action" | "frame-ancestor" | "base";

export interface Resource {
  kind: ResourceKind;
  /** URL for fetches; null for inline content and eval. */
  url: string | null;
  /** Nonce attribute on an inline or external script/style. */
  nonce?: string;
  /** sha256/384/512 of the inline content, base64, as `sha256-…`. */
  hash?: string;
  /** Loaded by a script that was itself trusted ('strict-dynamic'). */
  loadedByTrustedScript?: boolean;
}

const DIRECTIVE_FOR: Record<ResourceKind, string> = {
  script: "script-src-elem",
  "inline-script": "script-src-elem",
  "event-handler": "script-src-attr",
  eval: "script-src",
  style: "style-src-elem",
  "inline-style": "style-src-elem",
  img: "img-src",
  font: "font-src",
  connect: "connect-src",
  media: "media-src",
  object: "object-src",
  frame: "frame-src",
  worker: "worker-src",
  manifest: "manifest-src",
  "form-action": "form-action",
  "frame-ancestor": "frame-ancestors",
  base: "base-uri",
};

interface ParsedUrl {
  scheme: string;
  host: string;
  port: string;
  path: string;
}

function parseUrl(u: string): ParsedUrl | null {
  const m = /^([a-z][a-z0-9+.-]*):(?:\/\/([^/?#:]*)(?::(\d+))?)?([^?#]*)/i.exec(u);
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  const port = m[3] ?? (scheme === "https" || scheme === "wss" ? "443" : scheme === "http" || scheme === "ws" ? "80" : "");
  return { scheme, host: (m[2] ?? "").toLowerCase(), port, path: m[4] || "/" };
}

/** CSP3 "does url match source expression": scheme, host (with *.), port and path, with http→https and ws→wss upgrades. */
export function sourceMatches(src: string, url: string, page: string): boolean {
  const u = parseUrl(url);
  const p = parseUrl(page);
  if (!u || !p) return false;
  const s = src.toLowerCase();
  const schemeOk = (want: string) => u.scheme === want || (want === "http" && u.scheme === "https") || (want === "ws" && (u.scheme === "wss" || u.scheme === "https" || u.scheme === "http")) || (want === "wss" && u.scheme === "https");
  if (s === "*") return !/^(data|blob|filesystem)$/.test(u.scheme);
  if (s === "'self'") return (u.scheme === p.scheme || (p.scheme === "http" && u.scheme === "https") || (u.scheme === "wss" && p.scheme === "https") || (u.scheme === "ws" && p.scheme === "http")) && u.host === p.host && (u.port === p.port || (p.scheme === "http" && u.scheme === "https" && u.port === "443"));
  if (/^[a-z][a-z0-9+.-]*:$/.test(s)) return schemeOk(s.slice(0, -1));
  const m = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*|(?:\*\.)?[a-z0-9.-]+)(?::(\d+|\*))?(\/[^?#]*)?$/.exec(s);
  if (!m) return false;
  const [, scheme, host, port, path] = m;
  if (scheme ? !schemeOk(scheme) : !(u.scheme === p.scheme || (p.scheme === "http" && u.scheme === "https"))) return false;
  if (host === "*") {
    /* any host */
  } else if (host.startsWith("*.")) {
    if (!u.host.endsWith(host.slice(1))) return false;
  } else if (u.host !== host) return false;
  if (port === "*") {
    /* any port */
  } else if (port) {
    if (u.port !== port && !(port === "80" && u.port === "443" && u.scheme === "https")) return false;
  } else {
    const defaultPort = (scheme ?? u.scheme) === "https" || (scheme ?? u.scheme) === "wss" ? "443" : "80";
    if (u.port !== defaultPort && !(defaultPort === "80" && u.port === "443")) return false;
  }
  if (path && path !== "/") {
    const up = decodeURIComponent(u.path);
    if (path.endsWith("/") ? !up.startsWith(path) : up !== path) return false;
  }
  return true;
}

export interface Decision {
  allowed: boolean;
  directive: string | null;
  /** The source that allowed it, or why it was blocked. */
  reason: string;
}

/** Whether `res` loads on `page` under one policy. Several policies: every one must allow it. */
export function allows(policy: Policy, res: Resource, page: string): Decision {
  const name = DIRECTIVE_FOR[res.kind];
  const eff = name in FALLBACK ? effective(policy, name) : { from: policy.directives.has(name) ? name : null, sources: policy.directives.get(name) ?? null };
  if (!eff.sources) return { allowed: true, directive: null, reason: `no ${name}${name in FALLBACK ? " or fallback" : ""} directive` };
  const src = eff.sources;
  const l = lower(src);
  const dir = eff.from;
  const isScript = res.kind === "script" || res.kind === "inline-script" || res.kind === "event-handler" || res.kind === "eval";
  const strict = isScript && l.includes("'strict-dynamic'");
  const noncey = hasNonceOrHash(src);
  if (res.kind === "eval") {
    if (l.includes("'unsafe-eval'")) return { allowed: true, directive: dir, reason: "'unsafe-eval'" };
    return { allowed: false, directive: dir, reason: "no 'unsafe-eval'" };
  }
  if (res.nonce && src.some((s) => s === `'nonce-${res.nonce}'`) && res.kind !== "event-handler") return { allowed: true, directive: dir, reason: `'nonce-${res.nonce}'` };
  if (res.hash && src.some((s) => s.toLowerCase() === `'${res.hash?.toLowerCase()}'`) && (res.kind !== "event-handler" || l.includes("'unsafe-hashes'"))) return { allowed: true, directive: dir, reason: `'${res.hash}'` };
  if (res.kind === "inline-script" || res.kind === "inline-style" || res.kind === "event-handler") {
    if (l.includes("'unsafe-inline'") && !noncey && !strict) return { allowed: true, directive: dir, reason: "'unsafe-inline'" };
    return { allowed: false, directive: dir, reason: l.includes("'unsafe-inline'") ? "'unsafe-inline' is ignored because the policy has a nonce, hash or 'strict-dynamic'" : "inline content needs a matching nonce or hash" };
  }
  if (strict) {
    if (res.loadedByTrustedScript && res.kind === "script") return { allowed: true, directive: dir, reason: "'strict-dynamic' (loaded by a trusted script)" };
    return { allowed: false, directive: dir, reason: "'strict-dynamic' ignores host sources; the script needs a nonce or hash, or to be loaded by a trusted script" };
  }
  if (l.includes("'none'") && src.length === 1) return { allowed: false, directive: dir, reason: "'none'" };
  if (!res.url) return { allowed: false, directive: dir, reason: "no URL" };
  const hit = src.find((s) => !(/^'/.test(s) && s.toLowerCase() !== "'self'") && sourceMatches(s, res.url as string, page));
  if (hit) return { allowed: true, directive: dir, reason: hit };
  return { allowed: false, directive: dir, reason: `no source in ${dir} matches` };
}

/** A strict, nonce-based starting policy (Google's recommended shape). */
export function strictTemplate(withReporting: string | null): string {
  return [
    "script-src 'nonce-{RANDOM}' 'strict-dynamic' https: 'unsafe-inline'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    ...(withReporting ? [`report-uri ${withReporting}`] : []),
  ].join("; ");
}
