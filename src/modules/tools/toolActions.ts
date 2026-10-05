// "Tools" palette group: calculators and references that don't need an open
// file. Each asks for input, shows results in a quick pick, and copies the
// picked value.

import { toast } from "sonner";
import { getActiveEditor } from "@/modules/editor/lib/activeEditor";
import { inputBox, quickPick } from "@/modules/quick-pick";
import { writeTerminalClipboard } from "@/modules/terminal/lib/terminalClipboard";
import {
  chmodInfo,
  cidrInfo,
  convertUnits,
  dateDiff,
  durationForms,
  explainSemverRange,
  generatePassphrase,
  generatePassword,
  parseDuration,
  parseZonedTime,
  PASSPHRASE_BITS_PER_WORD,
  passwordEntropyBits,
  semverSatisfies,
  splitSubnets,
  worldTimes,
  COMMON_ZONES,
  type PasswordOptions,
} from "./calculators";
import { explainExitCode, explainRegex, HTTP_STATUS, signalList, signJwtHs256 } from "./references";

type Row = { label: string; description?: string; detail?: string; value: string };

async function results(title: string, rows: Row[], placeholder = "Pick a value to copy"): Promise<void> {
  const pick = await quickPick(rows.map((r) => ({ ...r, value: r.value })), { title, placeholder });
  if (pick) {
    await writeTerminalClipboard(pick);
    toast.success("Copied", { description: pick.length > 100 ? `${pick.slice(0, 100)}…` : pick });
  }
}

function fail(e: unknown): void {
  toast.error(e instanceof Error ? e.message : String(e));
}

function selectionText(): string {
  const ed = getActiveEditor();
  if (!ed) return "";
  const sel = ed.view.state.selection.main;
  return sel.empty ? "" : ed.view.state.sliceDoc(sel.from, sel.to).trim();
}

export async function cidrTool(): Promise<void> {
  const input = await inputBox({ title: "Subnet calculator", placeholder: "192.168.1.0/24, or 10.0.0.5 255.255.0.0", value: selectionText() });
  if (!input) return;
  try {
    const i = cidrInfo(input);
    const rows: Row[] = [
      { label: i.cidr, description: "network" },
      { label: i.netmask, description: "netmask" },
      { label: i.wildcard, description: "wildcard (ACLs)" },
      { label: i.broadcast, description: "broadcast" },
      { label: `${i.firstHost} – ${i.lastHost}`, description: "usable hosts" },
      { label: i.hosts.toLocaleString(), description: `usable of ${i.total.toLocaleString()} addresses${i.private ? " · private range" : ""}` },
    ].map((r) => ({ ...r, value: r.label }));
    if (i.prefix < 32) rows.push({ label: "Split into smaller subnets…", value: "__split" });
    const pick = await quickPick(rows, { title: `Subnet ${i.cidr}`, placeholder: "Pick a value to copy" });
    if (pick === "__split") {
      const p = await inputBox({ title: `New prefix length (${i.prefix + 1}–32)`, value: String(Math.min(32, i.prefix + 2)) });
      if (!p) return;
      const subnets = splitSubnets(i.cidr, Number(p));
      return results(`${i.cidr} → /${p}`, subnets.map((s) => ({ label: s, value: s })));
    }
    if (pick) await writeTerminalClipboard(pick), toast.success("Copied", { description: pick });
  } catch (e) {
    fail(e);
  }
}

export async function chmodTool(): Promise<void> {
  const input = await inputBox({ title: "chmod calculator", placeholder: "755, rw-r--r--, or u=rwx,g=rx,o=" });
  if (!input) return;
  try {
    const c = chmodInfo(input);
    await results(`chmod ${c.octal}`, [
      { label: c.octal, description: "octal", value: c.octal },
      { label: c.symbolic, description: "symbolic", value: c.symbolic },
      { label: `chmod ${c.octal} <file>`, description: "command", value: `chmod ${c.octal} ` },
      ...c.description.map((d) => ({ label: d, value: d })),
    ]);
  } catch (e) {
    fail(e);
  }
}

export async function semverTool(): Promise<void> {
  const range = await inputBox({ title: "Semver range", placeholder: "^1.2.3, ~0.4, >=2 <3 || 4.x", value: selectionText().replace(/^["']|["']$/g, "") });
  if (!range) return;
  try {
    const sets = explainSemverRange(range);
    const test = await inputBox({ title: `${range} means ${sets.join(" OR ")}`, placeholder: "Optionally type a version to test (Esc to just copy)" });
    if (test) {
      const ok = semverSatisfies(test, range);
      toast[ok ? "success" : "warning"](`${test} ${ok ? "satisfies" : "does not satisfy"} ${range}`, { description: sets.join(" || ") });
      return;
    }
    await writeTerminalClipboard(sets.join(" || "));
    toast.success("Copied the expanded range", { description: sets.join(" || ") });
  } catch (e) {
    fail(e);
  }
}

export async function regexExplainTool(): Promise<void> {
  const pattern = await inputBox({ title: "Explain a regular expression", placeholder: "^(?<year>\\d{4})-\\d{2}$", value: selectionText() });
  if (!pattern) return;
  const parts = explainRegex(pattern);
  await results(
    `/${pattern.replace(/^\/(.*)\/[a-z]*$/s, "$1")}/`,
    parts.map((p) => ({ label: `${"  ".repeat(p.depth)}${p.token}`, description: p.meaning, value: p.token })),
    "Each token and what it matches",
  );
}

export async function durationTool(): Promise<void> {
  const input = await inputBox({ title: "Duration converter", placeholder: "1h 30m, 90min, 2d4h, 1:30:00, PT1H30M, 5400 (seconds)" });
  if (!input) return;
  try {
    await results(input, durationForms(parseDuration(input)).map((f) => ({ label: f.value, description: f.label, value: f.value })));
  } catch (e) {
    fail(e);
  }
}

export async function dateDiffTool(): Promise<void> {
  const a = await inputBox({ title: "From date", placeholder: "2024-01-01 or 2024-01-01T09:00", value: new Date().toISOString().slice(0, 10) });
  if (!a) return;
  const b = await inputBox({ title: "To date", placeholder: "2024-12-25" });
  if (!b) return;
  try {
    await results(`${a} → ${b}`, dateDiff(a, b).map((f) => ({ label: f.value, description: f.label, value: f.value })));
  } catch (e) {
    fail(e);
  }
}

export async function worldClockTool(): Promise<void> {
  const input = await inputBox({ title: "Time zone converter", placeholder: "now · 09:00 America/New_York · 2024-05-01 18:30 Tokyo · 3pm London", value: "now" });
  if (input === undefined) return;
  try {
    const instant = parseZonedTime(input);
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const zones = [local, ...COMMON_ZONES.filter((z) => z !== local)];
    await results(
      `${instant.toISOString()} (${input || "now"})`,
      worldTimes(instant, zones).map((r) => ({ label: r.time, description: `${r.zone}${r.zone === local ? " (you)" : ""} · ${r.offset}`, value: `${r.time} ${r.zone}` })),
    );
  } catch (e) {
    fail(e);
  }
}

export async function unitTool(): Promise<void> {
  const input = await inputBox({ title: "Unit converter", placeholder: "24px · 1.5rem · 72f · 20c · 5km · 2GiB · 60mph · 3lb", value: selectionText() });
  if (!input) return;
  try {
    await results(input, convertUnits(input).map((r) => ({ label: r.value, description: r.label, value: r.value })));
  } catch (e) {
    fail(e);
  }
}

export async function passwordTool(): Promise<void> {
  const kind = await quickPick<PasswordOptions | null | 7>(
    [
      { label: "Strong password (24, mixed)", value: { length: 24, upper: true, lower: true, digits: true, symbols: true, unambiguous: false } },
      { label: "Readable password (20, no look-alikes, no symbols)", value: { length: 20, upper: true, lower: true, digits: true, symbols: false, unambiguous: true } },
      { label: "API secret (48, letters & digits)", value: { length: 48, upper: true, lower: true, digits: true, symbols: false, unambiguous: false } },
      { label: "PIN (6 digits)", value: { length: 6, upper: false, lower: false, digits: true, symbols: false, unambiguous: false } },
      { label: "Passphrase (5 words)", value: null },
      { label: "Passphrase (7 words)", value: 7 as const },
    ],
    { title: "Generate a password (crypto-random, never leaves this machine)" },
  );
  if (kind === undefined) return;
  if (kind === null || kind === 7) {
    const words = kind === 7 ? 7 : 5;
    const list = Array.from({ length: 5 }, () => generatePassphrase(words));
    return results(`≈${Math.round(words * PASSPHRASE_BITS_PER_WORD)} bits of entropy each`, list.map((p) => ({ label: p, value: p })));
  }
  const list = Array.from({ length: 5 }, () => generatePassword(kind));
  await results(`≈${passwordEntropyBits(kind)} bits of entropy each`, list.map((p) => ({ label: p, value: p })));
}

export async function jwtBuilderTool(): Promise<void> {
  const claims = await inputBox({ title: "JWT payload (JSON)", value: '{"sub": "user-123", "role": "admin"}' });
  if (!claims) return;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(claims);
  } catch (e) {
    return fail(e);
  }
  const ttl = await inputBox({ title: "Expires in (e.g. 1h, 7d; empty for no exp)", value: "1h" });
  if (ttl === undefined) return;
  const secret = await inputBox({ title: "HMAC secret (HS256) — use test secrets only", value: "dev-secret" });
  if (!secret) return;
  try {
    const now = Math.floor(Date.now() / 1000);
    if (ttl.trim()) payload.exp = now + Math.round(parseDuration(ttl) / 1000);
    const token = await signJwtHs256(payload, secret, now);
    await writeTerminalClipboard(token);
    toast.success("Signed test JWT copied", { description: `${token.slice(0, 60)}…` });
  } catch (e) {
    fail(e);
  }
}

export async function httpStatusTool(): Promise<void> {
  await results(
    "HTTP status codes",
    Object.entries(HTTP_STATUS).map(([code, [name, note]]) => ({ label: `${code} ${name}`, description: note, value: `${code} ${name}` })),
    "Type a code or a word (e.g. 'rate', 'redirect')",
  );
}

export async function exitCodeTool(): Promise<void> {
  const input = await inputBox({ title: "Explain an exit code", placeholder: "127, 137, 0xC0000005, -1073741819 — empty for the signal list" });
  if (input === undefined) return;
  if (!input.trim()) {
    return results("Unix signals (exit code = 128 + number)", signalList().map((s) => ({ label: `${s.num} ${s.name}`, description: `exit ${128 + s.num} · ${s.meaning}`, value: s.name })));
  }
  const code = input.trim().toLowerCase().startsWith("0x") ? parseInt(input, 16) | 0 : Number(input);
  if (!Number.isFinite(code)) return fail(new Error("Not a number"));
  toast.info(`Exit ${input.trim()}`, { description: explainExitCode(code), duration: 10_000 });
}

export const TOOL_ACTIONS = [
  { id: "tools.cidr", label: "Tools: Subnet / CIDR calculator…", keywords: ["cidr", "subnet", "netmask", "ip", "network", "ipv4"], run: cidrTool },
  { id: "tools.chmod", label: "Tools: chmod calculator…", keywords: ["chmod", "permissions", "octal", "unix", "rwx"], run: chmodTool },
  { id: "tools.semver", label: "Tools: Explain / test a semver range…", keywords: ["semver", "version", "range", "caret", "tilde", "npm"], run: semverTool },
  { id: "tools.regex", label: "Tools: Explain a regular expression…", keywords: ["regex", "regexp", "explain", "pattern"], run: regexExplainTool },
  { id: "tools.duration", label: "Tools: Duration converter…", keywords: ["duration", "time", "seconds", "minutes", "iso 8601"], run: durationTool },
  { id: "tools.dateDiff", label: "Tools: Days between dates…", keywords: ["date", "difference", "days", "business days", "calendar"], run: dateDiffTool },
  { id: "tools.worldClock", label: "Tools: Time zone converter / world clock…", keywords: ["timezone", "time zone", "world clock", "utc", "convert time", "meeting"], run: worldClockTool },
  { id: "tools.units", label: "Tools: Unit converter (px/rem, °C/°F, bytes, km/mi)…", keywords: ["units", "px", "rem", "celsius", "fahrenheit", "bytes", "convert"], run: unitTool },
  { id: "tools.password", label: "Tools: Generate password / passphrase…", keywords: ["password", "passphrase", "random", "secret", "pin", "generate"], run: passwordTool },
  { id: "tools.jwt", label: "Tools: Build a signed test JWT (HS256)…", keywords: ["jwt", "token", "sign", "hs256", "auth", "bearer"], run: jwtBuilderTool },
  { id: "tools.httpStatus", label: "Tools: HTTP status codes", keywords: ["http", "status", "404", "500", "reference"], run: httpStatusTool },
  { id: "tools.exitCode", label: "Tools: Explain an exit code / signal…", keywords: ["exit code", "signal", "sigkill", "137", "127", "crash"], run: exitCodeTool },
];
