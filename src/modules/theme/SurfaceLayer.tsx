import { useEffect, useState } from "react";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { getBgImage } from "./bgImageStore";

export const BG_OPACITY_RENDER_FACTOR = 0.5;

// Sets CSS vars on <html> that globals.css reads via html::before pseudo-element.
// This avoids z-index fights with the React tree and works in both windows.
export function SurfaceLayer() {
  const backgroundKind = usePreferencesStore((s) => s.backgroundKind);
  const backgroundOpacity = usePreferencesStore((s) => s.backgroundOpacity);
  const backgroundBlur = usePreferencesStore((s) => s.backgroundBlur);
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (backgroundKind === "image") {
      void getBgImage().then(setDataUrl);
    } else {
      setDataUrl(null);
    }
  }, [backgroundKind]);

  useEffect(() => {
    const html = document.documentElement;
    const active = backgroundKind === "image" && !!dataUrl;
    if (active) {
      const opacity = (backgroundOpacity * BG_OPACITY_RENDER_FACTOR).toFixed(3);
      html.setAttribute("data-bg", "on");
      html.style.setProperty("--_bg-url", `url(${JSON.stringify(dataUrl)})`);
      html.style.setProperty("--_bg-opacity", opacity);
      html.style.setProperty("--_bg-blur", `${backgroundBlur}px`);
    } else {
      html.removeAttribute("data-bg");
      html.style.removeProperty("--_bg-url");
      html.style.removeProperty("--_bg-opacity");
      html.style.removeProperty("--_bg-blur");
    }
    return () => {
      html.removeAttribute("data-bg");
      html.style.removeProperty("--_bg-url");
      html.style.removeProperty("--_bg-opacity");
      html.style.removeProperty("--_bg-blur");
    };
  }, [backgroundKind, dataUrl, backgroundOpacity, backgroundBlur]);

  return null;
}
