// .http / .rest request files (VS Code REST Client / JetBrains HTTP Client
// format): find the request under the cursor and turn it into a curl command.
//
//   @host = https://api.example.com
//   ### List users
//   GET {{host}}/users?page=1
//   Authorization: Bearer {{token}}
//
//   ###
//   POST {{host}}/users
//   Content-Type: application/json
//
//   {"name": "Ada"}

export interface HttpRequest {
  name: string | null;
  method: string;
  url: string;
  headers: [string, string][];
  body: string | null;
}

const METHODS = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)\s+(\S+)(\s+HTTP\/[\d.]+)?\s*$/i;

/** File-level `@name = value` variables (later ones may reference earlier ones). */
export function parseVariables(text: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*@([\w.-]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) vars[m[1]] = substitute(m[2], vars);
  }
  return vars;
}

export function substitute(s: string, vars: Record<string, string>): string {
  return s.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (all, name: string) => vars[name] ?? all);
}

/** The request block containing `offset` (blocks are separated by ### lines). */
export function requestAt(text: string, offset: number): HttpRequest | null {
  const lines = text.split("\n");
  let pos = 0;
  let cursorLine = 0;
  for (let i = 0; i < lines.length; i++) {
    if (offset <= pos + lines[i].length) {
      cursorLine = i;
      break;
    }
    pos += lines[i].length + 1;
    cursorLine = i;
  }
  let start = cursorLine;
  while (start > 0 && !/^###/.test(lines[start])) start--;
  let end = cursorLine + 1;
  while (end < lines.length && !/^###/.test(lines[end])) end++;
  const name = /^###\s*(.*)$/.exec(lines[start])?.[1]?.trim() || null;
  const block = lines.slice(/^###/.test(lines[start]) ? start + 1 : start, end);
  return parseBlock(block, name, parseVariables(text));
}

function parseBlock(block: string[], name: string | null, vars: Record<string, string>): HttpRequest | null {
  let i = 0;
  // Skip blank lines, comments and variable definitions before the request line.
  while (i < block.length && (/^\s*$/.test(block[i]) || /^\s*(#|\/\/)/.test(block[i]) || /^\s*@[\w.-]+\s*=/.test(block[i]))) {
    const named = /^\s*(?:#|\/\/)\s*@name\s+(.+)$/.exec(block[i]);
    if (named) name = named[1].trim();
    i++;
  }
  if (i >= block.length) return null;
  const first = substitute(block[i].trim(), vars);
  const m = METHODS.exec(first);
  const method = m ? m[1].toUpperCase() : "GET";
  let url = m ? m[2] : first.split(/\s+/)[0];
  i++;
  // Query continuation lines: "    ?a=1" / "    &b=2"
  while (i < block.length && /^\s+[?&]/.test(block[i])) url += substitute(block[i].trim(), vars), i++;
  const headers: [string, string][] = [];
  while (i < block.length && block[i].trim() !== "") {
    const line = block[i];
    if (!/^\s*(#|\/\/)/.test(line)) {
      const h = /^([^:\s][^:]*):\s*(.*)$/.exec(line.trim());
      if (h) headers.push([h[1].trim(), substitute(h[2].trim(), vars)]);
    }
    i++;
  }
  let bodyLines = block.slice(i + 1);
  // Response handler scripts ("> {% … %}") aren't part of the body.
  const handler = bodyLines.findIndex((l) => /^>\s*\{%/.test(l));
  if (handler >= 0) bodyLines = bodyLines.slice(0, handler);
  while (bodyLines.length && bodyLines[bodyLines.length - 1].trim() === "") bodyLines.pop();
  const body = bodyLines.join("\n");
  return { name, method, url, headers, body: body.trim() ? substitute(body, vars) : null };
}

function shq(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/** A POSIX-shell curl command; -i shows status and headers. */
export function toCurl(req: HttpRequest): string {
  const parts = ["curl", "-sS", "-i"];
  if (req.method !== "GET" || req.body !== null) parts.push("-X", req.method);
  parts.push(shq(req.url));
  for (const [k, v] of req.headers) parts.push("-H", shq(`${k}: ${v}`));
  if (req.body !== null) parts.push("--data-binary", shq(req.body));
  return parts.join(" ");
}

/** PowerShell's curl alias is Invoke-WebRequest; call curl.exe with PS quoting. */
export function toCurlPowerShell(req: HttpRequest): string {
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const parts = ["curl.exe", "-sS", "-i"];
  if (req.method !== "GET" || req.body !== null) parts.push("-X", req.method);
  parts.push(q(req.url));
  for (const [k, v] of req.headers) parts.push("-H", q(`${k}: ${v}`));
  if (req.body !== null) parts.push("--data-binary", q(req.body.replace(/"/g, '\\"')));
  return parts.join(" ");
}
