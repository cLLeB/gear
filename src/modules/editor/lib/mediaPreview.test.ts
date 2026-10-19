import { describe, expect, it, vi } from "vitest";
import { bindMediaPlayback } from "./mediaPreview";

describe("media playback lifecycle", () => {
  function mediaElement() {
    return Object.assign(new EventTarget(), {
      pause: vi.fn(),
      play: vi.fn(),
      currentTime: 42,
    });
  }

  it("pauses a preview that mounts while inactive and rejects later playback", () => {
    const media = mediaElement();
    const dispose = bindMediaPlayback(media, false);
    expect(media.pause).toHaveBeenCalledOnce();
    media.dispatchEvent(new Event("play"));
    expect(media.pause).toHaveBeenCalledTimes(2);
    expect(media.currentTime).toBe(42);
    dispose();
  });

  it("allows active playback and pauses when the preview closes", () => {
    const media = mediaElement();
    const dispose = bindMediaPlayback(media, true);
    media.dispatchEvent(new Event("play"));
    expect(media.pause).not.toHaveBeenCalled();
    dispose();
    expect(media.pause).toHaveBeenCalledOnce();
  });

  it("pauses on tab switch and requires explicit playback after returning", () => {
    const media = mediaElement();
    bindMediaPlayback(media, true)();
    const leaveHidden = bindMediaPlayback(media, false);
    expect(media.pause).toHaveBeenCalled();
    leaveHidden();
    const close = bindMediaPlayback(media, true);
    media.pause.mockClear();
    expect(media.play).not.toHaveBeenCalled();
    media.dispatchEvent(new Event("play"));
    expect(media.pause).not.toHaveBeenCalled();
    expect(media.currentTime).toBe(42);
    close();
  });

  it("removes the playback listener when an inactive preview is detached", () => {
    const media = mediaElement();
    const dispose = bindMediaPlayback(media, false);
    dispose();
    media.pause.mockClear();
    media.dispatchEvent(new Event("play"));
    expect(media.pause).not.toHaveBeenCalled();
  });
});
