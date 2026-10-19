import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { bindMediaPlayback } from "./lib/mediaPreview";

type Props = {
  kind: "video" | "audio";
  src: string;
  /** False while the tab is in the background or the window is minimised. */
  active: boolean;
};

/** A native video/audio preview that pauses and hides while inactive. */
export function MediaPreview({ kind, src, active }: Props) {
  const bindMedia = useCallback(
    (media: HTMLMediaElement | null) => {
      if (media) return bindMediaPlayback(media, active);
    },
    [active],
  );
  const Media = kind;
  return (
    // biome-ignore lint/a11y/useMediaCaption: local media preview, no caption track
    <Media ref={bindMedia} controls preload="metadata" className={cn(kind === "video" ? "max-h-full max-w-full" : "w-full max-w-md", !active && "hidden")} src={src} />
  );
}

/** True while the document is hidden (window minimised or on another desktop). */
export function useDocumentHidden(): boolean {
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return hidden;
}
