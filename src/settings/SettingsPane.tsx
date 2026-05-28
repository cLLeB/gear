import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { SettingsTab } from "@/modules/settings/openSettingsWindow";
import {
  AiScanIcon,
  InformationCircleIcon,
  PaintBoardIcon,
  Settings01Icon,
  UserMultiple02Icon,
  KeyboardIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type JSX, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AboutSection } from "./sections/AboutSection";
import { AgentsSection } from "./sections/AgentsSection";
import { GeneralSection } from "./sections/GeneralSection";
import { ModelsSection } from "./sections/ModelsSection";
import { ShortcutsSection } from "./sections/ShortcutsSection";
import { ThemesSection } from "./sections/ThemesSection";

const TAB_DEFS: {
  id: SettingsTab;
  labelKey: string;
  icon: typeof Settings01Icon;
  component: () => JSX.Element;
}[] = [
  { id: "general",   labelKey: "settings.tabs.general",   icon: Settings01Icon,      component: GeneralSection },
  { id: "themes",    labelKey: "settings.tabs.themes",    icon: PaintBoardIcon,       component: ThemesSection },
  { id: "shortcuts", labelKey: "settings.tabs.shortcuts", icon: KeyboardIcon,         component: ShortcutsSection },
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
    <div className="flex h-full overflow-hidden bg-background text-foreground select-none">
      {/* Left nav */}
      <nav className="w-48 shrink-0 overflow-y-auto border-r border-border/60 bg-card/40 py-3">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleSelect(tab.id)}
            className={cn(
              "flex w-full items-center gap-2.5 px-4 py-1.5 text-left text-[13px] transition-colors",
              active === tab.id
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
            )}
          >
            <HugeiconsIcon icon={tab.icon} size={14} strokeWidth={1.75} className="shrink-0" />
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Right content */}
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-8 pt-6 pb-7 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="mx-auto w-full max-w-160">
          {ActiveSection && <ActiveSection />}
        </div>
      </main>
    </div>
  );
}
