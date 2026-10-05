// Pure helpers for the third terminal set: columnar output → table, JSON
// blocks inside output, log-level classification, and shell snippets for
// retry-with-backoff, watch, per-folder loops, file transfer, tailing and
// serving a folder.

export type Shell = "posix" | "powershell";

// ── columnar output ───────────────────────────────────────────────────────

/**
 * Parse whitespace-aligned command output (ps, docker ps, kubectl get, ls -l,
 * Get-Process…) into rows. Column boundaries come from the header row: a
 * column starts where a header word starts after 2+ spaces (or one space when
 * every data row is blank at that position).
 */
export function parseColumnar(text: string): { header: string[]; rows: string[][] } | null {
  const lines = text
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !/^[-=\s+|]+$/.test(l));
  if (lines.length < 2) return null;
  const head = lines[0];
  const starts: number[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(head))) {
    const i = m.index;
    if (i === 0) {
      starts.push(0);
      continue;
    }
    const gap = head.slice(0, i).length - head.slice(0, i).trimEnd().length;
    // A single space separates multi-word headers ("CONTAINER ID") unless the column below is clear.
    const clear = lines.slice(1).every((l) => l[i - 1] === undefined || l[i - 1] === " ");
    if (gap >= 2 || clear) starts.push(i);
  }
  if (starts.length < 2) {
    // Fallback: split every line on runs of whitespace.
    const rows = lines.map((l) => l.trim().split(/\s+/));
    const n = rows[0].length;
    if (n < 2) return null;
    return { header: rows[0], rows: rows.slice(1).map((r) => [...r.slice(0, n - 1), r.slice(n - 1).join(" ")]) };
  }
  const cut = (l: string) =>
    starts.map((s, k) => {
      const end = k + 1 < starts.length ? starts[k + 1] : l.length;
      // Nudge the cut left when it lands mid-word in a data row.
      let a = s;
      while (a > 0 && l[a - 1] && l[a - 1] !== " " && k > 0) a--;
      let b = end;
      while (k + 1 < starts.length && b > 0 && l[b - 1] && l[b - 1] !== " " && l[b] && l[b] !== " ") b--;
      return l.slice(a, b).trim();
    });
  return { header: cut(head), rows: lines.slice(1).map(cut) };
}

export function rowsToCsv(header: string[], rows: string[][]): string {
  const q = (c: string) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
  return `${[header, ...rows].map((r) => r.map(q).join(",")).join("\n")}\n`;
}

export function rowsToJson(header: string[], rows: string[][]): string {
  const keys = header.map((h, i) => h.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `col${i + 1}`);
  return JSON.stringify(rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ""]))), null, 2);
}

// ── JSON in output ────────────────────────────────────────────────────────

/** Every top-level JSON object/array embedded in `text` (JSON lines included). */
export function extractJsonBlocks(text: string): unknown[] {
  const clean = text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
  const out: unknown[] = [];
  let i = 0;
  while (i < clean.length) {
    const c = clean[i];
    if (c !== "{" && c !== "[") {
      i++;
      continue;
    }
    let depth = 0;
    let inStr = false;
    let j = i;
    for (; j < clean.length; j++) {
      const d = clean[j];
      if (inStr) {
        if (d === "\\") j++;
        else if (d === '"') inStr = false;
      } else if (d === '"') inStr = true;
      else if (d === "{" || d === "[") depth++;
      else if (d === "}" || d === "]") {
        if (--depth === 0) break;
      }
    }
    const chunk = clean.slice(i, j + 1);
    try {
      const v = JSON.parse(chunk);
      if (typeof v === "object" && v !== null && (Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0)) {
        out.push(v);
        i = j + 1;
        continue;
      }
    } catch {
      /* not JSON — keep scanning from the next character */
    }
    i++;
  }
  return out;
}

// ── logs ──────────────────────────────────────────────────────────────────

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";
export const LOG_LEVELS: LogLevel[] = ["fatal", "error", "warn", "info", "debug", "trace"];

/** The log level a line declares, or null. Handles text, logfmt and JSON logs. */
export function logLevelOf(line: string): LogLevel | null {
  const json = /"(?:level|severity|lvl|log\.level)"\s*:\s*"?(\w+)"?/i.exec(line);
  const logfmt = /\b(?:level|lvl|severity)=(\w+)/i.exec(line);
  const word = /(?:^|[\s[(|:])(FATAL|PANIC|CRIT(?:ICAL)?|ERROR|ERR|E|WARN(?:ING)?|W|INFO|I|NOTICE|DEBUG|DBG|D|TRACE|VERBOSE|V)(?=[\s\]):|]|$)/.exec(line.replace(/\x1b\[[0-9;]*m/g, ""));
  const raw = (json?.[1] ?? logfmt?.[1] ?? word?.[1] ?? "").toLowerCase();
  if (!raw) {
    if (/\b(exception|traceback|panicked at|segmentation fault)\b/i.test(line)) return "error";
    return null;
  }
  if (/^(fatal|panic|crit|critical|emerg|alert)$/.test(raw) || raw === "50" || raw === "60") return "fatal";
  if (/^(error|err|e|severe)$/.test(raw)) return "error";
  if (/^(warn|warning|w)$/.test(raw) || raw === "40") return "warn";
  if (/^(info|i|notice|information)$/.test(raw) || raw === "30") return "info";
  if (/^(debug|dbg|d|fine)$/.test(raw) || raw === "20") return "debug";
  if (/^(trace|verbose|v|finest)$/.test(raw) || raw === "10") return "trace";
  return null;
}

/** Lines at or above `min` severity; continuation lines stay with their entry. */
export function filterLog(lines: string[], min: LogLevel): { line: string; index: number; level: LogLevel }[] {
  const rank = (l: LogLevel) => LOG_LEVELS.indexOf(l);
  const out: { line: string; index: number; level: LogLevel }[] = [];
  let current: LogLevel | null = null;
  lines.forEach((line, index) => {
    const lv = logLevelOf(line);
    if (lv) current = lv;
    else if (!/^\s+\S|^\s*at\s|^Caused by|^\s*File "/.test(line)) current = null;
    if (current && rank(current) <= rank(min)) out.push({ line, index, level: current });
  });
  return out;
}

export function logLevelCounts(lines: string[]): Record<LogLevel, number> {
  const c = Object.fromEntries(LOG_LEVELS.map((l) => [l, 0])) as Record<LogLevel, number>;
  for (const l of lines) {
    const lv = logLevelOf(l);
    if (lv) c[lv]++;
  }
  return c;
}

// ── shell snippets ────────────────────────────────────────────────────────

function sq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function psq(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** Re-run `cmd` until it succeeds, doubling the delay each time. */
export function retryCommand(cmd: string, attempts: number, delaySecs: number, shell: Shell): string {
  if (shell === "powershell") {
    return `$d=${delaySecs}; for ($i=1; $i -le ${attempts}; $i++) { ${cmd}; if ($?) { break }; if ($i -eq ${attempts}) { Write-Host "Gave up after ${attempts} attempts"; break }; Write-Host "Attempt $i failed - retrying in $d s"; Start-Sleep -Seconds $d; $d=$d*2 }`;
  }
  return `sh -c ${sq(`d=${delaySecs}; i=1; until ${cmd}; do if [ $i -ge ${attempts} ]; then echo "Gave up after ${attempts} attempts" >&2; exit 1; fi; echo "Attempt $i failed - retrying in \${d}s" >&2; sleep $d; d=$((d*2)); i=$((i+1)); done`)}`;
}

/** Re-run `cmd` every `secs` seconds with a clear screen and timestamp (like `watch`). */
export function watchCommand(cmd: string, secs: number, shell: Shell): string {
  if (shell === "powershell") return `while ($true) { Clear-Host; Write-Host "Every ${secs}s: ${cmd.replace(/"/g, '`"')}    $(Get-Date -Format T)"; Write-Host; ${cmd}; Start-Sleep -Seconds ${secs} }`;
  return `sh -c ${sq(`while true; do clear; printf 'Every %ss: %s    %s\\n\\n' ${secs} ${sq(cmd)} "$(date +%T)"; ${cmd}; sleep ${secs}; done`)}`;
}

/** Run `cmd` inside each folder, printing a header and a pass/fail summary. */
export function forEachDirCommand(dirs: string[], cmd: string, shell: Shell, stopOnError = false): string {
  if (shell === "powershell") {
    const list = dirs.map(psq).join(", ");
    return `$failed=@(); foreach ($d in @(${list})) { Write-Host "\`n=== $d ===" -ForegroundColor Cyan; Push-Location $d; ${cmd}; if ($LASTEXITCODE -ne 0) { $failed += $d${stopOnError ? "; Pop-Location; break" : ""} }; Pop-Location }; if ($failed.Count) { Write-Host "\`nFailed in: $($failed -join ', ')" -ForegroundColor Red } else { Write-Host "\`nAll ${dirs.length} succeeded" -ForegroundColor Green }`;
  }
  const list = dirs.map(sq).join(" ");
  return `sh -c ${sq(`failed=""; for d in ${list}; do printf '\\n\\033[36m=== %s ===\\033[0m\\n' "$d"; (cd "$d" && ${cmd}) || { failed="$failed $d"; ${stopOnError ? "break; " : ""}}; done; if [ -n "$failed" ]; then printf '\\n\\033[31mFailed in:%s\\033[0m\\n' "$failed"; exit 1; else printf '\\n\\033[32mAll ${dirs.length} succeeded\\033[0m\\n'; fi`)}`;
}

/** Folders that look like packages in a monorepo (relative manifest paths → dirs). */
export function packageDirs(manifests: string[]): string[] {
  return [...new Set(manifests.map((m) => m.replace(/\\/g, "/").replace(/\/?[^/]+$/, "") || "."))]
    .filter((d) => !/(^|\/)(node_modules|target|dist|build|vendor|\.venv)(\/|$)/.test(d))
    .sort((a, b) => (a === "." ? -1 : b === "." ? 1 : a.localeCompare(b)));
}

export interface Transfer {
  direction: "upload" | "download";
  host: string;
  local: string;
  remote: string;
  tool: "scp" | "rsync";
  recursive: boolean;
}

export function transferCommand(t: Transfer): string {
  const remote = `${t.host}:${t.remote.includes(" ") ? `"${t.remote}"` : t.remote}`;
  const local = /\s/.test(t.local) ? `"${t.local}"` : t.local;
  const [src, dst] = t.direction === "upload" ? [local, remote] : [remote, local];
  if (t.tool === "rsync") return `rsync -avz --progress${t.recursive ? "" : " --no-recursive"} ${src} ${dst}`;
  return `scp${t.recursive ? " -r" : ""} ${src} ${dst}`;
}

/** Follow a file's new lines. */
export function tailCommand(path: string, shell: Shell, lines = 100): string {
  return shell === "powershell" ? `Get-Content -Path ${psq(path)} -Tail ${lines} -Wait` : `tail -n ${lines} -F ${sq(path)}`;
}

/** A one-line static file server for `dir` on `port`, preferring what's installed. */
export function serveCommand(available: { python?: string; node?: boolean }, port: number): string | null {
  if (available.python) return `${available.python} -m http.server ${port}`;
  if (available.node) return `npx --yes http-server -p ${port} -c-1 .`;
  return null;
}

/** docker compose ps --format json output (one JSON per line, or an array). */
export function parseComposePs(out: string): { service: string; name: string; state: string; status: string; ports: string }[] {
  const items: Record<string, unknown>[] = [];
  const t = out.trim();
  if (!t) return [];
  if (t.startsWith("[")) items.push(...(JSON.parse(t) as Record<string, unknown>[]));
  else for (const l of t.split(/\r?\n/)) if (l.trim().startsWith("{")) items.push(JSON.parse(l));
  return items.map((i) => ({
    service: String(i.Service ?? i.service ?? ""),
    name: String(i.Name ?? i.name ?? ""),
    state: String(i.State ?? i.state ?? ""),
    status: String(i.Status ?? i.status ?? ""),
    ports:
      typeof i.Ports === "string"
        ? i.Ports
        : Array.isArray(i.Publishers)
          ? (i.Publishers as { PublishedPort?: number; TargetPort?: number }[]).filter((p) => p.PublishedPort).map((p) => `${p.PublishedPort}→${p.TargetPort}`).join(", ")
          : "",
  }));
}

/** Services declared in a compose file (top-level `services:` keys). */
export function composeServices(yaml: string): string[] {
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex((l) => /^services:\s*$/.test(l));
  if (start < 0) return [];
  const out: string[] = [];
  let indent = -1;
  for (const l of lines.slice(start + 1)) {
    if (!l.trim() || /^\s*#/.test(l)) continue;
    if (/^\S/.test(l)) break;
    const m = /^(\s+)([\w.-]+):/.exec(l);
    if (!m) continue;
    if (indent < 0) indent = m[1].length;
    if (m[1].length === indent) out.push(m[2]);
  }
  return out;
}

/** Markdown table for parsed rows. */
export function rowsToMarkdown(header: string[], rows: string[][]): string {
  const esc = (c: string) => c.replace(/\|/g, "\\|");
  const w = header.map((h, i) => Math.max(3, esc(h).length, ...rows.map((r) => esc(r[i] ?? "").length)));
  const line = (r: string[]) => `| ${w.map((n, i) => esc(r[i] ?? "").padEnd(n)).join(" | ")} |`;
  return [line(header), `| ${w.map((n) => "-".repeat(n)).join(" | ")} |`, ...rows.map(line)].join("\n");
}
