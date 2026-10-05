// Terminal-adjacent tools: run in a new split, benchmark a command, check a
// URL, DNS lookup, presentation mode, and AI shell helpers.

import { toast } from "sonner";
import { app } from "@/app/appBridge";
import { IS_WINDOWS } from "@/lib/platform";
import { quoteShellArg } from "@/lib/shellQuote";
import { generateOneShot, oneShotUnavailableReason } from "@/modules/ai/lib/oneShot";
import { native } from "@/modules/ai/lib/native";
import { openTextViewer } from "@/modules/compare/CompareDialog";
import { confirmPick, inputBox, quickPick } from "@/modules/quick-pick";
import { setEditorFontSize, setTerminalFontSize } from "@/modules/settings/store";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { writeTerminalClipboard } from "@/modules/terminal/lib/terminalClipboard";
import { lastFinishedCommand, setLeafDraft } from "@/modules/terminal/lib/useTerminalSession";
import { benchStats, CURL_WRITE_OUT, formatMs, parseCurlCheck, parseNslookup } from "./netTools";

export async function runInNewSplit(): Promise<void> {
  if (app().activeTerminalLeaf() === null) return void toast.error("Focus a terminal first");
  const command = await inputBox({ title: "Run in a new split pane", placeholder: "e.g. npm run dev  (empty for just a shell)" });
  if (command === undefined) return;
  const dir = await quickPick(
    [
      { label: "Side by side", value: "row" as const },
      { label: "Below", value: "col" as const },
    ],
    { title: "Where?" },
  );
  if (!dir) return;
  if (!app().splitAndRun(dir, command.trim() || undefined)) toast.error("Couldn't split this tab (pane limit?)");
}

export async function benchmarkCommand(): Promise<void> {
  const leaf = app().activeTerminalLeaf();
  const command = await inputBox({ title: "Benchmark a command (hyperfine-style)", value: leaf !== null ? (lastFinishedCommand(leaf)?.command ?? "") : "" });
  if (!command) return;
  const runsIn = await inputBox({ title: "Number of runs", value: "10" });
  const runs = Math.min(100, Math.max(2, Number(runsIn) || 10));
  const cwd = app().activeCwd();
  const t = toast.loading(`Warming up…`);
  const samples: number[] = [];
  let failures = 0;
  try {
    await native.runCommand(command, cwd, 300); // warm-up (caches, JIT)
    for (let i = 0; i < runs; i++) {
      toast.loading(`Run ${i + 1} / ${runs}…`, { id: t });
      const start = performance.now();
      const r = await native.runCommand(command, cwd, 300);
      samples.push(performance.now() - start);
      if (r.exit_code !== 0) failures++;
    }
  } finally {
    toast.dismiss(t);
  }
  const s = benchStats(samples);
  const rows = [
    ["Mean ± σ", `${formatMs(s.mean)} ± ${formatMs(s.stddev)}`],
    ["Median", formatMs(s.median)],
    ["Min … Max", `${formatMs(s.min)} … ${formatMs(s.max)}`],
    ["p95", formatMs(s.p95)],
    ["Runs", `${s.runs}${failures ? ` (${failures} exited non-zero!)` : ""}`],
  ];
  const report = `${command}\n\n${rows.map(([k, v]) => `${k.padEnd(10)} ${v}`).join("\n")}\n\nIncludes process start-up (~ms) of Gear's command runner.\n`;
  const pick = await quickPick(rows.map(([k, v]) => ({ label: v, description: k, value: v })), { title: `Benchmark: ${command}`, placeholder: "Pick to copy the full report" });
  if (pick) await writeTerminalClipboard(report);
}

export async function checkUrl(): Promise<void> {
  const url = await inputBox({ title: "Check a URL (status, timing, headers, redirects)", value: "https://" });
  if (!url || !/^https?:\/\/\S+$/.test(url.trim())) return;
  const nul = IS_WINDOWS ? "NUL" : "/dev/null";
  const curl = IS_WINDOWS ? "curl.exe" : "curl";
  const t = toast.loading("Requesting…");
  const r = await native.runCommand(`${curl} -sS -L -D - -o ${nul} --max-time 20 -A "Gear-URL-check" -w "${CURL_WRITE_OUT}" ${quoteShellArg(url.trim())}`, null, 30).catch(() => null);
  toast.dismiss(t);
  const c = r ? parseCurlCheck(r.stdout) : null;
  if (!c) return void toast.error("Request failed", { description: (r?.stderr || "curl not available").trim().slice(0, 300) });
  const security = ["strict-transport-security", "content-security-policy", "x-content-type-options", "x-frame-options", "referrer-policy"];
  const present = new Set(c.headers.map(([k]) => k.toLowerCase()));
  const pick = await quickPick(
    [
      { label: `${c.status} · ${formatMs(c.total)} · HTTP/${c.httpVersion}`, description: c.finalUrl, value: c.finalUrl },
      { label: `DNS ${formatMs(c.dns)} · connect ${formatMs(c.connect - c.dns)} · TLS ${formatMs(Math.max(0, c.tls - c.connect))} · first byte ${formatMs(c.ttfb)}`, description: "timing", value: "" },
      { label: `${(c.bytes / 1024).toFixed(1)} KB from ${c.ip}${c.redirects ? ` after ${c.redirects} redirect(s)` : ""}`, value: c.ip },
      { label: `Security headers: ${security.filter((h) => present.has(h)).length}/${security.length}`, description: security.filter((h) => !present.has(h)).map((h) => `missing ${h}`).join(", ") || "all present", value: "" },
      ...c.headers.map(([k, v]) => ({ label: `${k}: ${v}`.slice(0, 200), value: `${k}: ${v}` })),
    ],
    { title: url.trim() },
  );
  if (pick) await writeTerminalClipboard(pick);
}

export async function dnsLookup(): Promise<void> {
  const name = await inputBox({ title: "DNS lookup", placeholder: "example.com" });
  if (!name?.trim()) return;
  const type = await quickPick(["A", "AAAA", "MX", "TXT", "CNAME", "NS", "ANY"].map((t) => ({ label: t, value: t })), { title: `Record type for ${name.trim()}` });
  if (!type) return;
  const r = await native.runCommand(`nslookup -type=${type} ${quoteShellArg(name.trim())}`, null, 20).catch(() => null);
  const answers = r ? parseNslookup(r.stdout) : [];
  if (!answers.length) return void toast.info(`No ${type} records found`, { description: (r?.stdout || r?.stderr || "").trim().split("\n").slice(-2).join(" ") });
  const pick = await quickPick(answers.map((a) => ({ label: a, value: a })), { title: `${type} records for ${name.trim()}` });
  if (pick) await writeTerminalClipboard(pick);
}

// ── presentation mode ─────────────────────────────────────────────────────

const PRESENT_KEY = "gear.presentationMode";

export async function togglePresentationMode(): Promise<void> {
  const prefs = usePreferencesStore.getState();
  let saved: { editor: number; terminal: number } | null = null;
  try {
    saved = JSON.parse(localStorage.getItem(PRESENT_KEY) ?? "null");
  } catch {
    saved = null;
  }
  if (saved) {
    await setEditorFontSize(saved.editor);
    await setTerminalFontSize(saved.terminal);
    localStorage.removeItem(PRESENT_KEY);
    return void toast.info("Presentation mode off");
  }
  const editor = prefs.editorFontSize;
  const terminal = prefs.terminalFontSize;
  localStorage.setItem(PRESENT_KEY, JSON.stringify({ editor, terminal }));
  await setEditorFontSize(Math.round(editor * 1.5));
  await setTerminalFontSize(Math.round(terminal * 1.5));
  toast.success("Presentation mode on", { description: "Fonts enlarged for screen sharing. Run again to restore." });
}

// ── AI shell helpers ──────────────────────────────────────────────────────

async function ai(system: string, prompt: string, maxOutputTokens = 900): Promise<string | null> {
  const why = oneShotUnavailableReason();
  if (why) return void toast.error("AI is not configured", { description: why }), null;
  const t = toast.loading("Asking AI…");
  try {
    return await generateOneShot({ system, prompt, maxOutputTokens, temperature: 0.1 });
  } catch (e) {
    toast.error("AI request failed", { description: String(e) });
    return null;
  } finally {
    toast.dismiss(t);
  }
}

const strip = (s: string) => s.trim().replace(/^```[\w-]*\n([\s\S]*?)\n?```$/, "$1").trim();

export async function convertShellCommand(): Promise<void> {
  const leaf = app().activeTerminalLeaf();
  const command = await inputBox({ title: "Command to convert", value: leaf !== null ? (lastFinishedCommand(leaf)?.command ?? "") : "" });
  if (!command) return;
  const to = await quickPick(
    [
      { label: "→ PowerShell", value: "PowerShell 7" },
      { label: "→ Bash", value: "Bash (Linux/macOS)" },
      { label: "→ Windows cmd.exe", value: "Windows cmd.exe" },
      { label: "→ fish", value: "fish shell" },
    ],
    { title: command },
  );
  if (!to) return;
  const reply = await ai(`Convert the shell command to ${to}, keeping its behaviour identical. Reply with only the converted command line(s), no explanation, no code fence.`, command, 400);
  if (!reply) return;
  const converted = strip(reply);
  if (leaf !== null && (await confirmPick(converted, "Put it at the prompt (not run)", "or Esc to copy it"))) {
    setLeafDraft(leaf, converted);
    return;
  }
  await writeTerminalClipboard(converted);
  toast.success("Copied converted command", { description: converted });
}

export async function generateShellScript(): Promise<void> {
  const request = await inputBox({ title: "Describe the script", placeholder: "e.g. back up ~/projects to a dated tar.gz and keep the last 7" });
  if (!request) return;
  const kind = await quickPick(
    [
      { label: "Bash script", value: "bash" },
      { label: "PowerShell script", value: "powershell" },
      { label: "Python script", value: "python" },
    ],
    { title: "Script type" },
  );
  if (!kind) return;
  const reply = await ai(
    `Write a complete, safe ${kind} script for the request. Include a shebang (for bash/python), strict mode / error handling, argument validation and short comments. Reply with only the script in one code block.`,
    request,
    2500,
  );
  if (!reply) return;
  const script = strip(reply.replace(/^[\s\S]*?(```)/, "$1"));
  openTextViewer(`Generated ${kind} script`, script, kind === "python" ? "script.py" : kind === "powershell" ? "script.ps1" : "script.sh");
  await writeTerminalClipboard(script);
  toast.success("Script copied to the clipboard", { description: "Review it before running." });
}

export const NET_ACTIONS = [
  { id: "terminal.splitRun", label: "Terminal: Run a command in a new split pane…", keywords: ["split", "pane", "run", "side by side", "dev server"], run: runInNewSplit },
  { id: "terminal.benchmark", label: "Terminal: Benchmark a command (runs, mean, median, p95)…", keywords: ["benchmark", "hyperfine", "timing", "performance", "speed"], run: benchmarkCommand },
  { id: "tools.checkUrl", label: "Tools: Check a URL (status, timing, headers, redirects)…", keywords: ["http", "url", "status", "headers", "latency", "ping", "uptime", "curl"], run: checkUrl },
  { id: "tools.dns", label: "Tools: DNS lookup…", keywords: ["dns", "nslookup", "dig", "mx", "txt", "a record", "domain"], run: dnsLookup },
  { id: "view.presentation", label: "View: Toggle presentation mode (bigger fonts)", keywords: ["presentation", "demo", "screen share", "zoom", "font size", "large"], run: togglePresentationMode },
  { id: "ai.convertShell", label: "AI: Convert a command between Bash / PowerShell / cmd / fish…", keywords: ["powershell", "bash", "convert", "translate command", "windows", "ai"], run: convertShellCommand },
  { id: "ai.shellScript", label: "AI: Generate a script (Bash / PowerShell / Python)…", keywords: ["script", "automation", "bash", "powershell", "python", "generate", "ai"], run: generateShellScript },
];
