import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SUPPORTED_LANGUAGES, type LanguageCode } from "@/i18n";
import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { ThemePref } from "@/modules/settings/store";
import {
  EDITOR_FONT_SIZES,
  TERMINAL_FONT_SIZES,
  TERMINAL_SCROLLBACK_PRESETS,
  setAgentNotifications,
  type EditorFormatter,
  setEditorAutoSave,
  setEditorAutoSaveDelay,
  setEditorFontSize,
  setEditorFormatOnSave,
  setEditorFormatter,
  exportSettings,
  importSettings,
  setAutostart,
  setLanguage,
  setRestoreWindowState,
  setShowHidden,
  setTerminalFontFamily,
  setTerminalLetterSpacing,
  setTerminalFontSize,
  setTerminalScrollback,
  setTerminalWebglEnabled,
  setTerminalCursorBlink,
  setTerminalFontWeight,
  setVimMode,
} from "@/modules/settings/store";
import { useTheme } from "@/modules/theme";
import {
  ArrowDown01Icon,
  ComputerIcon,
  Moon02Icon,
  Sun03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FORMATTER_LABELS } from "@/modules/editor/lib/externalFormat";
import { SectionHeader } from "../components/SectionHeader";
import { SettingRow } from "../components/SettingRow";

const FORMATTER_ORDER: EditorFormatter[] = [
  "lsp",
  "biome",
  "prettier",
  "ruff",
  "rustfmt",
  "gofmt",
  "clang-format",
  "shfmt",
  "zigfmt",
  "custom",
];

const APPEARANCE_DEFS: { id: ThemePref; labelKey: string; icon: typeof ComputerIcon }[] = [
  { id: "system", labelKey: "settings.general.themes.system", icon: ComputerIcon },
  { id: "light", labelKey: "settings.general.themes.light", icon: Sun03Icon },
  { id: "dark", labelKey: "settings.general.themes.dark", icon: Moon02Icon },
];

const AUTO_SAVE_STEP = 100;
const AUTO_SAVE_MIN = 100;
const AUTO_SAVE_MAX = 60000;

const TERMINAL_FONT_WEIGHTS: { label: string; value: string }[] = [
  { label: "Light", value: "300" },
  { label: "Normal", value: "normal" },
  { label: "Medium", value: "500" },
  { label: "Semibold", value: "600" },
  { label: "Bold", value: "bold" },
];

export function GeneralSection() {
  const { t } = useTranslation();
  const { mode, setMode } = useTheme();
  const language = usePreferencesStore((s) => s.language) as LanguageCode;
  const autostart = usePreferencesStore((s) => s.autostart);
  const restoreWindowState = usePreferencesStore((s) => s.restoreWindowState);
  const vimMode = usePreferencesStore((s) => s.vimMode);
  const editorAutoSave = usePreferencesStore((s) => s.editorAutoSave);
  const editorAutoSaveDelay = usePreferencesStore((s) => s.editorAutoSaveDelay);
  const editorFontSize = usePreferencesStore((s) => s.editorFontSize);
  const editorFormatOnSave = usePreferencesStore((s) => s.editorFormatOnSave);
  const editorFormatter = usePreferencesStore((s) => s.editorFormatter);
  const showHidden = usePreferencesStore((s) => s.showHidden);
  const terminalWebglEnabled = usePreferencesStore((s) => s.terminalWebglEnabled);
  const terminalCursorBlink = usePreferencesStore((s) => s.terminalCursorBlink);
  const terminalFontWeight = usePreferencesStore((s) => s.terminalFontWeight);
  const terminalFontFamily = usePreferencesStore((s) => s.terminalFontFamily);
  const terminalLetterSpacing = usePreferencesStore((s) => s.terminalLetterSpacing);
  const terminalFontSize = usePreferencesStore((s) => s.terminalFontSize);
  const terminalScrollback = usePreferencesStore((s) => s.terminalScrollback);
  const agentNotifications = usePreferencesStore((s) => s.agentNotifications);

  useEffect(() => {
    let alive = true;
    void isEnabled()
      .then((on) => {
        if (!alive) return;
        if (on !== usePreferencesStore.getState().autostart) {
          void setAutostart(on);
        }
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const onToggleAutostart = async (next: boolean) => {
    try {
      if (next) await enable();
      else await disable();
      await setAutostart(next);
    } catch (e) {
      console.error("autostart toggle failed", e);
    }
  };

  const onToggleTerminalWebgl = (next: boolean) => {
    void setTerminalWebglEnabled(next).catch((e) =>
      console.error("terminal WebGL preference update failed", e),
    );
  };
  const onPickTerminalFontSize = (size: number) => void setTerminalFontSize(size);
  const onPickScrollback = (lines: number) => void setTerminalScrollback(lines);

  const formatSpacing = (v: number) => (v > 0 ? `+${v}` : String(v));

  const [importStatus, setImportStatus] = useState<"idle" | "ok" | "error">("idle");
  const importInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    try {
      const data = await exportSettings();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "gear-settings.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Settings export failed", e);
    }
  };

  const handleImport = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text) as Record<string, unknown>;
      await importSettings(data);
      setImportStatus("ok");
    } catch (e) {
      console.error("Settings import failed", e);
      setImportStatus("error");
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
      setTimeout(() => setImportStatus("idle"), 3000);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title={t("settings.general.title")}
        description={t("settings.general.description")}
      />

      <div className="flex flex-col gap-2">
        <Label>{t("settings.general.appearance")}</Label>
        <div className="grid grid-cols-3 gap-2">
          {APPEARANCE_DEFS.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setMode(o.id)}
              className={cn(
                "group flex h-20 flex-col items-center justify-center gap-1.5 rounded-lg border bg-card transition-all",
                mode === o.id
                  ? "border-foreground/60 ring-1 ring-foreground/20"
                  : "border-border/60 hover:border-border",
              )}
            >
              <HugeiconsIcon icon={o.icon} size={18} strokeWidth={1.5} />
              <span className="text-[11.5px]">{t(o.labelKey)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>{t("settings.general.language")}</Label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="h-9 justify-between gap-2 px-2.5 text-[12px]"
            >
              <span>
                {language
                  ? (SUPPORTED_LANGUAGES.find((l) => l.code === language)?.label ?? language)
                  : t("settings.general.languageAuto")}
              </span>
              <HugeiconsIcon icon={ArrowDown01Icon} size={12} strokeWidth={2} className="opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[180px]">
            <DropdownMenuItem
              onSelect={() => void setLanguage("")}
              className={cn("text-[12px]", language === "" && "bg-accent/50")}
            >
              {t("settings.general.languageAuto")}
            </DropdownMenuItem>
            {SUPPORTED_LANGUAGES.map((lang) => (
              <DropdownMenuItem
                key={lang.code}
                onSelect={() => void setLanguage(lang.code)}
                className={cn("text-[12px]", language === lang.code && "bg-accent/50")}
              >
                {lang.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Editor</Label>
        <SettingRow
          title={t("settings.general.vimMode")}
          description={t("settings.general.vimModeDesc")}
        >
          <Switch checked={vimMode} onCheckedChange={(v) => void setVimMode(v)} />
        </SettingRow>
        <SettingRow
          title="Auto save"
          description="Automatically save files after a delay when changes are detected."
        >
          <Switch
            checked={editorAutoSave}
            onCheckedChange={(v) => void setEditorAutoSave(v)}
          />
        </SettingRow>
        {editorAutoSave && (
          <AutoSaveDelayInput
            value={editorAutoSaveDelay}
            onChange={(v) => void setEditorAutoSaveDelay(v)}
          />
        )}
        <SettingRow
          title="Font size"
          description="Font size for the code editor, independent of the terminal."
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-8 justify-between gap-2 rounded-none px-2.5 text-[12px]">
                <span>{editorFontSize} px</span>
                <HugeiconsIcon icon={ArrowDown01Icon} size={12} strokeWidth={2} className="opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[80px] rounded-none border border-border bg-popover p-0 shadow-none ring-0">
              {EDITOR_FONT_SIZES.map((size) => (
                <DropdownMenuItem
                  key={size}
                  onSelect={() => void setEditorFontSize(size)}
                  className={cn("rounded-none px-3 py-1.5 text-[12px]", size === editorFontSize && "bg-accent/50")}
                >
                  {size} px
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </SettingRow>
        <SettingRow
          title="Format on save"
          description="Run the chosen formatter each time a file is saved."
        >
          <Switch
            checked={editorFormatOnSave}
            onCheckedChange={(v) => void setEditorFormatOnSave(v)}
          />
        </SettingRow>
        {editorFormatOnSave && (
          <SettingRow
            title="Formatter"
            description="Language server, or an external CLI (must be installed and on PATH)."
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="h-8 justify-between gap-2 rounded-none px-2.5 text-[12px]">
                  <span>{FORMATTER_LABELS[editorFormatter]}</span>
                  <HugeiconsIcon icon={ArrowDown01Icon} size={12} strokeWidth={2} className="opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[160px] rounded-none border border-border bg-popover p-0 shadow-none ring-0">
                {FORMATTER_ORDER.map((id) => (
                  <DropdownMenuItem
                    key={id}
                    onSelect={() => void setEditorFormatter(id)}
                    className={cn("rounded-none px-3 py-1.5 text-[12px]", id === editorFormatter && "bg-accent/50")}
                  >
                    {FORMATTER_LABELS[id]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </SettingRow>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label>{t("settings.general.explorer")}</Label>
        <SettingRow
          title={t("settings.general.showHidden")}
          description={t("settings.general.showHiddenDesc")}
        >
          <Switch checked={showHidden} onCheckedChange={(v) => void setShowHidden(v)} />
        </SettingRow>
      </div>

      <div className="flex flex-col gap-2">
        <Label>{t("settings.general.terminal")}</Label>
        <SettingRow
          title={
            <span className="inline-flex items-center gap-1.5">
              {t("settings.general.webglRenderer")}
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="cursor-help text-[11px] text-muted-foreground/70 leading-none"
                      aria-label={t("settings.general.webglRenderer")}
                    >
                      ⓘ
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[260px] text-[11px]">
                    {t("settings.general.webglRendererInfo")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </span>
          }
          description={t("settings.general.webglRendererDesc")}
        >
          <Switch checked={terminalWebglEnabled} onCheckedChange={onToggleTerminalWebgl} />
        </SettingRow>
        <SettingRow
          title="Terminal cursor blink"
          description="Blink the terminal cursor. Off keeps it static (lower GPU wakeups)."
        >
          <Switch
            checked={terminalCursorBlink}
            onCheckedChange={(v) => void setTerminalCursorBlink(v)}
          />
        </SettingRow>
        <SettingRow
          title={t("settings.general.fontFamily")}
          description={t("settings.general.fontFamilyDesc")}
        >
          <input
            type="text"
            value={terminalFontFamily}
            placeholder={t("settings.general.fontFamilyPlaceholder")}
            onChange={(e) => void setTerminalFontFamily(e.target.value)}
            className="h-8 w-48 rounded-none border border-border bg-background px-2.5 text-[12px] outline-none focus:border-foreground/40"
          />
        </SettingRow>
        <SettingRow
          title={t("settings.general.letterSpacing")}
          description={t("settings.general.letterSpacingDesc")}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-8 justify-between gap-2 rounded-none px-2.5 text-[12px]">
                <span>{formatSpacing(terminalLetterSpacing)} px</span>
                <HugeiconsIcon icon={ArrowDown01Icon} size={12} strokeWidth={2} className="opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[100px] rounded-none border border-border bg-popover p-0 shadow-none ring-0">
              {[-4, -3, -2, -1, 0, 1, 2, 3, 4].map((v) => (
                <DropdownMenuItem
                  key={v}
                  onSelect={() => void setTerminalLetterSpacing(v)}
                  className={cn("rounded-none px-3 py-1.5 text-[12px]", v === terminalLetterSpacing && "bg-accent/50")}
                >
                  {formatSpacing(v)} px
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </SettingRow>
        <SettingRow
          title="Terminal font weight"
          description="Stroke weight of the terminal text."
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-8 justify-between gap-2 rounded-none px-2.5 text-[12px]">
                <span>
                  {TERMINAL_FONT_WEIGHTS.find((w) => w.value === terminalFontWeight)?.label ??
                    terminalFontWeight}
                </span>
                <HugeiconsIcon icon={ArrowDown01Icon} size={12} strokeWidth={2} className="opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[120px] rounded-none border border-border bg-popover p-0 shadow-none ring-0">
              {TERMINAL_FONT_WEIGHTS.map((w) => (
                <DropdownMenuItem
                  key={w.value}
                  onSelect={() => void setTerminalFontWeight(w.value)}
                  className={cn("rounded-none px-3 py-1.5 text-[12px]", w.value === terminalFontWeight && "bg-accent/50")}
                >
                  {w.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </SettingRow>
        <SettingRow
          title={t("settings.general.fontSize")}
          description={t("settings.general.fontSizeDesc")}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-8 justify-between gap-2 rounded-none px-2.5 text-[12px]">
                <span>{terminalFontSize} px</span>
                <HugeiconsIcon icon={ArrowDown01Icon} size={12} strokeWidth={2} className="opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[80px] rounded-none border border-border bg-popover p-0 shadow-none ring-0">
              {TERMINAL_FONT_SIZES.map((size) => (
                <DropdownMenuItem
                  key={size}
                  onSelect={() => onPickTerminalFontSize(size)}
                  className={cn("rounded-none px-3 py-1.5 text-[12px]", size === terminalFontSize && "bg-accent/50")}
                >
                  {size} px
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </SettingRow>
        <SettingRow
          title={t("settings.general.scrollback")}
          description={t("settings.general.scrollbackDesc")}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-8 justify-between gap-2 rounded-none px-2.5 text-[12px]">
                <span>{terminalScrollback.toLocaleString()} lines</span>
                <HugeiconsIcon icon={ArrowDown01Icon} size={12} strokeWidth={2} className="opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[140px] rounded-none border border-border bg-popover p-0 shadow-none ring-0">
              {TERMINAL_SCROLLBACK_PRESETS.map((lines) => (
                <DropdownMenuItem
                  key={lines}
                  onSelect={() => onPickScrollback(lines)}
                  className={cn("rounded-none px-3 py-1.5 text-[12px]", lines === terminalScrollback && "bg-accent/50")}
                >
                  {lines.toLocaleString()} lines
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </SettingRow>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Agents</Label>
        <SettingRow
          title="Coding agent notifications"
          description="Alert when Claude Code or Codex running in a terminal needs your input or finishes. Desktop notification when Gear is unfocused, in-app otherwise."
        >
          <Switch
            checked={agentNotifications}
            onCheckedChange={(v) => void setAgentNotifications(v)}
          />
        </SettingRow>
      </div>

      <div className="flex flex-col gap-2">
        <Label>{t("settings.general.startup")}</Label>
        <div className="flex flex-col gap-2">
          <SettingRow
            title={t("settings.general.launchAtLogin")}
            description={t("settings.general.launchAtLoginDesc")}
          >
            <Switch checked={autostart} onCheckedChange={(v) => void onToggleAutostart(v)} />
          </SettingRow>
          <SettingRow
            title={t("settings.general.restoreWindow")}
            description={t("settings.general.restoreWindowDesc")}
          >
            <Switch checked={restoreWindowState} onCheckedChange={(v) => void setRestoreWindowState(v)} />
          </SettingRow>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Backup</Label>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="h-8 rounded-none px-3 text-[12px]"
            onClick={() => void handleExport()}
          >
            Export settings
          </Button>
          <Button
            variant="outline"
            className="h-8 rounded-none px-3 text-[12px]"
            onClick={() => importInputRef.current?.click()}
          >
            Import settings
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImport(file);
            }}
          />
          {importStatus === "ok" && (
            <span className="text-[11.5px] text-green-500">Imported successfully. Restart to apply all changes.</span>
          )}
          {importStatus === "error" && (
            <span className="text-[11.5px] text-destructive">Import failed — invalid settings file.</span>
          )}
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
      {children}
    </span>
  );
}

function AutoSaveDelayInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(
      AUTO_SAVE_MAX,
      Math.max(AUTO_SAVE_MIN, Math.round(n)),
    );
    setDraft(String(clamped));
    if (clamped !== value) onChange(clamped);
  };

  return (
    <SettingRow
      title="Auto save delay"
      description="Delay before unsaved changes are saved automatically."
    >
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={AUTO_SAVE_MIN}
          max={AUTO_SAVE_MAX}
          step={AUTO_SAVE_STEP}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            }
          }}
          className="h-8 w-20 rounded-md border border-border bg-background px-2.5 text-right text-[12px] md:text-[12px] tabular-nums outline-none focus:border-foreground/40 focus-visible:ring-0 focus-visible:border-foreground/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <span className="text-[11px] text-muted-foreground">ms</span>
      </div>
    </SettingRow>
  );
}
