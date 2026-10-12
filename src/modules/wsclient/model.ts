// WebSocket client: checking the address, keeping the message log and
// working out reconnect delays.

export type Direction = "in" | "out" | "info" | "error";

export interface Entry {
  id: number;
  at: number;
  dir: Direction;
  text: string;
  /** Size on the wire in bytes (UTF-8 for text frames). */
  bytes: number;
  binary: boolean;
}

/** A normalised ws:// or wss:// address, or the reason it cannot be used. */
export function checkUrl(input: string): { url: string } | { error: string } {
  let text = input.trim();
  if (!text) return { error: "Enter an address, e.g. ws://localhost:8080" };
  if (/^https?:\/\//i.test(text)) text = text.replace(/^http/i, "ws");
  else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `${/^(localhost|127\.|\[::1\])/i.test(text) ? "ws" : "wss"}://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { error: "That is not a valid address." };
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") return { error: "The address must start with ws:// or wss://" };
  if (url.hash) return { error: "A WebSocket address cannot contain a # fragment." };
  return { url: url.toString() };
}

/** Sub-protocols from "graphql-ws, json": trimmed, de-duplicated, tokens only. */
export function parseProtocols(text: string): { protocols: string[] } | { error: string } {
  const list = [...new Set(text.split(",").map((s) => s.trim()).filter(Boolean))];
  const bad = list.find((p) => !/^[!#$%&'*+\-.^_`|~0-9a-z]+$/i.test(p));
  return bad ? { error: `"${bad}" is not a valid sub-protocol name.` } : { protocols: list };
}

export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Appends to the log, dropping the oldest entries beyond `cap`. */
export function append(log: Entry[], entry: Omit<Entry, "id">, cap = 2000): Entry[] {
  const id = (log[log.length - 1]?.id ?? 0) + 1;
  const next = [...log, { ...entry, id }];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/** Pretty JSON when the text is JSON, otherwise null. */
export function prettyJson(text: string): string | null {
  const t = text.trim();
  if (!t || !/^[[{"]|^(true|false|null|-?\d)/.test(t)) return null;
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return null;
  }
}

/** Seconds to wait before reconnect attempt number `attempt` (1-based): 1, 2, 4 … capped at 30. */
export function backoff(attempt: number): number {
  return Math.min(30, 2 ** Math.max(0, attempt - 1));
}

export interface Totals {
  sent: number;
  received: number;
  bytesOut: number;
  bytesIn: number;
}

export function totals(log: Entry[]): Totals {
  const t: Totals = { sent: 0, received: 0, bytesOut: 0, bytesIn: 0 };
  for (const e of log) {
    if (e.dir === "out") {
      t.sent++;
      t.bytesOut += e.bytes;
    } else if (e.dir === "in") {
      t.received++;
      t.bytesIn += e.bytes;
    }
  }
  return t;
}

export function filterLog(log: Entry[], query: string, show: { in: boolean; out: boolean; info: boolean }): Entry[] {
  const q = query.trim().toLowerCase();
  return log.filter((e) => {
    if (e.dir === "in" && !show.in) return false;
    if (e.dir === "out" && !show.out) return false;
    if ((e.dir === "info" || e.dir === "error") && !show.info) return false;
    return !q || e.text.toLowerCase().includes(q);
  });
}

const CLOSE_CODES: Record<number, string> = {
  1000: "normal closure",
  1001: "the other side went away",
  1002: "protocol error",
  1003: "unsupported data",
  1005: "no status given",
  1006: "connection lost (no close frame)",
  1007: "invalid message data",
  1008: "policy violation",
  1009: "message too big",
  1010: "missing extension",
  1011: "server error",
  1012: "service restart",
  1013: "try again later",
  1015: "TLS handshake failed",
};

export function describeClose(code: number, reason: string): string {
  const meaning = CLOSE_CODES[code] ?? (code >= 4000 ? "application-defined" : "unknown");
  return `Closed: ${code} (${meaning})${reason ? ` — ${reason}` : ""}`;
}

export function hexPreview(bytes: Uint8Array, max = 64): string {
  const shown = [...bytes.subarray(0, max)].map((b) => b.toString(16).padStart(2, "0")).join(" ");
  return bytes.length > max ? `${shown} … (${bytes.length} bytes)` : shown;
}

/** The log as text for the clipboard. */
export function exportLog(log: Entry[]): string {
  const arrow: Record<Direction, string> = { in: "<<", out: ">>", info: "--", error: "!!" };
  return log.map((e) => `${new Date(e.at).toISOString()} ${arrow[e.dir]} ${e.text}`).join("\n");
}

/** Most-recently-used list: newest first, no duplicates, at most `max`. */
export function remember(list: string[], item: string, max = 12): string[] {
  return [item, ...list.filter((x) => x !== item)].slice(0, max);
}
