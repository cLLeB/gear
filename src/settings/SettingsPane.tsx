import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { SettingsTab } from "@/modules/settings/openSettingsWindow";
import {
  AiScanIcon,
  InformationCircleIcon,
  PaintBoardIcon,
  UserMultiple02Icon,
  PlayIcon,
  KeyboardIcon,
  SlidersHorizontalIcon,
  ToggleOnIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type JSX, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AboutSection } from "./sections/AboutSection";
import { AgentsSection } from "./sections/AgentsSection";
import { FeaturesSection } from "./sections/FeaturesSection";
import { GeneralSection } from "./sections/GeneralSection";
import { ModelsSection } from "./sections/ModelsSection";
import { RunSection } from "./sections/RunSection";
import { ShortcutsSection } from "./sections/ShortcutsSection";
import { ThemesSection } from "./sections/ThemesSection";

const TAB_DEFS: {
  id: SettingsTab;
  labelKey: string;
  icon: typeof SlidersHorizontalIcon;
  component: () => JSX.Element;
}[] = [
  { id: "general",   labelKey: "settings.tabs.general",   icon: SlidersHorizontalIcon, component: GeneralSection },
  { id: "themes",    labelKey: "settings.tabs.themes",    icon: PaintBoardIcon,       component: ThemesSection },
  { id: "shortcuts", labelKey: "settings.tabs.shortcuts", icon: KeyboardIcon,         component: ShortcutsSection },
  { id: "features",  labelKey: "settings.tabs.features",  icon: ToggleOnIcon,        component: FeaturesSection },
  { id: "run",       labelKey: "settings.tabs.run",       icon: PlayIcon,             component: RunSection },
  { id: "models",    labelKey: "settings.tabs.models",    icon: AiScanIcon,           component: ModelsSection },
  { id: "agents",    labelKey: "settings.tabs.agents",    icon: UserMultiple02Icon,   component: AgentsSection },
  { id: "about",     labelKey: "settings.tabs.about",     icon: InformationCircleIcon, component: AboutSection },
];

const VALID_TABS: SettingsTab[] = TAB_DEFS.map((t) => t.id);

function toValidTab(s?: string): SettingsTab {
  if (s && (VALID_TABS as string[]).includes(s)) return s as SettingsTab;
  return "general";
}

interface SettingsPaneProps {
  section?: string;
  onSectionChange?: (section: string) => void;
}

export function SettingsPane({ section, onSectionChange }: SettingsPaneProps) {
  const { t } = useTranslation();
  const [active, setActive] = useState<SettingsTab>(() => toValidTab(section));
  const init = usePreferencesStore((s) => s.init);

  useEffect(() => { void init(); }, [init]);

  // Sync when parent navigates to a specific section (e.g. "models" deep-link).
  useEffect(() => {
    if (section) setActive(toValidTab(section));
  }, [section]);

  const TABS = TAB_DEFS.map((tab) => ({ ...tab, label: t(tab.labelKey) }));
  const ActiveSection = TABS.find((tab) => tab.id === active)?.component;

  const handleSelect = (id: SettingsTab) => {
    setActive(id);
    onSectionChange?.(id);
  };

  return (
    // Sized by the pane, not the window: a split or a restored window narrows
    // it. Below ~860px the nav folds to icons and the padding tightens, so the
    // section keeps the room.
    <div className="@container/settings h-full min-w-0">
      <div className="flex h-full overflow-hidden bg-background/50 backdrop-blur-xl text-foreground select-none rounded-xl border border-border/40 shadow-xl m-2 @4xl/settings:m-4" data-settings-pane>
        {/* Left nav */}
        <nav className="w-14 shrink-0 overflow-y-auto border-r border-border/40 bg-card/40 py-4 px-2 flex flex-col gap-1.5 @4xl/settings:w-56 @4xl/settings:py-6 @4xl/settings:px-3" data-settings-nav>
          <div className="px-3 mb-2 hidden items-center @4xl/settings:flex">
            <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Settings</h2>
          </div>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleSelect(tab.id)}
              title={tab.label}
              aria-label={tab.label}
              aria-current={active === tab.id ? "page" : undefined}
              className={cn(
                "flex items-center justify-center gap-3 px-2 py-2.5 rounded-lg text-[13px] transition-all font-medium @4xl/settings:justify-start @4xl/settings:px-3",
                active === tab.id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
              )}
            >
              <HugeiconsIcon icon={tab.icon} size={16} strokeWidth={active === tab.id ? 2.5 : 1.75} className="shrink-0" />
              <span className="hidden @4xl/settings:inline">{tab.label}</span>
            </button>
          ))}
        </nav>

        {/* Content */}
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-3 pb-6 @3xl/settings:px-10 @3xl/settings:pt-8 @3xl/settings:pb-10 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="mx-auto w-full max-w-3xl bg-card rounded-2xl p-5 border border-border/30 shadow-sm @3xl/settings:p-8">
            {ActiveSection && <ActiveSection />}
          </div>
        </main>
      </div>
    </div>
  );
}
