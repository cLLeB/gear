// Video and audio previews keep playing — and their hardware-composited native
// controls can draw over other tabs — when their tab is in the background.
// A preview that is not active is paused and refuses to start again until it
// is active; leaving keeps the position, and coming back never auto-plays.

type MediaPlayback = Pick<HTMLMediaElement, "pause" | "addEventListener" | "removeEventListener">;

/** Pauses `media` while inactive (and on detach); returns the cleanup. */
export function bindMediaPlayback(media: MediaPlayback, active: boolean): () => void {
  const pause = () => media.pause();
  if (!active) {
    pause();
    media.addEventListener("play", pause);
  }
  return () => {
    media.removeEventListener("play", pause);
    pause();
  };
}
