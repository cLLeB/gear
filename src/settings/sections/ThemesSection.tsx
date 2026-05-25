import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  deleteBgImage,
  storeBgImage,
  listBuiltinThemes,
  saveCustomTheme,
  deleteCustomTheme,
  starterTheme,
  parseThemeFile,
  THEME_FILE_EXT,
} from "@/modules/theme";
import { useTheme } from "@/modules/theme";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  setBackgroundKind,
  setBackgroundOpacity,
  setBackgroundBlur,
} from "@/modules/settings/store";
import { CheckmarkCircle01Icon, Delete02Icon, Download01Icon, Upload01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useRef, useState } from "react";
import { SectionHeader } from "../components/SectionHeader";

function ThemeCard({
  theme,
  selected,
  onSelect,
  onDelete,
  isCustom,
}: {
  theme: { id: string; name: string; variants: { light?: { colors?: Record<string, string> }; dark?: { colors?: Record<string, string> } } };
  selected: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  isCustom?: boolean;
}) {
  const darkBg = theme.variants.dark?.colors?.background ?? "#1a1b26";
  const darkFg = theme.variants.dark?.colors?.primary ?? "#7aa2f7";
  const lightBg = theme.variants.light?.colors?.background ?? "#f8fafc";
  const lightFg = theme.variants.light?.colors?.primary ?? "#3b82f6";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group relative flex flex-col gap-2 rounded-lg border p-3 text-left transition-all",
        selected
          ? "border-foreground/60 ring-1 ring-foreground/20"
          : "border-border/60 hover:border-border",
      )}
    >
      <div className="flex gap-1.5">
        <div
          className="h-10 flex-1 rounded"
          style={{ background: darkBg }}
        >
          <div className="m-1.5 h-2 w-8 rounded-full" style={{ background: darkFg }} />
          <div className="mx-1.5 h-1.5 w-5 rounded-full opacity-50" style={{ background: darkFg }} />
        </div>
        <div
          className="h-10 flex-1 rounded"
          style={{ background: lightBg }}
        >
          <div className="m-1.5 h-2 w-8 rounded-full" style={{ background: lightFg }} />
          <div className="mx-1.5 h-1.5 w-5 rounded-full opacity-50" style={{ background: lightFg }} />
        </div>
      </div>
      <span className="text-[11.5px] font-medium">{theme.name}</span>

      {selected && (
        <span className="absolute right-2 top-2">
          <HugeiconsIcon icon={CheckmarkCircle01Icon} size={14} strokeWidth={2} className="text-foreground" />
        </span>
      )}

      {isCustom && onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute bottom-2 right-2 hidden rounded p-0.5 hover:bg-destructive/20 group-hover:block"
        >
          <HugeiconsIcon icon={Delete02Icon} size={12} strokeWidth={2} className="text-destructive" />
        </button>
      )}
    </button>
  );
}

export function ThemesSection() {
  const { themeId, setThemeId, customThemes } = useTheme();
  const backgroundKind = usePreferencesStore((s) => s.backgroundKind);
  const backgroundOpacity = usePreferencesStore((s) => s.backgroundOpacity);
  const backgroundBlur = usePreferencesStore((s) => s.backgroundBlur);

  const builtinThemes = listBuiltinThemes();
  const allThemes = [...builtinThemes, ...customThemes];

  const bgInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const handleBgFile = async (file: File) => {
    await storeBgImage(file);
    await setBackgroundKind("image");
  };

  const handleRemoveBg = async () => {
    await deleteBgImage();
    await setBackgroundKind("none");
  };

  const handleImportTheme = async (file: File) => {
    try {
      const text = await file.text();
      const theme = parseThemeFile(text);
      await saveCustomTheme(theme);
      setImportError(null);
    } catch {
      setImportError("Invalid theme file");
      setTimeout(() => setImportError(null), 3000);
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const handleCreateTheme = () => {
    const theme = starterTheme();
    void saveCustomTheme(theme);
  };

  const handleDeleteCustomTheme = async (id: string) => {
    await deleteCustomTheme(id);
    if (themeId === id) setThemeId("gear-default");
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Themes"
        description="Customize the look and feel of Gear"
      />

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
            Color themes
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              className="h-7 gap-1.5 rounded-none px-2.5 text-[11.5px]"
              onClick={handleCreateTheme}
            >
              <HugeiconsIcon icon={Download01Icon} size={12} strokeWidth={2} />
              Create
            </Button>
            <Button
              variant="outline"
              className="h-7 gap-1.5 rounded-none px-2.5 text-[11.5px]"
              onClick={() => importInputRef.current?.click()}
            >
              <HugeiconsIcon icon={Upload01Icon} size={12} strokeWidth={2} />
              Import
            </Button>
            <input
              ref={importInputRef}
              type="file"
              accept={`${THEME_FILE_EXT},application/json`}
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImportTheme(file);
              }}
            />
          </div>
        </div>

        {importError && (
          <p className="text-[11.5px] text-destructive">{importError}</p>
        )}

        <div className="grid grid-cols-2 gap-2">
          {allThemes.map((theme) => {
            const isCustom = customThemes.some((t) => t.id === theme.id);
            return (
              <ThemeCard
                key={theme.id}
                theme={theme as Parameters<typeof ThemeCard>[0]["theme"]}
                selected={themeId === theme.id}
                onSelect={() => setThemeId(theme.id)}
                isCustom={isCustom}
                onDelete={isCustom ? () => void handleDeleteCustomTheme(theme.id) : undefined}
              />
            );
          })}
        </div>

        {customThemes.length > 0 && (
          <div className="flex justify-end">
            <p className="text-[11px] text-muted-foreground">
              Custom themes can be exported and shared as{" "}
              <code className="text-[10.5px]">{THEME_FILE_EXT}</code> files.
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
          Background image
        </span>

        <div className="flex items-center gap-2">
          <Button
            variant={backgroundKind === "none" ? "default" : "outline"}
            className="h-7 rounded-none px-3 text-[11.5px]"
            onClick={() => void setBackgroundKind("none")}
          >
            None
          </Button>
          <Button
            variant={backgroundKind === "image" ? "default" : "outline"}
            className="h-7 rounded-none px-3 text-[11.5px]"
            onClick={() => bgInputRef.current?.click()}
          >
            Pick image
          </Button>
          <input
            ref={bgInputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleBgFile(file);
            }}
          />
          {backgroundKind === "image" && (
            <Button
              variant="ghost"
              className="h-7 rounded-none px-2 text-[11.5px] text-destructive hover:text-destructive"
              onClick={() => void handleRemoveBg()}
            >
              Remove
            </Button>
          )}
        </div>

        {backgroundKind === "image" && (
          <div className="flex flex-col gap-3 pt-1">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] text-muted-foreground">Opacity</span>
                <span className="text-[11.5px] text-muted-foreground">
                  {Math.round(backgroundOpacity * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={backgroundOpacity}
                onChange={(e) => void setBackgroundOpacity(Number(e.target.value))}
                className="h-1.5 w-full accent-foreground"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] text-muted-foreground">Blur</span>
                <span className="text-[11.5px] text-muted-foreground">
                  {backgroundBlur}px
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={64}
                step={1}
                value={backgroundBlur}
                onChange={(e) => void setBackgroundBlur(Number(e.target.value))}
                className="h-1.5 w-full accent-foreground"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
