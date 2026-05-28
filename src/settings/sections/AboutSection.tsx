import { Button } from "@/components/ui/button";
import { useUpdater } from "@/modules/updater";
import { GithubIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { getName } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SectionHeader } from "../components/SectionHeader";

const REPO_URL = "https://github.com/cLLeB/gear";
const WEBSITE_URL = "https://gear.kyere.me";

export function AboutSection() {
  const { t } = useTranslation();
  const [name, setName] = useState("Gear");
  const [isStore, setIsStore] = useState(false);
  const { status, check, install } = useUpdater({ autoCheck: false });
  const checking = status.kind === "checking";
  const downloading = status.kind === "downloading";
  const available = status.kind === "available";
  const manualAvailable = status.kind === "manual-available";
  const ready = status.kind === "ready";
  const checkLabel =
    status.kind === "uptodate"
      ? t("settings.about.upToDate")
      : status.kind === "error"
        ? t("settings.about.checkFailed")
        : checking
          ? t("settings.about.checking")
          : downloading
            ? t("settings.about.downloading")
            : ready
              ? t("settings.about.restartToInstall")
              : available
                ? t("settings.about.installVersion", { version: status.update.version })
                : manualAvailable
                  ? t("settings.about.updateVersion", { version: status.info.version })
                  : t("settings.about.checkForUpdates");
  const onUpdateClick = () => {
    if (available) void install();
    else void check({ manual: true });
  };

  useEffect(() => {
    void getName().then(setName);
    void invoke<boolean>("is_store_build").then(setIsStore);
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title={t("settings.about.title")} description="" />

      <div className="flex items-center gap-4 rounded-xl border border-border/60 bg-card/60 p-5">
        <img src="/logo.png" alt="" className="size-12" draggable={false} />
        <div className="flex min-w-0 flex-col">
          <span className="text-[15px] font-semibold tracking-tight">
            {name}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {t("settings.about.tagline")}
          </span>
        </div>
      </div>

      <dl className="grid grid-cols-[110px_1fr] gap-y-2.5 text-[12px]">
        <dt className="text-muted-foreground">{t("settings.about.sourceCode")}</dt>
        <dd>
          <button
            type="button"
            onClick={() => void openUrl(REPO_URL)}
            className="inline-flex items-center gap-1.5 rounded-md text-[12px] underline-offset-2 hover:text-foreground hover:underline"
          >
            <HugeiconsIcon icon={GithubIcon} size={12} strokeWidth={1.75} />
            cLLeB/gear
          </button>
        </dd>

        <dt className="text-muted-foreground">{t("settings.about.website")}</dt>
        <dd>
          <button
            type="button"
            onClick={() => void openUrl(WEBSITE_URL)}
            className="inline-flex items-center gap-1.5 rounded-md text-[12px] underline-offset-2 hover:text-foreground hover:underline"
          >
            gear.kyere.me
          </button>
        </dd>
      </dl>

      <div className="flex flex-col gap-1.5">
        <div className="flex gap-2">
          {!isStore && (
            <Button
              size="sm"
              onClick={onUpdateClick}
              disabled={checking || downloading || ready}
            >
              {checkLabel}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void openUrl(REPO_URL)}
            className="gap-1.5"
          >
            <HugeiconsIcon icon={GithubIcon} size={12} strokeWidth={1.75} />
            {t("settings.about.viewOnGithub")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void openUrl(`${REPO_URL}/issues/new`)}
          >
            {t("settings.about.reportIssue")}
          </Button>
        </div>
        {!isStore && status.kind === "error" && (
          <p className="font-mono text-[10.5px] break-all text-destructive/80">
            {status.message}
          </p>
        )}
        {!isStore && downloading && status.contentLength ? (
          <p className="text-[11px] text-muted-foreground">
            {Math.min(
              100,
              Math.round((status.downloaded / status.contentLength) * 100),
            )}
            %
          </p>
        ) : null}
      </div>
    </div>
  );
}
