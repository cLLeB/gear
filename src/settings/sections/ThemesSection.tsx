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
  BUILTIN_WALLPAPERS,
  WALLPAPER_CATEGORIES,
  BUILTIN_GRADIENTS,
  GRADIENT_CATEGORIES,
  getWallpaperUrl,
} from "@/modules/theme";
import { useTheme } from "@/modules/theme";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  setBackgroundKind,
  setBackgroundOpacity,
  setBackgroundBlur,
  setBackgroundImageId,
  setBackgroundTintColor,
  setBackgroundTintOpacity,
  setBackgroundNoiseOpacity,
} from "@/modules/settings/store";
import {
  CheckmarkCircle01Icon,
  Delete02Icon,
  Download01Icon,
  Upload01Icon,
  Image01Icon,
  GridIcon,
  PaintBrushIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useRef, useState } from "react";
import { SectionHeader } from "../components/SectionHeader";
import type { WallpaperCategory } from "@/modules/theme/builtinWallpapers";
import type { GradientCategory } from "@/modules/theme/builtinGradients";

type BgTab = "gallery" | "gradients" | "custom";

function ThemeCard({
  theme,
  selected,
  onSelect,
  onDelete,
  isCustom,
  onHover,
}: {
  theme: { id: string; name: string; variants: { light?: { colors?: Record<string, string> }; dark?: { colors?: Record<string, string> } } };
  selected: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  isCustom?: boolean;
  onHover?: (hovering: boolean) => void;
}) {
  const darkBg = theme.variants.dark?.colors?.background ?? "#1a1b26";
  const darkFg = theme.variants.dark?.colors?.primary ?? "#7aa2f7";
  const lightBg = theme.variants.light?.colors?.background ?? "#f8fafc";
  const lightFg = theme.variants.light?.colors?.primary ?? "#3b82f6";

  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      onFocus={() => onHover?.(true)}
      onBlur={() => onHover?.(false)}
      className={cn(
        "group relative flex flex-col gap-2 rounded-lg border p-3 text-left transition-all",
        selected
          ? "border-foreground/60 ring-1 ring-foreground/20"
          : "border-border/60 hover:border-border",
      )}
    >
      <div className="flex gap-1.5">
        <div className="h-10 flex-1 rounded" style={{ background: darkBg }}>
          <div className="m-1.5 h-2 w-8 rounded-full" style={{ background: darkFg }} />
          <div className="mx-1.5 h-1.5 w-5 rounded-full opacity-50" style={{ background: darkFg }} />
        </div>
        <div className="h-10 flex-1 rounded" style={{ background: lightBg }}>
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
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="absolute bottom-2 right-2 hidden rounded p-0.5 hover:bg-destructive/20 group-hover:block"
        >
          <HugeiconsIcon icon={Delete02Icon} size={12} strokeWidth={2} className="text-destructive" />
        </button>
      )}
    </button>
  );
}

function CategoryChips<T extends string>({
  categories,
  active,
  onChange,
}: {
  categories: { id: T | "all"; label: string }[];
  active: T | "all";
  onChange: (id: T | "all") => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {categories.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onChange(c.id)}
          className={cn(
            "rounded-none px-2 py-0.5 text-[10.5px] transition-colors border",
            active === c.id
              ? "border-foreground/60 bg-foreground/10 text-foreground"
              : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground",
          )}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

function WallpaperGallery({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [activeCategory, setActiveCategory] = useState<WallpaperCategory | "all">("all");
  const filtered = activeCategory === "all"
    ? BUILTIN_WALLPAPERS
    : BUILTIN_WALLPAPERS.filter((w) => w.category === activeCategory);

  return (
    <div className="flex flex-col gap-2">
      <CategoryChips
        categories={WALLPAPER_CATEGORIES}
        active={activeCategory}
        onChange={setActiveCategory}
      />
      <div className="grid grid-cols-3 gap-1.5">
        {filtered.map((wp) => (
          <button
            key={wp.id}
            type="button"
            onClick={() => onSelect(wp.id)}
            className={cn(
              "group relative overflow-hidden rounded border transition-all",
              selectedId === wp.id
                ? "border-foreground/60 ring-1 ring-foreground/20"
                : "border-border/40 hover:border-border",
            )}
          >
            <img
              src={getWallpaperUrl(wp.file)}
              alt={wp.label}
              className="h-16 w-full object-cover"
              loading="lazy"
            />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1 opacity-0 transition-opacity group-hover:opacity-100">
              <span className="text-[10px] text-white">{wp.label}</span>
            </div>
            {selectedId === wp.id && (
              <span className="absolute right-1 top-1 rounded-full bg-black/50 p-0.5">
                <HugeiconsIcon icon={CheckmarkCircle01Icon} size={11} strokeWidth={2.5} className="text-white" />
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function GradientGallery({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [activeCategory, setActiveCategory] = useState<GradientCategory | "all">("all");
  const filtered = activeCategory === "all"
    ? BUILTIN_GRADIENTS
    : BUILTIN_GRADIENTS.filter((g) => g.category === activeCategory);

  return (
    <div className="flex flex-col gap-2">
      <CategoryChips
        categories={GRADIENT_CATEGORIES}
        active={activeCategory}
        onChange={setActiveCategory}
      />
      <div className="grid grid-cols-3 gap-1.5">
        {filtered.map((grad) => (
          <button
            key={grad.id}
            type="button"
            onClick={() => onSelect(grad.id)}
            className={cn(
              "group relative overflow-hidden rounded border transition-all",
              selectedId === grad.id
                ? "border-foreground/60 ring-1 ring-foreground/20"
                : "border-border/40 hover:border-border",
            )}
          >
            <div
              className="h-16 w-full"
              style={{ background: grad.css }}
            />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 py-1 opacity-0 transition-opacity group-hover:opacity-100">
              <span className="text-[10px] text-white">{grad.label}</span>
            </div>
            {selectedId === grad.id && (
              <span className="absolute right-1 top-1 rounded-full bg-black/50 p-0.5">
                <HugeiconsIcon icon={CheckmarkCircle01Icon} size={11} strokeWidth={2.5} className="text-white" />
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function SliderRow({
  label,
  value,
  displayValue,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  displayValue: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11.5px] text-muted-foreground">{label}</span>
        <span className="text-[11.5px] text-muted-foreground">{displayValue}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full accent-foreground"
      />
    </div>
  );
}

export function ThemesSection() {
  const { themeId, setThemeId, previewThemeId, customThemes } = useTheme();
  const backgroundKind = usePreferencesStore((s) => s.backgroundKind);
  const backgroundImageId = usePreferencesStore((s) => s.backgroundImageId);
  const backgroundOpacity = usePreferencesStore((s) => s.backgroundOpacity);
  const backgroundBlur = usePreferencesStore((s) => s.backgroundBlur);
  const backgroundTintColor = usePreferencesStore((s) => s.backgroundTintColor);
  const backgroundTintOpacity = usePreferencesStore((s) => s.backgroundTintOpacity);
  const backgroundNoiseOpacity = usePreferencesStore((s) => s.backgroundNoiseOpacity);

  const builtinThemes = listBuiltinThemes();
  const allThemes = [...builtinThemes, ...customThemes];

  const bgInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const defaultTab: BgTab =
    backgroundKind === "builtin" ? "gallery"
    : backgroundKind === "gradient" ? "gradients"
    : "custom";
  const [activeTab, setActiveTab] = useState<BgTab>(defaultTab);

  const handleTabChange = (tab: BgTab) => setActiveTab(tab);

  const handleSelectWallpaper = async (id: string) => {
    await setBackgroundImageId(id);
    await setBackgroundKind("builtin");
  };

  const handleSelectGradient = async (id: string) => {
    await setBackgroundImageId(id);
    await setBackgroundKind("gradient");
  };

  const handleBgFile = async (file: File) => {
    await storeBgImage(file);
    await setBackgroundImageId(null);
    await setBackgroundKind("image");
  };

  const handleRemoveBg = async () => {
    await deleteBgImage();
    await setBackgroundImageId(null);
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

  const handleCreateTheme = () => void saveCustomTheme(starterTheme());

  const handleDeleteCustomTheme = async (id: string) => {
    await deleteCustomTheme(id);
    if (themeId === id) setThemeId("gear-default");
  };

  const hasBackground = backgroundKind !== "none";

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Themes"
        description="Customize the look and feel of Gear"
      />

      {/* Color themes */}
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
                onHover={(h) => previewThemeId(h ? theme.id : null)}
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

      {/* Background */}
      <div className="flex flex-col gap-3">
        <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
          Background
        </span>

        {/* Tab bar */}
        <div className="flex items-center gap-0 border-b border-border/50">
          {(
            [
              { id: "gallery" as BgTab, label: "Gallery", icon: GridIcon },
              { id: "gradients" as BgTab, label: "Gradients", icon: PaintBrushIcon },
              { id: "custom" as BgTab, label: "Custom", icon: Image01Icon },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabChange(tab.id)}
              className={cn(
                "flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-[11.5px] transition-colors",
                activeTab === tab.id
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <HugeiconsIcon icon={tab.icon} size={12} strokeWidth={2} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Gallery tab */}
        {activeTab === "gallery" && (
          <WallpaperGallery
            selectedId={backgroundKind === "builtin" ? backgroundImageId : null}
            onSelect={(id) => void handleSelectWallpaper(id)}
          />
        )}

        {/* Gradients tab */}
        {activeTab === "gradients" && (
          <GradientGallery
            selectedId={backgroundKind === "gradient" ? backgroundImageId : null}
            onSelect={(id) => void handleSelectGradient(id)}
          />
        )}

        {/* Custom tab */}
        {activeTab === "custom" && (
          <div className="flex items-center gap-2">
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
            {backgroundKind === "none" && activeTab === "custom" && (
              <span className="text-[11px] text-muted-foreground">No image selected</span>
            )}
          </div>
        )}

        {/* Controls — shown when any background is active */}
        {hasBackground && (
          <div className="flex flex-col gap-3 rounded border border-border/40 bg-card/30 p-3 pt-3">
            <SliderRow
              label="Opacity"
              value={backgroundOpacity}
              displayValue={`${Math.round(backgroundOpacity * 100)}%`}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => void setBackgroundOpacity(v)}
            />
            <SliderRow
              label="Blur"
              value={backgroundBlur}
              displayValue={`${backgroundBlur}px`}
              min={0}
              max={64}
              step={1}
              onChange={(v) => void setBackgroundBlur(v)}
            />

            {/* Tint */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] text-muted-foreground">Tint color</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={backgroundTintColor ?? "#000000"}
                    onChange={(e) => void setBackgroundTintColor(e.target.value)}
                    className="h-5 w-8 cursor-pointer rounded border border-border/50 bg-transparent p-0"
                  />
                  {backgroundTintColor && (
                    <button
                      type="button"
                      onClick={() => void setBackgroundTintColor(null)}
                      className="text-[10.5px] text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
              {backgroundTintColor && (
                <SliderRow
                  label="Tint opacity"
                  value={backgroundTintOpacity}
                  displayValue={`${Math.round(backgroundTintOpacity * 100)}%`}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(v) => void setBackgroundTintOpacity(v)}
                />
              )}
            </div>

            {/* Noise / grain */}
            <SliderRow
              label="Grain"
              value={backgroundNoiseOpacity}
              displayValue={backgroundNoiseOpacity === 0 ? "Off" : `${Math.round(backgroundNoiseOpacity * 100)}%`}
              min={0}
              max={0.5}
              step={0.01}
              onChange={(v) => void setBackgroundNoiseOpacity(v)}
            />

            {/* None button */}
            <div className="flex justify-end">
              <Button
                variant="ghost"
                className="h-6 rounded-none px-2 text-[11px] text-muted-foreground hover:text-destructive"
                onClick={() => void handleRemoveBg()}
              >
                Remove background
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
