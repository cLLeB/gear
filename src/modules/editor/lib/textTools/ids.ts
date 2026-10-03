// Identifier generators (UUID v4/v7, ULID, NanoID) and timestamp conversion
// between Unix epochs and ISO-8601 — the everyday "DevUtils" set.

type RandomFill = (bytes: Uint8Array) => Uint8Array;
const defaultFill: RandomFill = (b) => crypto.getRandomValues(b);

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

function formatUuid(b: Uint8Array): string {
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function uuidV4(fill: RandomFill = defaultFill): string {
  const b = fill(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  return formatUuid(b);
}

/** RFC 9562 UUIDv7: 48-bit Unix ms timestamp, then random bits. Sortable by time. */
export function uuidV7(now = Date.now(), fill: RandomFill = defaultFill): string {
  const b = fill(new Uint8Array(16));
  let t = now;
  for (let i = 5; i >= 0; i--) {
    b[i] = t % 256;
    t = Math.floor(t / 256);
  }
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  return formatUuid(b);
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** ULID: 10 chars of ms timestamp + 16 chars of randomness, Crockford base32. */
export function ulid(now = Date.now(), fill: RandomFill = defaultFill): string {
  let t = now;
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const rand = fill(new Uint8Array(16));
  let r = "";
  for (let i = 0; i < 16; i++) r += CROCKFORD[rand[i] % 32];
  return time + r;
}

export function ulidTime(id: string): number | null {
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(id)) return null;
  let t = 0;
  for (const c of id.slice(0, 10).toUpperCase()) t = t * 32 + CROCKFORD.indexOf(c);
  return t;
}

const NANO_ALPHABET = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";

export function nanoid(size = 21, fill: RandomFill = defaultFill): string {
  const bytes = fill(new Uint8Array(size));
  let id = "";
  for (let i = 0; i < size; i++) id += NANO_ALPHABET[bytes[i] & 63];
  return id;
}

/** Interpret a number as a Unix timestamp in s, ms, µs or ns by magnitude. */
export function epochToDate(value: string): { date: Date; unit: "s" | "ms" | "us" | "ns" } | null {
  const t = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  const abs = Math.abs(n);
  const [ms, unit] =
    abs < 1e11 ? [n * 1000, "s" as const] : abs < 1e14 ? [n, "ms" as const] : abs < 1e17 ? [n / 1000, "us" as const] : [n / 1e6, "ns" as const];
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : { date, unit };
}

/** ISO-8601 (or RFC 2822) date text → epoch seconds, or null. */
export function dateToEpoch(text: string): number | null {
  const t = text.trim();
  if (!/\d{4}|\d{1,2} \w{3} \d{4}/.test(t)) return null;
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? null : ms / 1000;
}

/** Toggle a timestamp: epoch → ISO, ISO → epoch (keeping the unit style). */
export function convertTimestamp(text: string): string | null {
  const asEpoch = epochToDate(text);
  if (asEpoch) return asEpoch.date.toISOString();
  const secs = dateToEpoch(text);
  if (secs === null) return null;
  return Number.isInteger(secs) ? String(secs) : String(Math.round(secs * 1000));
}
