// Pure parsers behind the SSH, Docker, ports and recording palette tools.

// ── ~/.ssh/config ─────────────────────────────────────────────────────────

export interface SshHost {
  alias: string;
  hostName: string | null;
  user: string | null;
  port: string | null;
}

/** Concrete Host aliases (wildcards and negations skipped), in file order. */
export function parseSshConfig(text: string): SshHost[] {
  const hosts: SshHost[] = [];
  let current: SshHost[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = /^([A-Za-z]+)\s*(?:=\s*|\s+)(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim().replace(/^"(.*)"$/, "$1");
    if (key === "host") {
      current = value
        .split(/\s+/)
        .filter((a) => a && !/[*?!]/.test(a))
        .map((alias) => ({ alias, hostName: null, user: null, port: null }));
      hosts.push(...current);
    } else if (key === "match") {
      current = [];
    } else {
      for (const h of current) {
        if (key === "hostname") h.hostName ??= value;
        else if (key === "user") h.user ??= value;
        else if (key === "port") h.port ??= value;
      }
    }
  }
  const seen = new Set<string>();
  return hosts.filter((h) => !seen.has(h.alias) && seen.add(h.alias));
}

/** Include directives, resolved relative to ~/.ssh. */
export function sshIncludes(text: string, sshDir: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*include\s+(.+)$/i.exec(raw.replace(/#.*$/, ""));
    if (!m) continue;
    for (const p of m[1].trim().split(/\s+/)) {
      if (/[*?]/.test(p)) continue; // globs need a directory listing; skipped
      out.push(p.startsWith("~/") ? `${sshDir.replace(/\/\.ssh\/?$/, "")}/${p.slice(2)}` : p.startsWith("/") ? p : `${sshDir}/${p}`);
    }
  }
  return out;
}

// ── docker ps ─────────────────────────────────────────────────────────────

export interface Container {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
}

/** `docker ps -a --format '{{json .}}'` output (one JSON object per line). */
export function parseDockerPs(out: string): Container[] {
  const list: Container[] = [];
  for (const line of out.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const o = JSON.parse(t) as Record<string, string>;
      list.push({
        id: o.ID ?? "",
        name: o.Names ?? o.Name ?? "",
        image: o.Image ?? "",
        state: (o.State ?? "").toLowerCase() || (/^up/i.test(o.Status ?? "") ? "running" : "exited"),
        status: o.Status ?? "",
        ports: o.Ports ?? "",
      });
    } catch {
      /* skip malformed lines */
    }
  }
  // Running first, then by name.
  return list.sort((a, b) => Number(b.state === "running") - Number(a.state === "running") || a.name.localeCompare(b.name));
}

// ── listening ports ───────────────────────────────────────────────────────

export interface ListeningPort {
  port: number;
  address: string;
  pid: number | null;
  process: string | null;
}

function splitAddr(addr: string): { address: string; port: number } | null {
  const m = /^(.*)[:.](\d+)$/.exec(addr.trim());
  if (!m) return null;
  return { address: m[1].replace(/^\[|\]$/g, "") || "*", port: Number(m[2]) };
}

function dedupe(ports: ListeningPort[]): ListeningPort[] {
  const seen = new Map<string, ListeningPort>();
  for (const p of ports) {
    const key = `${p.port}:${p.pid ?? ""}`;
    if (!seen.has(key)) seen.set(key, p);
  }
  return [...seen.values()].sort((a, b) => a.port - b.port);
}

/** Linux `ss -ltnpH`. */
export function parseSs(out: string): ListeningPort[] {
  const ports: ListeningPort[] = [];
  for (const line of out.split("\n")) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4 || !/LISTEN/i.test(cols[0])) continue;
    const local = splitAddr(cols[3]);
    if (!local) continue;
    const users = /users:\(\("([^"]+)",pid=(\d+)/.exec(line);
    ports.push({ ...local, process: users?.[1] ?? null, pid: users ? Number(users[2]) : null });
  }
  return dedupe(ports);
}

/** macOS/Linux `lsof -nP -iTCP -sTCP:LISTEN`. */
export function parseLsof(out: string): ListeningPort[] {
  const ports: ListeningPort[] = [];
  for (const line of out.split("\n")) {
    if (!/\(LISTEN\)/.test(line)) continue;
    const cols = line.trim().split(/\s+/);
    const name = cols[cols.length - 2];
    const local = splitAddr(name);
    if (!local) continue;
    ports.push({ ...local, process: cols[0].replace(/\\x20/g, " "), pid: Number(cols[1]) || null });
  }
  return dedupe(ports);
}

/** Windows `netstat -ano -p tcp` (+ optional `tasklist /fo csv /nh` for names). */
export function parseNetstat(out: string, tasklistCsv = ""): ListeningPort[] {
  const names = new Map<number, string>();
  for (const line of tasklistCsv.split(/\r?\n/)) {
    const m = /^"([^"]+)","(\d+)"/.exec(line.trim());
    if (m) names.set(Number(m[2]), m[1]);
  }
  const ports: ListeningPort[] = [];
  for (const line of out.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5 || !/^TCP/i.test(cols[0]) || !/LISTEN/i.test(cols[3])) continue;
    const local = splitAddr(cols[1]);
    if (!local) continue;
    const pid = Number(cols[4]) || null;
    ports.push({ ...local, pid, process: pid ? (names.get(pid) ?? null) : null });
  }
  return dedupe(ports);
}

// ── asciinema v2 recording ────────────────────────────────────────────────

/** Builds an asciicast v2 file (https://docs.asciinema.org/manual/asciicast/v2/). */
export class AsciicastRecorder {
  private events: string[] = [];
  private readonly decoder = new TextDecoder("utf-8");
  private lastResize = "";

  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly startedAt: number,
    private readonly title?: string,
  ) {}

  output(bytes: Uint8Array | string, now: number): void {
    const text = typeof bytes === "string" ? bytes : this.decoder.decode(bytes, { stream: true });
    if (!text) return;
    this.events.push(JSON.stringify([this.elapsed(now), "o", text]));
  }

  resize(cols: number, rows: number, now: number): void {
    const size = `${cols}x${rows}`;
    if (size === this.lastResize) return;
    this.lastResize = size;
    this.events.push(JSON.stringify([this.elapsed(now), "r", size]));
  }

  marker(label: string, now: number): void {
    this.events.push(JSON.stringify([this.elapsed(now), "m", label]));
  }

  get eventCount(): number {
    return this.events.length;
  }

  private elapsed(now: number): number {
    return Math.max(0, Math.round(now - this.startedAt)) / 1000;
  }

  toString(): string {
    const header: Record<string, unknown> = {
      version: 2,
      width: this.width,
      height: this.height,
      timestamp: Math.floor(this.startedAt / 1000),
      env: { TERM: "xterm-256color" },
    };
    if (this.title) header.title = this.title;
    return [JSON.stringify(header), ...this.events].join("\n") + "\n";
  }
}
