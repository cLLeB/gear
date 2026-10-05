// Convert a curl command (e.g. from a browser's "Copy as cURL") to code:
// JavaScript fetch, Python requests or PowerShell Invoke-RestMethod.

export interface CurlRequest {
  url: string;
  method: string;
  headers: [string, string][];
  body: string | null;
  /** -F fields; values starting with @ are files. */
  form: [string, string][];
  user: string | null;
  insecure: boolean;
  followRedirects: boolean;
}

/** POSIX-ish argv split with $'…' ANSI-C quotes and \ / ^ line continuations. */
export function splitCurlArgs(src: string): string[] {
  const line = src.replace(/\\\r?\n/g, " ").replace(/\^\r?\n/g, " ").replace(/`\r?\n/g, " ");
  const out: string[] = [];
  let cur = "";
  let has = false;
  const ansi: Record<string, string> = { n: "\n", t: "\t", r: "\r", "0": "\0", "\\": "\\", "'": "'", '"': '"' };
  for (let i = 0; i < line.length; ) {
    const c = line[i];
    if (c === "$" && line[i + 1] === "'") {
      has = true;
      i += 2;
      while (i < line.length && line[i] !== "'") {
        if (line[i] === "\\") {
          const n = line[i + 1];
          const hex = /^x([0-9a-fA-F]{2})/.exec(line.slice(i + 1));
          const uni = /^u([0-9a-fA-F]{4})/.exec(line.slice(i + 1));
          if (hex) {
            cur += String.fromCharCode(parseInt(hex[1], 16));
            i += 4;
          } else if (uni) {
            cur += String.fromCharCode(parseInt(uni[1], 16));
            i += 6;
          } else {
            cur += ansi[n] ?? n;
            i += 2;
          }
          continue;
        }
        cur += line[i++];
      }
      i++;
    } else if (c === "'") {
      has = true;
      i++;
      while (i < line.length && line[i] !== "'") cur += line[i++];
      i++;
    } else if (c === '"') {
      has = true;
      i++;
      while (i < line.length && line[i] !== '"') {
        if (line[i] === "\\" && /["\\$`]/.test(line[i + 1] ?? "")) {
          cur += line[i + 1];
          i += 2;
        } else cur += line[i++];
      }
      i++;
    } else if (c === "\\") {
      has = true;
      cur += line[i + 1] ?? "";
      i += 2;
    } else if (/\s/.test(c)) {
      if (has) out.push(cur);
      cur = "";
      has = false;
      i++;
    } else {
      has = true;
      cur += c;
      i++;
    }
  }
  if (has) out.push(cur);
  return out;
}

const VALUE_FLAGS = new Set([
  "-X", "--request", "-H", "--header", "-d", "--data", "--data-raw", "--data-binary", "--data-ascii",
  "--data-urlencode", "--json", "-u", "--user", "-F", "--form", "--form-string", "--url", "-A", "--user-agent",
  "-b", "--cookie", "-e", "--referer", "-o", "--output", "-m", "--max-time", "--connect-timeout", "-x", "--proxy",
  "-w", "--write-out", "--retry", "-c", "--cookie-jar", "--compressed-ssh", "-T", "--upload-file",
]);

export function parseCurl(command: string): CurlRequest {
  const args = splitCurlArgs(command.trim());
  if (!args.length || !/^curl(\.exe)?$/i.test(args[0].split(/[\\/]/).pop() ?? "")) throw new Error("Not a curl command");
  const req: CurlRequest = { url: "", method: "", headers: [], body: null, form: [], user: null, insecure: false, followRedirects: false };
  const data: string[] = [];
  let get = false;
  let json = false;
  for (let i = 1; i < args.length; i++) {
    let a = args[i];
    let v: string | undefined;
    const eq = /^(--[\w-]+)=(.*)$/s.exec(a);
    if (eq && VALUE_FLAGS.has(eq[1])) {
      a = eq[1];
      v = eq[2];
    } else if (/^-[A-Za-z]./.test(a) && VALUE_FLAGS.has(a.slice(0, 2))) {
      // -XPOST, -H'…'
      v = a.slice(2);
      a = a.slice(0, 2);
    }
    const take = () => v ?? args[++i] ?? "";
    switch (a) {
      case "-X":
      case "--request":
        req.method = take().toUpperCase();
        break;
      case "-H":
      case "--header": {
        const h = take();
        const idx = h.indexOf(":");
        if (idx > 0) req.headers.push([h.slice(0, idx).trim(), h.slice(idx + 1).trim()]);
        break;
      }
      case "-d":
      case "--data":
      case "--data-raw":
      case "--data-binary":
      case "--data-ascii":
        data.push(take());
        break;
      case "--data-urlencode": {
        const raw = take();
        const k = raw.indexOf("=");
        data.push(k > 0 ? `${raw.slice(0, k)}=${encodeURIComponent(raw.slice(k + 1))}` : encodeURIComponent(raw.replace(/^=/, "")));
        break;
      }
      case "--json":
        data.push(take());
        json = true;
        break;
      case "-F":
      case "--form":
      case "--form-string": {
        const f = take();
        const k = f.indexOf("=");
        if (k > 0) req.form.push([f.slice(0, k), f.slice(k + 1)]);
        break;
      }
      case "-u":
      case "--user":
        req.user = take();
        break;
      case "-A":
      case "--user-agent":
        req.headers.push(["User-Agent", take()]);
        break;
      case "-b":
      case "--cookie":
        req.headers.push(["Cookie", take()]);
        break;
      case "-e":
      case "--referer":
        req.headers.push(["Referer", take()]);
        break;
      case "--url":
        req.url = take();
        break;
      case "-G":
      case "--get":
        get = true;
        break;
      case "-k":
      case "--insecure":
        req.insecure = true;
        break;
      case "-L":
      case "--location":
        req.followRedirects = true;
        break;
      case "-I":
      case "--head":
        req.method = "HEAD";
        break;
      default:
        if (VALUE_FLAGS.has(a)) take();
        else if (!a.startsWith("-") && !req.url) req.url = a;
    }
  }
  if (!req.url) throw new Error("No URL in the curl command");
  if (!/^[a-z]+:\/\//i.test(req.url)) req.url = `http://${req.url}`;
  if (data.length) {
    const joined = data.join("&");
    if (get) req.url += (req.url.includes("?") ? "&" : "?") + joined;
    else req.body = joined;
  }
  if (json) {
    if (!req.headers.some(([k]) => /^content-type$/i.test(k))) req.headers.push(["Content-Type", "application/json"]);
    if (!req.headers.some(([k]) => /^accept$/i.test(k))) req.headers.push(["Accept", "application/json"]);
  }
  if (!req.method) req.method = req.body !== null || req.form.length ? "POST" : "GET";
  return req;
}

function jsonBody(req: CurlRequest): unknown | undefined {
  if (req.body === null) return undefined;
  const ct = req.headers.find(([k]) => /^content-type$/i.test(k))?.[1] ?? "";
  const looksJson = /json/i.test(ct) || /^\s*[[{]/.test(req.body);
  if (!looksJson) return undefined;
  try {
    return JSON.parse(req.body);
  } catch {
    return undefined;
  }
}

const js = (s: string) => JSON.stringify(s);

export function curlToFetch(req: CurlRequest): string {
  const lines: string[] = [];
  const headers = [...req.headers];
  if (req.user) headers.push(["Authorization", `Basic \${btoa(${js(req.user)})}`]);
  const opts: string[] = [];
  if (req.method !== "GET") opts.push(`  method: ${js(req.method)},`);
  if (headers.length) {
    opts.push("  headers: {");
    for (const [k, v] of headers) {
      const value = k === "Authorization" && req.user && v.startsWith("Basic ${") ? `\`${v}\`` : js(v);
      opts.push(`    ${js(k)}: ${value},`);
    }
    opts.push("  },");
  }
  if (req.form.length) {
    lines.push("const form = new FormData();");
    for (const [k, v] of req.form) {
      lines.push(
        v.startsWith("@")
          ? `form.append(${js(k)}, /* file: ${v.slice(1).replace(/\*\//g, "* /")} */ new Blob([]));`
          : `form.append(${js(k)}, ${js(v)});`,
      );
    }
    lines.push("");
    opts.push("  body: form,");
  } else if (req.body !== null) {
    const parsed = jsonBody(req);
    opts.push(
      parsed !== undefined
        ? `  body: JSON.stringify(${JSON.stringify(parsed, null, 2).replace(/\n/g, "\n  ")}),`
        : `  body: ${js(req.body)},`,
    );
  }
  lines.push(`const response = await fetch(${js(req.url)}${opts.length ? `, {\n${opts.join("\n")}\n}` : ""});`);
  lines.push("const data = await response.text();");
  return lines.join("\n") + "\n";
}

const py = (s: string) => JSON.stringify(s);

function pyLiteral(v: unknown, indent = ""): string {
  if (v === null) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number" || typeof v === "string") return JSON.stringify(v);
  const next = `${indent}    `;
  if (Array.isArray(v)) return v.length ? `[\n${v.map((x) => `${next}${pyLiteral(x, next)},`).join("\n")}\n${indent}]` : "[]";
  const entries = Object.entries(v as object);
  return entries.length ? `{\n${entries.map(([k, x]) => `${next}${JSON.stringify(k)}: ${pyLiteral(x, next)},`).join("\n")}\n${indent}}` : "{}";
}

export function curlToPython(req: CurlRequest): string {
  const lines = ["import requests", ""];
  const args = [py(req.url)];
  const parsed = jsonBody(req);
  const headers = req.headers.filter(([k]) => !(parsed !== undefined && /^content-type$/i.test(k)));
  if (headers.length) {
    lines.push("headers = {");
    for (const [k, v] of headers) lines.push(`    ${py(k)}: ${py(v)},`);
    lines.push("}");
    args.push("headers=headers");
  }
  if (req.form.length) {
    const files = req.form.filter(([, v]) => v.startsWith("@"));
    const fields = req.form.filter(([, v]) => !v.startsWith("@"));
    if (fields.length) {
      lines.push(`data = {${fields.map(([k, v]) => `${py(k)}: ${py(v)}`).join(", ")}}`);
      args.push("data=data");
    }
    if (files.length) {
      lines.push(`files = {${files.map(([k, v]) => `${py(k)}: open(${py(v.slice(1).replace(/;.*$/, ""))}, "rb")`).join(", ")}}`);
      args.push("files=files");
    }
  } else if (parsed !== undefined) {
    lines.push(`json_data = ${pyLiteral(parsed)}`);
    args.push("json=json_data");
  } else if (req.body !== null) {
    lines.push(`data = ${py(req.body)}`);
    args.push("data=data");
  }
  if (req.user) {
    const [u, p = ""] = req.user.split(/:(.*)/s);
    args.push(`auth=(${py(u)}, ${py(p)})`);
  }
  if (req.insecure) args.push("verify=False");
  if (!req.followRedirects) args.push("allow_redirects=False");
  if (lines[lines.length - 1] !== "") lines.push("");
  const known = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(req.method);
  const call = known ? `requests.${req.method.toLowerCase()}(` : `requests.request(${py(req.method)}, `;
  lines.push(`response = ${call}${args.join(", ")})`);
  lines.push("print(response.status_code, response.text)");
  return lines.join("\n") + "\n";
}

export function curlToPowerShell(req: CurlRequest): string {
  const ps = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const lines: string[] = [];
  const params = [`-Uri ${ps(req.url)}`, `-Method ${req.method}`];
  const headers = req.headers.filter(([k]) => !/^content-type$/i.test(k));
  const ct = req.headers.find(([k]) => /^content-type$/i.test(k))?.[1];
  if (req.user) headers.push(["Authorization", `Basic $([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(${ps(req.user)})))`]);
  if (headers.length) {
    lines.push("$headers = @{");
    for (const [k, v] of headers) lines.push(`    ${ps(k)} = ${k === "Authorization" && v.includes("$([Convert]") ? `"${v.replace(/"/g, '`"')}"` : ps(v)}`);
    lines.push("}");
    params.push("-Headers $headers");
  }
  if (ct) params.push(`-ContentType ${ps(ct)}`);
  if (req.form.length) {
    lines.push("$form = @{");
    for (const [k, v] of req.form) lines.push(`    ${ps(k)} = ${v.startsWith("@") ? `Get-Item ${ps(v.slice(1))}` : ps(v)}`);
    lines.push("}");
    params.push("-Form $form");
  } else if (req.body !== null) {
    lines.push(`$body = ${ps(req.body)}`);
    params.push("-Body $body");
  }
  if (req.insecure) params.push("-SkipCertificateCheck");
  if (!req.followRedirects) params.push("-MaximumRedirection 0");
  lines.push(`Invoke-RestMethod ${params.join(" ")}`);
  return lines.join("\n") + "\n";
}
