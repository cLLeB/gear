import { afterEach, describe, expect, it, vi } from "vitest";

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn() }));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

import { createTerminalLinkHandler } from "./terminalLinks";

describe("createTerminalLinkHandler", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("opens OSC 8 links natively and restores late-bound terminal focus", async () => {
    openUrl.mockResolvedValue(undefined);
    const initialFocus = vi.fn();
    let focus = initialFocus;
    const handler = createTerminalLinkHandler(() => focus());
    focus = vi.fn();

    handler.activate({} as MouseEvent, "https://example.com/settings/usage");

    expect(openUrl).toHaveBeenCalledWith("https://example.com/settings/usage");
    await vi.waitFor(() => expect(focus).toHaveBeenCalledOnce());
    expect(initialFocus).not.toHaveBeenCalled();
  });

  it("refuses a disallowed scheme from an OSC 8 hyperlink but still refocuses", async () => {
    const focus = vi.fn();
    const handler = createTerminalLinkHandler(focus);

    handler.activate({} as MouseEvent, "file:///etc/passwd");

    expect(openUrl).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(focus).toHaveBeenCalledOnce());
  });
});
