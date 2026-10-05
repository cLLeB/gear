// Developer calculators: CIDR/subnets, chmod, semver ranges, durations,
// time zones, CSS/unit conversion and secure password generation.

// ── CIDR ──────────────────────────────────────────────────────────────────

export interface CidrInfo {
  cidr: string;
  network: string;
  broadcast: string;
  netmask: string;
  wildcard: string;
  firstHost: string;
  lastHost: string;
  hosts: number;
  total: number;
  prefix: number;
  private: boolean;
}

const ipToInt = (ip: string): number => {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) throw new Error(`Invalid IPv4 address "${ip}"`);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
};
const intToIp = (n: number) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join(".");

/** "10.0.0.0/8", "192.168.1.10/24" or "192.168.1.10 255.255.255.0". */
export function cidrInfo(input: string): CidrInfo {
  const m = /^\s*([\d.]+)\s*(?:\/\s*(\d{1,2})|\s+([\d.]+))?\s*$/.exec(input);
  if (!m) throw new Error("Use a.b.c.d/prefix or a.b.c.d mask");
  const ip = ipToInt(m[1]);
  let prefix: number;
  if (m[3]) {
    const mask = ipToInt(m[3]);
    prefix = 32 - Math.log2((~mask >>> 0) + 1);
    if (!Number.isInteger(prefix)) throw new Error("The netmask is not contiguous");
  } else prefix = m[2] === undefined ? 32 : Number(m[2]);
  if (prefix < 0 || prefix > 32) throw new Error("Prefix must be 0–32");
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  const network = (ip & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const total = 2 ** (32 - prefix);
  const usable = prefix >= 31 ? total : total - 2;
  const first = prefix >= 31 ? network : network + 1;
  const last = prefix >= 31 ? broadcast : broadcast - 1;
  const inRange = (base: string, bits: number) => ((network & ((~0 << (32 - bits)) >>> 0)) >>> 0) === ipToInt(base);
  return {
    cidr: `${intToIp(network)}/${prefix}`,
    network: intToIp(network),
    broadcast: intToIp(broadcast),
    netmask: intToIp(mask),
    wildcard: intToIp(~mask >>> 0),
    firstHost: intToIp(first),
    lastHost: intToIp(last),
    hosts: usable,
    total,
    prefix,
    private: inRange("10.0.0.0", 8) || inRange("172.16.0.0", 12) || inRange("192.168.0.0", 16),
  };
}

/** Split a network into equal subnets of a longer prefix. */
export function splitSubnets(cidr: string, newPrefix: number, limit = 256): string[] {
  const info = cidrInfo(cidr);
  if (newPrefix < info.prefix || newPrefix > 32) throw new Error(`New prefix must be between ${info.prefix} and 32`);
  const step = 2 ** (32 - newPrefix);
  const count = Math.min(2 ** (newPrefix - info.prefix), limit);
  const base = ipToInt(info.network);
  return Array.from({ length: count }, (_, i) => `${intToIp(base + i * step)}/${newPrefix}`);
}

// ── chmod ─────────────────────────────────────────────────────────────────

export interface ChmodInfo {
  octal: string;
  symbolic: string;
  description: string[];
}

const WHO = ["Owner", "Group", "Others"];

/** "755", "0644", "rwxr-xr--", "-rw-r--r--", or "u=rwx,g=rx,o=" → all forms. */
export function chmodInfo(input: string): ChmodInfo {
  const s = input.trim();
  let bits: number[];
  let special = 0;
  if (/^[0-7]{3,4}$/.test(s)) {
    const d = s.padStart(4, "0").split("").map(Number);
    special = d[0];
    bits = d.slice(1);
  } else if (/^[-dlbcps]?[-r][-w][-xsS][-r][-w][-xsS][-r][-w][-xtT]$/.test(s)) {
    const p = s.length === 10 ? s.slice(1) : s;
    bits = [0, 1, 2].map((g) => {
      const t = p.slice(g * 3, g * 3 + 3);
      return (t[0] === "r" ? 4 : 0) + (t[1] === "w" ? 2 : 0) + (/[xst]/.test(t[2]) ? 1 : 0);
    });
    if (/[sS]/.test(p[2])) special |= 4;
    if (/[sS]/.test(p[5])) special |= 2;
    if (/[tT]/.test(p[8])) special |= 1;
  } else if (/^([ugoa]+=[rwx]*,?)+$/.test(s)) {
    bits = [0, 0, 0];
    for (const clause of s.split(",").filter(Boolean)) {
      const [who, perms] = clause.split("=");
      const v = (perms.includes("r") ? 4 : 0) + (perms.includes("w") ? 2 : 0) + (perms.includes("x") ? 1 : 0);
      for (const w of who.replace("a", "ugo")) bits["ugo".indexOf(w)] = v;
    }
  } else throw new Error("Use octal (755), symbolic (rwxr-xr-x) or u=rwx,g=rx,o=r");
  const sym = bits.map((b, g) => {
    let x = b & 1 ? "x" : "-";
    if (g === 0 && special & 4) x = b & 1 ? "s" : "S";
    if (g === 1 && special & 2) x = b & 1 ? "s" : "S";
    if (g === 2 && special & 1) x = b & 1 ? "t" : "T";
    return `${b & 4 ? "r" : "-"}${b & 2 ? "w" : "-"}${x}`;
  });
  const words = (b: number) => [b & 4 && "read", b & 2 && "write", b & 1 && "execute"].filter(Boolean).join(", ") || "nothing";
  const description = bits.map((b, g) => `${WHO[g]}: ${words(b)}`);
  if (special & 4) description.push("setuid: runs as the file's owner");
  if (special & 2) description.push("setgid: runs as the file's group / new files inherit the group");
  if (special & 1) description.push("sticky: only owners can delete their files in this directory");
  return { octal: `${special ? special : ""}${bits.join("")}`, symbolic: sym.join(""), description };
}

// ── semver ranges ─────────────────────────────────────────────────────────

function parseV(v: string): [number, number, number, string] | null {
  const m = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(-[\w.-]+)?$/.exec(v.trim());
  if (!m) return null;
  const n = (s?: string) => (s === undefined || /[xX*]/.test(s) ? -1 : Number(s));
  return [n(m[1]), n(m[2]), n(m[3]), m[4] ?? ""];
}

const fmt = (a: number, b: number, c: number, pre = "") => `${a}.${b}.${c}${pre}`;

function explainComparator(c: string): string {
  const s = c.trim();
  if (s === "" || s === "*" || s === "x" || s === "latest") return "any version";
  const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(s);
  if (hyphen) {
    const lo = parseV(hyphen[1]);
    const hi = parseV(hyphen[2]);
    if (!lo || !hi) throw new Error(`Bad range "${s}"`);
    const upper = hi[1] < 0 ? `<${hi[0] + 1}.0.0` : hi[2] < 0 ? `<${hi[0]}.${hi[1] + 1}.0` : `<=${fmt(hi[0], hi[1], hi[2], hi[3])}`;
    return `>=${fmt(Math.max(lo[0], 0), Math.max(lo[1], 0), Math.max(lo[2], 0), lo[3])} ${upper}`;
  }
  return s
    .split(/\s+/)
    .map((part) => {
      const m = /^(\^|~>?|>=|<=|>|<|=)?(.+)$/.exec(part)!;
      const op = m[1] ?? "";
      const v = parseV(m[2]);
      if (!v) throw new Error(`Bad version "${m[2]}"`);
      const [a, b, c, pre] = v;
      if (op === "^") {
        const B = Math.max(b, 0);
        const C = Math.max(c, 0);
        if (a > 0 || b < 0) return `>=${fmt(a, B, C, pre)} <${a + 1}.0.0`;
        if (b > 0 || c < 0) return `>=${fmt(0, B, C, pre)} <0.${B + 1}.0`;
        return `>=${fmt(0, 0, C, pre)} <0.0.${C + 1}`;
      }
      if (op.startsWith("~")) {
        if (b < 0) return `>=${a}.0.0 <${a + 1}.0.0`;
        return `>=${fmt(a, b, Math.max(c, 0), pre)} <${a}.${b + 1}.0`;
      }
      if (a < 0) return "any version";
      if (b < 0) return op ? `${op}${a}.0.0` : `>=${a}.0.0 <${a + 1}.0.0`;
      if (c < 0) return op ? `${op}${a}.${b}.0` : `>=${a}.${b}.0 <${a}.${b + 1}.0`;
      return `${op === "=" ? "" : op}${fmt(a, b, c, pre)}`;
    })
    .join(" ");
}

/** npm-style range → explicit comparator sets, e.g. "^1.2.3" → ">=1.2.3 <2.0.0". */
export function explainSemverRange(range: string): string[] {
  return range.split("||").map((r) => explainComparator(r));
}

function cmpV(a: [number, number, number, string], b: [number, number, number, string]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return (a[i] as number) - (b[i] as number);
  if (a[3] === b[3]) return 0;
  if (!a[3]) return 1;
  if (!b[3]) return -1;
  return a[3] < b[3] ? -1 : 1;
}

/** Does `version` fall in `range`? (Prereleases match only when the range names one.) */
export function semverSatisfies(version: string, range: string): boolean {
  const v = parseV(version);
  if (!v || v.slice(0, 3).some((n) => (n as number) < 0)) return false;
  return explainSemverRange(range).some((set) => {
    if (set === "any version") return !v[3];
    const parts = set.split(" ");
    // npm rule: a prerelease only matches a set naming a prerelease of the same x.y.z.
    const okPre =
      !v[3] ||
      parts.some((p) => {
        const t = parseV(p.replace(/^[<>=]+/, ""));
        return !!t && !!t[3] && t[0] === v[0] && t[1] === v[1] && t[2] === v[2];
      });
    if (!okPre) return false;
    return parts.every((p) => {
      const m = /^(>=|<=|>|<)?(.+)$/.exec(p)!;
      const t = parseV(m[2])!;
      const c = cmpV(v, t);
      switch (m[1]) {
        case ">=": return c >= 0;
        case "<=": return c <= 0;
        case ">": return c > 0;
        case "<": return c < 0;
        default: return c === 0;
      }
    });
  });
}

// ── durations and dates ───────────────────────────────────────────────────

const UNIT_MS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

/** "1h 30m", "90m", "2d4h", "1:30:00", "PT1H30M" → milliseconds. */
export function parseDuration(input: string): number {
  const s = input.trim();
  const clock = /^(\d+):(\d{1,2})(?::(\d{1,2}(?:\.\d+)?))?$/.exec(s);
  if (clock) return clock[3] !== undefined ? (Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3])) * 1000 : (Number(clock[1]) * 60 + Number(clock[2])) * 60_000;
  const iso = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?)?$/i.exec(s);
  if (iso && s.length > 1) return (Number(iso[1] ?? 0) * 7 * 86400 + Number(iso[2] ?? 0) * 86400 + Number(iso[3] ?? 0) * 3600 + Number(iso[4] ?? 0) * 60 + Number(iso[5] ?? 0)) * 1000;
  let total = 0;
  let matched = false;
  for (const m of s.matchAll(/([\d.]+)\s*(ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?|w|weeks?)(?![a-z])/gi)) {
    matched = true;
    const u = m[2].toLowerCase();
    const key = u === "ms" || u.startsWith("milli") ? "ms" : u[0] === "s" ? "s" : u[0] === "m" ? "m" : u[0];
    total += Number(m[1]) * UNIT_MS[key];
  }
  if (!matched) {
    if (/^\d+(\.\d+)?$/.test(s)) return Number(s) * 1000;
    throw new Error(`Can't read "${input}" as a duration`);
  }
  return total;
}

export function formatDuration(ms: number): string {
  const sign = ms < 0 ? "-" : "";
  let rest = Math.abs(ms);
  const parts: string[] = [];
  for (const [u, size] of [["d", 86_400_000], ["h", 3_600_000], ["m", 60_000], ["s", 1000]] as const) {
    const n = Math.floor(rest / size);
    if (n) parts.push(`${n}${u}`);
    rest -= n * size;
  }
  if (rest || !parts.length) parts.push(`${Math.round(rest)}ms`);
  return sign + parts.join(" ");
}

export function durationForms(ms: number): { label: string; value: string }[] {
  return [
    { label: "Readable", value: formatDuration(ms) },
    { label: "Milliseconds", value: String(ms) },
    { label: "Seconds", value: String(ms / 1000) },
    { label: "Minutes", value: String(+(ms / 60_000).toFixed(4)) },
    { label: "Hours", value: String(+(ms / 3_600_000).toFixed(4)) },
    { label: "ISO 8601", value: `PT${Math.floor(ms / 3_600_000)}H${Math.floor((ms % 3_600_000) / 60_000)}M${+((ms % 60_000) / 1000).toFixed(3)}S` },
    { label: "From now", value: new Date(Date.now() + ms).toISOString() },
  ];
}

/** Difference between two dates/times in several units. */
export function dateDiff(a: string, b: string): { label: string; value: string }[] {
  const da = new Date(a.trim());
  const db = new Date(b.trim());
  if (Number.isNaN(+da) || Number.isNaN(+db)) throw new Error("Use dates like 2024-03-01 or 2024-03-01T10:00");
  const ms = +db - +da;
  const days = ms / 86_400_000;
  let months = (db.getUTCFullYear() - da.getUTCFullYear()) * 12 + (db.getUTCMonth() - da.getUTCMonth());
  if (db.getUTCDate() < da.getUTCDate()) months--;
  let weekdays = 0;
  const step = ms >= 0 ? 1 : -1;
  for (let d = new Date(da); step > 0 ? d < db : d > db; d.setUTCDate(d.getUTCDate() + step)) if (d.getUTCDay() % 6 !== 0) weekdays++;
  return [
    { label: "Duration", value: formatDuration(ms) },
    { label: "Days", value: String(+days.toFixed(3)) },
    { label: "Weeks", value: String(+(days / 7).toFixed(3)) },
    { label: "Whole months", value: String(months) },
    { label: "Business days", value: String(weekdays * step) },
    { label: "Hours", value: String(+(ms / 3_600_000).toFixed(3)) },
  ];
}

// ── time zones ────────────────────────────────────────────────────────────

export const COMMON_ZONES = [
  "UTC", "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "America/Sao_Paulo",
  "Europe/London", "Europe/Berlin", "Europe/Paris", "Europe/Moscow", "Africa/Lagos", "Africa/Accra", "Africa/Nairobi",
  "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Shanghai", "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland",
];

/** One instant shown in many zones. */
export function worldTimes(instant: Date, zones: readonly string[] = COMMON_ZONES): { zone: string; time: string; offset: string }[] {
  return zones.map((zone) => {
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(instant);
    const offset =
      new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(instant).find((p) => p.type === "timeZoneName")?.value ?? "";
    return { zone, time, offset: offset.replace("GMT", "UTC") };
  });
}

/** "2024-05-01 09:00 America/New_York" or "09:00 Tokyo" → instant. */
export function parseZonedTime(input: string, now = new Date()): Date {
  const s = input.trim();
  if (!s || /^now$/i.test(s)) return now;
  const zoneMatch = /\s+([A-Za-z_]+(?:\/[A-Za-z_+-]+)*|UTC|GMT)$/.exec(s);
  let zone = "UTC";
  let rest = s;
  if (zoneMatch) {
    const z = zoneMatch[1];
    const found = z === "UTC" || z === "GMT" ? "UTC" : (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone").find((n) => n.toLowerCase() === z.toLowerCase() || n.toLowerCase().endsWith(`/${z.toLowerCase()}`));
    if (found) {
      zone = found;
      rest = s.slice(0, zoneMatch.index).trim();
    }
  }
  const m = /^(?:(\d{4})-(\d\d)-(\d\d))?\s*(\d{1,2}):(\d\d)(?::(\d\d))?\s*(am|pm)?$/i.exec(rest);
  if (!m) {
    const d = new Date(s);
    if (Number.isNaN(+d)) throw new Error(`Can't read "${input}"`);
    return d;
  }
  let hour = Number(m[4]);
  if (m[7]) hour = (hour % 12) + (m[7].toLowerCase() === "pm" ? 12 : 0);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const y = m[1] ? Number(m[1]) : get("year");
  const mo = m[2] ? Number(m[2]) : get("month");
  const d = m[3] ? Number(m[3]) : get("day");
  // Guess as UTC, then correct by the zone's offset at that moment.
  const guess = Date.UTC(y, mo - 1, d, hour, Number(m[5]), Number(m[6] ?? 0));
  const offsetAt = (t: number) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(t));
    const g = (k: string) => Number(p.find((x) => x.type === k)!.value);
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - t;
  };
  return new Date(guess - offsetAt(guess - offsetAt(guess)));
}

// ── units ─────────────────────────────────────────────────────────────────

const LENGTH: Record<string, number> = { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344 };
const MASS: Record<string, number> = { mg: 1e-6, g: 0.001, kg: 1, t: 1000, oz: 0.028349523125, lb: 0.45359237 };
const BYTES: Record<string, number> = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 };
const VOLUME: Record<string, number> = { ml: 0.001, l: 1, gal: 3.785411784, qt: 0.946352946, cup: 0.2365882365, floz: 0.0295735295625 };
const SPEED: Record<string, number> = { "m/s": 1, "km/h": 1 / 3.6, mph: 0.44704, kn: 0.514444 };

/** "16px" (base 16), "1.5rem", "72f", "5 km", "1.5GiB", "60 mph" → equivalents. */
export function convertUnits(input: string, remBase = 16): { label: string; value: string }[] {
  const m = /^\s*(-?[\d.]+)\s*([a-zA-Z/°%]+)\s*$/.exec(input);
  if (!m) throw new Error('Use a number and unit, e.g. "24px", "100f", "5km", "2GiB"');
  const n = Number(m[1]);
  const u = m[2].toLowerCase().replace("°", "");
  const round = (x: number) => String(+x.toFixed(6));
  if (u === "px") return [{ label: "rem", value: `${round(n / remBase)}rem` }, { label: "em", value: `${round(n / remBase)}em` }, { label: "pt", value: `${round(n * 0.75)}pt` }];
  if (u === "rem" || u === "em") return [{ label: "px", value: `${round(n * remBase)}px` }, { label: "pt", value: `${round(n * remBase * 0.75)}pt` }];
  if (u === "pt") return [{ label: "px", value: `${round(n / 0.75)}px` }, { label: "rem", value: `${round(n / 0.75 / remBase)}rem` }];
  if (u === "c") return [{ label: "°F", value: `${round((n * 9) / 5 + 32)}°F` }, { label: "K", value: `${round(n + 273.15)}K` }];
  if (u === "f") return [{ label: "°C", value: `${round(((n - 32) * 5) / 9)}°C` }, { label: "K", value: `${round(((n - 32) * 5) / 9 + 273.15)}K` }];
  if (u === "k") return [{ label: "°C", value: `${round(n - 273.15)}°C` }, { label: "°F", value: `${round(((n - 273.15) * 9) / 5 + 32)}°F` }];
  for (const table of [LENGTH, MASS, BYTES, VOLUME, SPEED]) {
    if (u in table) {
      const base = n * table[u];
      return Object.entries(table)
        .filter(([k]) => k !== u)
        .map(([k, f]) => ({ label: k, value: `${round(base / f)} ${k}` }));
    }
  }
  throw new Error(`Unknown unit "${m[2]}"`);
}

// ── passwords ─────────────────────────────────────────────────────────────

export interface PasswordOptions {
  length: number;
  upper: boolean;
  lower: boolean;
  digits: boolean;
  symbols: boolean;
  /** Drop look-alikes such as 0/O and 1/l/I. */
  unambiguous: boolean;
}

const SETS = {
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  lower: "abcdefghijklmnopqrstuvwxyz",
  digits: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{};:,.?/~",
};

function randomInt(max: number, rand: (n: number) => Uint32Array): number {
  // Rejection sampling avoids modulo bias.
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  for (;;) {
    const [x] = rand(1);
    if (x < limit) return x % max;
  }
}

const cryptoRand = (n: number) => crypto.getRandomValues(new Uint32Array(n));

/** Cryptographically random password with at least one character from each chosen set. */
export function generatePassword(o: PasswordOptions, rand = cryptoRand): string {
  const clean = (s: string) => (o.unambiguous ? s.replace(/[0O1lI|`'"]/g, "") : s);
  const sets = (Object.keys(SETS) as (keyof typeof SETS)[]).filter((k) => o[k]).map((k) => clean(SETS[k]));
  if (!sets.length) throw new Error("Pick at least one character set");
  const length = Math.max(o.length, sets.length);
  const all = sets.join("");
  const chars = sets.map((s) => s[randomInt(s.length, rand)]);
  while (chars.length < length) chars.push(all[randomInt(all.length, rand)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1, rand);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

const WORDS = "able acid aged also area army away baby back ball band bank base bath bear beat bell belt best bird blow blue boat body bone book born both bowl bulk burn bush busy cake calm came camp card care cart case cash cast cell chat chip city clay club coal coat code cold come cook cool cope copy core corn cost crew crop dark data date dawn deal dear deep deny desk dial diet disk dock door dose down draw drop drum dual duke dust duty each earn ease east easy edge else even ever exit face fact fair fall farm fast fate fear feed feel file fill film find fine fire firm fish five flag flat flow food foot ford form fort four free from fuel full fund gain game gate gear gift girl give glad goal gold golf good gray grew grid grow gulf hair half hall hand hang hard harm head heat held help herb hero high hill hint hold hole holy home hope horn host hour huge hunt idea inch into iron item jazz join jump jury just keen keep kept kick kind king kite knee knew know lack lady lake lamp land lane last late lawn lead leaf lean left lens life lift like lime line link lion list live load loan lock loft logo long look loop lord lose loss loud love luck lung made mail main make mall many mark mask mass meal meat meet melt menu mild mile milk mind mine mint miss mode mood moon more most move much must name navy near neat neck need nest news next nice nine node noon norm nose note oaks odds okay once only open oval oven over pace pack page paid pain pair palm park part pass past path peak pick pile pine pink pipe plan play plot plug plus poem poet pole pond pool port pose post pour pure push race rail rain rank rare rate read real rear rely rent rest rice rich ride ring rise risk road rock role roll roof room root rope rose ruby rule rush safe sage sail salt same sand save seal seat seed seek self sell send ship shoe shop shot show side sign silk sing site size skin slow snow soft soil sold sole song soon sort soul spot star stay stem step stop such suit sure swim tail take tale talk tall tank tape task team tech tell tend tent term test text than that them then they thin this tide tile time tiny tone tool tour town tree trip true tube tune turn twin type unit upon used user vast very view vote wage wait wake walk wall want warm wash wave weak wear week well west what when whip wide wife wild will wind wine wing wire wise wish wood word wore work yard yarn year yoga zero zone".split(" ");

/** Diceware-style passphrase from a 600-word list (~9.2 bits per word). */
export function generatePassphrase(words = 5, separator = "-", rand = cryptoRand): string {
  return Array.from({ length: words }, () => WORDS[randomInt(WORDS.length, rand)]).join(separator);
}

export function passwordEntropyBits(o: PasswordOptions): number {
  const clean = (s: string) => (o.unambiguous ? s.replace(/[0O1lI|`'"]/g, "") : s);
  const pool = (Object.keys(SETS) as (keyof typeof SETS)[]).filter((k) => o[k]).reduce((n, k) => n + clean(SETS[k]).length, 0);
  return Math.round(o.length * Math.log2(Math.max(pool, 1)));
}

export const PASSPHRASE_BITS_PER_WORD = Math.log2(WORDS.length);
