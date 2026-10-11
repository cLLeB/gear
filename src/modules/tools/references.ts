// Offline references and explainers: regular expressions, HTTP status codes,
// process exit codes / signals, plus an HS256 JWT builder for testing.

// ── regex explainer ───────────────────────────────────────────────────────

export interface RegexPart {
  token: string;
  meaning: string;
  depth: number;
}

const ESCAPES: Record<string, string> = {
  d: "a digit (0-9)", D: "a non-digit", w: "a word character (letter, digit, _)", W: "a non-word character",
  s: "whitespace", S: "non-whitespace", b: "a word boundary", B: "not a word boundary", n: "a newline", r: "a carriage return",
  t: "a tab", "0": "a NUL character", A: "the start of input", z: "the end of input", Z: "the end of input (before a final newline)",
};

function quantifier(q: string): string {
  const lazy = q.endsWith("?") && q.length > 1 ? " (as few as possible)" : q.endsWith("+") && q.length > 1 ? " (possessive)" : "";
  const core = lazy ? q.slice(0, -1) : q;
  if (core === "*") return `zero or more times${lazy}`;
  if (core === "+") return `one or more times${lazy}`;
  if (core === "?") return `optionally${lazy}`;
  const m = /^\{(\d+)(,(\d*))?\}$/.exec(core);
  if (!m) return core;
  if (!m[2]) return `exactly ${m[1]} times`;
  if (!m[3]) return `${m[1]} or more times${lazy}`;
  return `between ${m[1]} and ${m[3]} times${lazy}`;
}

function describeClass(body: string): string {
  const neg = body.startsWith("^");
  const inner = neg ? body.slice(1) : body;
  const items: string[] = [];
  for (let i = 0; i < inner.length; i++) {
    let c = inner[i];
    if (c === "\\") {
      c = inner[++i];
      items.push(ESCAPES[c] ?? `"${c}"`);
    } else if (inner[i + 1] === "-" && i + 2 < inner.length) {
      items.push(`${c}–${inner[i + 2]}`);
      i += 2;
    } else items.push(`"${c}"`);
  }
  return `${neg ? "any character except" : "one of"} ${items.join(", ")}`;
}

/** Break a JS/PCRE-style pattern into tokens with plain-English meanings. */
export function explainRegex(pattern: string): RegexPart[] {
  const src = pattern.replace(/^\/(.*)\/([a-z]*)$/s, "$1");
  const out: RegexPart[] = [];
  let depth = 0;
  let group = 0;
  for (let i = 0; i < src.length; ) {
    const c = src[i];
    let token = c;
    let meaning: string;
    if (c === "\\") {
      const n = src[i + 1] ?? "";
      token = `\\${n}`;
      if (/[1-9]/.test(n)) meaning = `the same text as group ${n}`;
      else if (n === "k" && src[i + 2] === "<") {
        const end = src.indexOf(">", i);
        token = src.slice(i, end + 1);
        meaning = `the same text as group "${token.slice(3, -1)}"`;
      } else if (n === "u" && /^[0-9a-f]{4}/i.test(src.slice(i + 2))) {
        token = src.slice(i, i + 6);
        meaning = `the character U+${token.slice(2).toUpperCase()}`;
      } else if (n === "x" && /^[0-9a-f]{2}/i.test(src.slice(i + 2))) {
        token = src.slice(i, i + 4);
        meaning = `the character 0x${token.slice(2).toUpperCase()}`;
      } else if (n === "p" || n === "P") {
        const end = src.indexOf("}", i);
        token = src.slice(i, end + 1);
        meaning = `${n === "P" ? "not " : ""}a character with Unicode property ${token.slice(3, -1)}`;
      } else meaning = ESCAPES[n] ?? `a literal "${n}"`;
    } else if (c === "[") {
      let j = i + 1;
      if (src[j] === "^") j++;
      if (src[j] === "]") j++;
      while (j < src.length && src[j] !== "]") j += src[j] === "\\" ? 2 : 1;
      token = src.slice(i, j + 1);
      meaning = describeClass(token.slice(1, -1));
    } else if (c === "(") {
      const look = /^\(\?(<=|<!|=|!|:|<([A-Za-z_]\w*)>|P<([A-Za-z_]\w*)>)/.exec(src.slice(i));
      token = look ? look[0] : "(";
      if (!look) meaning = `start of capture group ${++group}`;
      else if (look[2] || look[3]) meaning = `start of capture group ${++group} named "${look[2] ?? look[3]}"`;
      else
        meaning = {
          ":": "start of a non-capturing group",
          "=": "start of a lookahead: followed by",
          "!": "start of a negative lookahead: not followed by",
          "<=": "start of a lookbehind: preceded by",
          "<!": "start of a negative lookbehind: not preceded by",
        }[look[1]]!;
      out.push({ token, meaning, depth });
      depth++;
      i += token.length;
      continue;
    } else if (c === ")") {
      depth = Math.max(0, depth - 1);
      meaning = "end of group";
    } else if (c === "|") meaning = "or";
    else if (c === "^") meaning = "start of line/input";
    else if (c === "$") meaning = "end of line/input";
    else if (c === ".") meaning = "any character (except newline)";
    else if (/[*+?{]/.test(c)) {
      const q = /^(\*|\+|\?|\{\d+(,\d*)?\})[?+]?/.exec(src.slice(i));
      token = q ? q[0] : c;
      meaning = q ? `…repeated ${quantifier(token)}` : `a literal "${c}"`;
    } else {
      // Merge a run of literal characters.
      const lit = /^[^\\[\](){}|^$.*+?]+/.exec(src.slice(i))![0];
      // Leave the last char separate when a quantifier follows, so it binds correctly.
      token = lit.length > 1 && /[*+?{]/.test(src[i + lit.length] ?? "") ? lit.slice(0, -1) : lit;
      meaning = token.length === 1 ? `the character "${token}"` : `the text "${token}"`;
    }
    out.push({ token, meaning, depth });
    i += token.length;
  }
  return out;
}

// ── HTTP status codes ─────────────────────────────────────────────────────

export const HTTP_STATUS: Record<number, [string, string]> = {
  100: ["Continue", "Send the request body."], 101: ["Switching Protocols", "Upgrading, e.g. to WebSocket."],
  200: ["OK", "Success."], 201: ["Created", "A resource was created; see Location."], 202: ["Accepted", "Queued for processing."],
  204: ["No Content", "Success with an empty body."], 206: ["Partial Content", "A Range request was served."],
  301: ["Moved Permanently", "Update links; may change POST to GET."], 302: ["Found", "Temporary redirect."],
  303: ["See Other", "Fetch the result with GET."], 304: ["Not Modified", "Use your cached copy."],
  307: ["Temporary Redirect", "Retry at Location with the same method."], 308: ["Permanent Redirect", "Like 301 but keeps the method."],
  400: ["Bad Request", "Malformed request or invalid input."], 401: ["Unauthorized", "Missing or invalid credentials."],
  402: ["Payment Required", "Reserved; used by some billing APIs."], 403: ["Forbidden", "Authenticated but not allowed."],
  404: ["Not Found", "No resource at this URL."], 405: ["Method Not Allowed", "See the Allow header."],
  406: ["Not Acceptable", "Can't satisfy the Accept header."], 408: ["Request Timeout", "The client was too slow."],
  409: ["Conflict", "State conflict, e.g. a version mismatch."], 410: ["Gone", "Removed permanently."],
  411: ["Length Required", "Send Content-Length."], 412: ["Precondition Failed", "If-Match / If-Unmodified-Since failed."],
  413: ["Content Too Large", "The body exceeds the limit."], 414: ["URI Too Long", "Shorten the URL / use POST."],
  415: ["Unsupported Media Type", "Wrong Content-Type."], 416: ["Range Not Satisfiable", "The Range is outside the file."],
  418: ["I'm a teapot", "RFC 2324 joke."], 422: ["Unprocessable Content", "Valid syntax, semantic validation failed."],
  425: ["Too Early", "Replay risk with 0-RTT."], 426: ["Upgrade Required", "Switch protocol (see Upgrade)."],
  428: ["Precondition Required", "Send If-Match to avoid lost updates."], 429: ["Too Many Requests", "Rate limited; see Retry-After."],
  431: ["Request Header Fields Too Large", "Trim cookies / headers."], 451: ["Unavailable For Legal Reasons", "Blocked for legal reasons."],
  500: ["Internal Server Error", "Unhandled server error."], 501: ["Not Implemented", "The server doesn't support this."],
  502: ["Bad Gateway", "The upstream sent an invalid response."], 503: ["Service Unavailable", "Overloaded or down; see Retry-After."],
  504: ["Gateway Timeout", "The upstream didn't answer in time."], 505: ["HTTP Version Not Supported", "Use another HTTP version."],
  507: ["Insufficient Storage", "WebDAV: no space."], 511: ["Network Authentication Required", "Captive portal login."],
};

// ── exit codes and signals ────────────────────────────────────────────────

const SIGNALS: Record<number, [string, string]> = {
  1: ["SIGHUP", "terminal closed / hang-up"], 2: ["SIGINT", "interrupted (Ctrl+C)"], 3: ["SIGQUIT", "quit (Ctrl+\\), core dump"],
  4: ["SIGILL", "illegal instruction"], 5: ["SIGTRAP", "breakpoint / trace trap"], 6: ["SIGABRT", "aborted (abort(), failed assert)"],
  7: ["SIGBUS", "bus error (bad memory access)"], 8: ["SIGFPE", "arithmetic error (e.g. divide by zero)"], 9: ["SIGKILL", "killed (kill -9 or the OOM killer)"],
  10: ["SIGUSR1", "user signal 1"], 11: ["SIGSEGV", "segmentation fault (invalid memory access)"], 12: ["SIGUSR2", "user signal 2"],
  13: ["SIGPIPE", "wrote to a closed pipe (e.g. `| head`)"], 14: ["SIGALRM", "timer alarm"], 15: ["SIGTERM", "asked to terminate (kill, docker stop)"],
};

const EXIT_CODES: Record<number, string> = {
  0: "success",
  1: "general error",
  2: "misuse of a shell builtin / invalid arguments",
  64: "usage error (EX_USAGE)", 65: "bad input data (EX_DATAERR)", 66: "input file missing (EX_NOINPUT)", 69: "service unavailable (EX_UNAVAILABLE)",
  70: "internal software error (EX_SOFTWARE)", 73: "can't create output file (EX_CANTCREAT)", 74: "I/O error (EX_IOERR)", 75: "temporary failure, retry (EX_TEMPFAIL)",
  77: "permission denied (EX_NOPERM)", 78: "configuration error (EX_CONFIG)",
  124: "timed out (the `timeout` command)", 125: "`timeout`/`docker run` itself failed", 126: "found but not executable (permissions?)",
  127: "command not found (typo or not on PATH?)", 128: "invalid exit argument",
  255: "exit status out of range / SSH connection error",
};

const WINDOWS_CODES: Record<number, string> = {
  0xc0000005: "STATUS_ACCESS_VIOLATION (crash: invalid memory access)",
  0xc000013a: "STATUS_CONTROL_C_EXIT (closed with Ctrl+C)",
  0xc0000409: "STATUS_STACK_BUFFER_OVERRUN (fast-fail / security check)",
  0xc00000fd: "STATUS_STACK_OVERFLOW",
  0xc0000135: "STATUS_DLL_NOT_FOUND (missing DLL)",
  0xc0000142: "STATUS_DLL_INIT_FAILED",
  0x40010004: "DBG_TERMINATE_PROCESS (killed by Task Manager / taskkill)",
};

/** Plain-English meaning of an exit status. */
export function explainExitCode(code: number): string {
  if (code in EXIT_CODES) return EXIT_CODES[code];
  const u = code >>> 0;
  if (u in WINDOWS_CODES) return WINDOWS_CODES[u];
  if (code > 128 && code < 128 + 65) {
    const sig = SIGNALS[code - 128];
    return sig ? `killed by ${sig[0]}: ${sig[1]}` : `killed by signal ${code - 128}`;
  }
  if (code < 0) {
    const sig = SIGNALS[-code];
    if (sig) return `killed by ${sig[0]}: ${sig[1]}`;
  }
  return "program-specific failure (see its documentation or output)";
}

export function signalList(): { num: number; name: string; meaning: string }[] {
  return Object.entries(SIGNALS).map(([n, [name, meaning]]) => ({ num: Number(n), name, meaning }));
}

// ── JWT (HS256) ───────────────────────────────────────────────────────────

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = new TextEncoder();

/** Sign a test token with HMAC-SHA256. Not for production secrets. */
export async function signJwtHs256(payload: Record<string, unknown>, secret: string, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const header = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(enc.encode(JSON.stringify({ iat: now, ...payload })));
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${header}.${body}`)));
  return `${header}.${body}.${b64url(sig)}`;
}

export async function verifyJwtHs256(token: string, secret: string): Promise<boolean> {
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const sig = Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
  return crypto.subtle.verify("HMAC", key, sig, enc.encode(`${h}.${p}`));
}
