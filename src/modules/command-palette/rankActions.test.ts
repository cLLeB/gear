import { TerminalIcon } from "@hugeicons/core-free-icons";
import { describe, expect, it } from "vitest";
import type { CommandPaletteAction } from "./actions";
import { rankActions, recentActions } from "./rankActions";

const action = (id: string, label: string, extra: Partial<CommandPaletteAction> = {}): CommandPaletteAction => ({
  id,
  label,
  group: "General",
  keywords: [],
  icon: TerminalIcon,
  run: () => {},
  ...extra,
});

const actions = [
  action("split.right", "Split pane right"),
  action("split.down", "Split pane down"),
  action("settings", "Open settings", { keywords: ["preferences"] }),
  action("disabled", "Split everything", { disabledReason: "nope" }),
];

describe("rankActions", () => {
  it("matches fuzzily across label words", () => {
    const ids = rankActions(actions, "spd", []).map((r) => r.action.id);
    expect(ids[0]).toBe("split.down");
  });

  it("falls back to keywords", () => {
    expect(rankActions(actions, "prefs", []).map((r) => r.action.id)).toEqual(["settings"]);
  });

  it("lets recency break near-ties", () => {
    const withoutRecent = rankActions(actions, "split pane", []).map((r) => r.action.id);
    const second = withoutRecent[1];
    const withRecent = rankActions(actions, "split pane", [second]).map((r) => r.action.id);
    expect(withRecent[0]).toBe(second);
  });

  it("sinks disabled actions", () => {
    const ids = rankActions(actions, "split", []).map((r) => r.action.id);
    expect(ids[ids.length - 1]).toBe("disabled");
  });
});

describe("recentActions", () => {
  it("keeps recency order and skips missing or disabled ids", () => {
    expect(recentActions(actions, ["gone", "disabled", "settings", "split.right"]).map((a) => a.id)).toEqual([
      "settings",
      "split.right",
    ]);
  });
});
