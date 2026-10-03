// Recognise "a server is now listening" lines from dev servers and frameworks
// (Vite, Next, CRA, Astro, Rails, Django, Flask, uvicorn, Phoenix, Go, …) and
// return a browsable URL — VS Code's port forwarding prompt, but local: offer
// to open it in Gear's preview tab.

export interface DetectedServer {
  url: string;
  port: number;
}

const URL_RE = /\bhttps?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::(\d{2,5}))?(\/[^\s'"<>)]*)?/gi;
// "listening on port 3000", "Listening on :8080", "server started on port 4000"
const PORT_PHRASE_RE =
  /\b(?:listening|running|started|serving|server(?:\s+is)?\s+(?:up|running|started)|available)\b[^\n]{0,40}?\b(?:on|at)\b\s*(?:port\s*)?:?(\d{2,5})\b/i;

function normalizeUrl(scheme: string, host: string, port: string | undefined, path: string | undefined): string {
  // 0.0.0.0 / [::] are bind addresses, not something a browser should open.
  const h = /^(0\.0\.0\.0|\[::\])$/.test(host) ? "localhost" : host;
  const p = port ? `:${port}` : "";
  return `${scheme}://${h}${p}${path && path !== "/" ? path.replace(/[.,;]+$/, "") : "/"}`;
}

export function detectServer(line: string): DetectedServer | null {
  URL_RE.lastIndex = 0;
  const m = URL_RE.exec(line);
  if (m) {
    const scheme = m[0].toLowerCase().startsWith("https") ? "https" : "http";
    const port = m[2] ? +m[2] : scheme === "https" ? 443 : 80;
    if (port < 1 || port > 65535) return null;
    // Skip lines that merely mention a URL in passing, like "proxy error to …".
    if (/\b(error|failed|refused|ECONNREFUSED|proxy)\b/i.test(line)) return null;
    return { url: normalizeUrl(scheme, m[1].toLowerCase(), m[2], m[3]), port };
  }
  const phrase = PORT_PHRASE_RE.exec(line);
  if (phrase) {
    const port = +phrase[1];
    if (port < 80 || port > 65535) return null;
    if (/\b(error|failed|in use|EADDRINUSE)\b/i.test(line)) return null;
    return { url: `http://localhost:${port}/`, port };
  }
  return null;
}

/** Remembers which servers were already announced per pane. */
export class ServerAnnouncer {
  private seen = new Map<number, Set<number>>();

  /** True the first time `port` is seen for `leafId`. */
  firstSighting(leafId: number, port: number): boolean {
    let set = this.seen.get(leafId);
    if (!set) {
      set = new Set();
      this.seen.set(leafId, set);
    }
    if (set.has(port)) return false;
    set.add(port);
    return true;
  }

  /** A command finished: its servers are gone, announce again next time. */
  reset(leafId: number): void {
    this.seen.delete(leafId);
  }
}
