import { useEffect, useMemo, useState } from "react";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { getBgImage } from "./bgImageStore";
import { getWallpaperById, getWallpaperUrl } from "./builtinWallpapers";
import { getGradientById } from "./builtinGradients";

export const BG_OPACITY_RENDER_FACTOR = 0.5;

// SVG feTurbulence noise — encoded as data URL for film grain overlay
const NOISE_DATA_URL =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)'/%3E%3C/svg%3E\")";

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return `rgba(0,0,0,${alpha})`;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})`;
}

export function SurfaceLayer() {
  const backgroundKind = usePreferencesStore((s) => s.backgroundKind);
  const backgroundImageId = usePreferencesStore((s) => s.backgroundImageId);
  const backgroundOpacity = usePreferencesStore((s) => s.backgroundOpacity);
  const backgroundBlur = usePreferencesStore((s) => s.backgroundBlur);
  const backgroundTintColor = usePreferencesStore((s) => s.backgroundTintColor);
  const backgroundTintOpacity = usePreferencesStore((s) => s.backgroundTintOpacity);
  const backgroundNoiseOpacity = usePreferencesStore((s) => s.backgroundNoiseOpacity);
  const [customDataUrl, setCustomDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (backgroundKind === "image") {
      void getBgImage().then(setCustomDataUrl);
    } else {
      setCustomDataUrl(null);
    }
  }, [backgroundKind]);

  const { bgValue, isActive } = useMemo(() => {
    if (backgroundKind === "image" && customDataUrl) {
      return { bgValue: `url(${JSON.stringify(customDataUrl)})`, isActive: true };
    }
    if (backgroundKind === "builtin" && backgroundImageId) {
      const wp = getWallpaperById(backgroundImageId);
      if (wp) return { bgValue: `url(${JSON.stringify(getWallpaperUrl(wp.file))})`, isActive: true };
    }
    if (backgroundKind === "gradient" && backgroundImageId) {
      const grad = getGradientById(backgroundImageId);
      if (grad) return { bgValue: grad.css, isActive: true };
    }
    return { bgValue: null, isActive: false };
  }, [backgroundKind, backgroundImageId, customDataUrl]);

  // Set CSS vars on <html> for the ::before pseudo-element (background layer)
  useEffect(() => {
    const html = document.documentElement;
    if (isActive && bgValue) {
      const opacity = (backgroundOpacity * BG_OPACITY_RENDER_FACTOR).toFixed(3);
      html.setAttribute("data-bg", "on");
      html.style.setProperty("--_bg-url", bgValue);
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
  }, [isActive, bgValue, backgroundOpacity, backgroundBlur]);

  const tintRgba =
    isActive && backgroundTintColor && backgroundTintOpacity > 0
      ? hexToRgba(backgroundTintColor, backgroundTintOpacity)
      : null;

  const showNoise = isActive && backgroundNoiseOpacity > 0;

  return (
    <>
      {tintRgba && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10000,
            pointerEvents: "none",
            backgroundColor: tintRgba,
          }}
        />
      )}
      {showNoise && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10001,
            pointerEvents: "none",
            backgroundImage: NOISE_DATA_URL,
            backgroundRepeat: "repeat",
            backgroundSize: "200px 200px",
            opacity: backgroundNoiseOpacity,
            mixBlendMode: "overlay",
          }}
        />
      )}
    </>
  );
}
