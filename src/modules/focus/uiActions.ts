// Palette actions: focus timer, editor navigation history and visual aids,
// accent-generated themes and scheduled light/dark switching.

import { toast } from "sonner";
import { inputBox, quickPick } from "@/modules/quick-pick";
import { goBack, goForward, navHistoryList } from "@/modules/editor/lib/navHistory";
import { app } from "@/app/appBridge";
import { setFeatureSetting, setTheme, setThemeId } from "@/modules/settings/store";
import { getFeature } from "@/modules/settings/useFeature";
import { saveCustomTheme } from "@/modules/theme/customThemes";
import { inLightWindow, themeFromAccent } from "@/modules/theme/themeGen";
import { startFocus, stopFocus, useFocusTimer } from "./focusTimer";
import { FINAL_ACTIONS } from "./finalActions";

export async function focusTimer(): Promise<void> {
  const running = useFocusTimer.getState().endsAt !== null;
  const pick = await quickPick(
    [
      ...(running ? [{ label: "Stop the timer", value: "stop" }] : []),
      { label: "Pomodoro: 25 min focus, then 5 min break", value: "25/5" },
      { label: "Deep work: 50 min, then 10 min break", value: "50/10" },
      { label: "Quick: 15 min", value: "15/0" },
      { label: "Custom…", value: "custom" },
    ],
    { title: `Focus timer${useFocusTimer.getState().completedToday ? ` · ${useFocusTimer.getState().completedToday} done today` : ""}` },
  );
  if (!pick) return;
  if (pick === "stop") return stopFocus();
  let [work, rest] = pick.split("/").map(Number);
  if (pick === "custom") {
    const v = await inputBox({ title: "Minutes (optionally /break minutes)", value: "30/5" });
    if (!v) return;
    [work, rest] = v.split("/").map((x) => Number(x.trim()));
    if (!work || work <= 0) return void toast.error("Enter a number of minutes");
  }
  const label = await inputBox({ title: "What are you focusing on? (optional)", value: "Focus" });
  if (label === undefined) return;
  startFocus(label || "Focus", work, rest || 0);
  toast.success(`Timer started: ${work} min`, { description: "Shown in the status bar; click it to stop." });
}

export async function navigationHistory(): Promise<void> {
  const { back, forward } = navHistoryList();
  const root = app().workspaceRoot()?.replace(/\\/g, "/") ?? "";
  const name = (p: string) => (p.replace(/\\/g, "/").startsWith(root) ? p.replace(/\\/g, "/").slice(root.length + 1) : p);
  const pick = await quickPick(
    [
      ...[...back].reverse().map((e, i) => ({ label: `${name(e.path)}:${e.line}`, description: `back ${i + 1}`, value: { dir: -1, n: i + 1 } })),
      ...[...forward].reverse().map((e, i) => ({ label: `${name(e.path)}:${e.line}`, description: `forward ${i + 1}`, value: { dir: 1, n: i + 1 } })),
    ],
    { title: "Navigation history", emptyText: "Jump around a bit first" },
  );
  if (!pick) return;
  for (let i = 0; i < pick.n; i++) (pick.dir < 0 ? goBack : goForward)();
}

async function toggleFeature(key: "editor.stickyScroll" | "editor.rainbowBrackets" | "editor.indentRainbow", label: string) {
  const next = !getFeature(key);
  await setFeatureSetting(key, next);
  toast.info(`${label} ${next ? "on" : "off"}`);
}

export async function themeFromAccentAction(): Promise<void> {
  const accent = await inputBox({ title: "Accent colour", placeholder: "#7c3aed", value: "#7c3aed" });
  if (!accent) return;
  const hex = /^#?([0-9a-f]{6})$/i.exec(accent.trim());
  if (!hex) return void toast.error("Use a 6-digit hex colour like #3b82f6");
  const mode = await quickPick(
    [
      { label: "Dark", value: "dark" as const },
      { label: "Light", value: "light" as const },
    ],
    { title: "Generate a theme" },
  );
  if (!mode) return;
  const theme = themeFromAccent(`#${hex[1].toLowerCase()}`, mode);
  await saveCustomTheme(theme);
  await setThemeId(theme.id);
  await setTheme(mode);
  toast.success("Theme generated and applied", { description: "Edit or delete it in Settings → Themes." });
}

// Scheduled light/dark switching ("07:00-19:00" = light during that window).
let scheduleTimer: ReturnType<typeof setInterval> | null = null;
let lastApplied: boolean | null = null;

export function installThemeSchedule(): void {
  if (scheduleTimer) return;
  const tick = () => {
    const spec = getFeature("theme.schedule");
    const light = spec ? inLightWindow(spec) : null;
    if (light === null || light === lastApplied) return;
    lastApplied = light;
    void setTheme(light ? "light" : "dark");
  };
  scheduleTimer = setInterval(tick, 60_000);
  setTimeout(tick, 3000);
}

export async function setThemeSchedule(): Promise<void> {
  const v = await inputBox({ title: "Use the light theme between… (empty to turn off)", placeholder: "07:00-19:00", value: getFeature("theme.schedule") || "07:00-19:00" });
  if (v === undefined) return;
  if (v.trim() && inLightWindow(v) === null) return void toast.error('Use the form "07:00-19:00"');
  await setFeatureSetting("theme.schedule", v.trim());
  lastApplied = null;
  toast.success(v.trim() ? `Light ${v.trim()}, dark otherwise` : "Theme schedule off");
}

export const UI_ACTIONS = [
  ...FINAL_ACTIONS,
  { id: "focus.timer", label: "Focus timer (Pomodoro)…", keywords: ["pomodoro", "timer", "focus", "break", "productivity", "countdown"], run: focusTimer },
  { id: "editor.goBack", label: "Go back (previous cursor location)", keywords: ["navigate", "back", "history", "previous location", "jump"], run: () => void (goBack() || toast.info("Nothing to go back to")) },
  { id: "editor.goForward", label: "Go forward", keywords: ["navigate", "forward", "history", "next location"], run: () => void (goForward() || toast.info("Nothing to go forward to")) },
  { id: "editor.navHistory", label: "Navigation history…", keywords: ["navigate", "history", "locations", "jumps"], run: navigationHistory },
  { id: "editor.toggleSticky", label: "Toggle sticky scroll", keywords: ["sticky", "scope", "header", "breadcrumb", "context"], run: () => toggleFeature("editor.stickyScroll", "Sticky scroll") },
  { id: "editor.toggleRainbow", label: "Toggle rainbow brackets", keywords: ["brackets", "rainbow", "colour", "pairs"], run: () => toggleFeature("editor.rainbowBrackets", "Rainbow brackets") },
  { id: "editor.toggleIndentRainbow", label: "Toggle indentation rainbow", keywords: ["indent", "rainbow", "yaml", "python", "whitespace"], run: () => toggleFeature("editor.indentRainbow", "Indentation rainbow") },
  { id: "theme.fromAccent", label: "Theme: Generate from an accent colour…", keywords: ["theme", "accent", "colour", "brand", "generate", "palette"], run: themeFromAccentAction },
  { id: "theme.schedule", label: "Theme: Switch light/dark on a schedule…", keywords: ["theme", "schedule", "night", "day", "auto", "dark mode", "time"], run: setThemeSchedule },
];
