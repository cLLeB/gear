import { describe, expect, it } from "vitest";
import {
  FEATURE_DEFAULTS,
  FEATURE_META,
  normalizeFeatureSettings,
  searchFeatureSettings,
} from "./featureSettings";

describe("normalizeFeatureSettings", () => {
  it("returns defaults for garbage input", () => {
    expect(normalizeFeatureSettings(null)).toEqual(FEATURE_DEFAULTS);
    expect(normalizeFeatureSettings([1, 2])).toEqual(FEATURE_DEFAULTS);
  });

  it("keeps well-typed values and drops wrong types", () => {
    const out = normalizeFeatureSettings({
      "terminal.notifyLongCommands": false,
      "terminal.notifyLongCommandsSeconds": "30",
      unknown: 1,
    });
    expect(out["terminal.notifyLongCommands"]).toBe(false);
    expect(out["terminal.notifyLongCommandsSeconds"]).toBe(FEATURE_DEFAULTS["terminal.notifyLongCommandsSeconds"]);
    expect("unknown" in out).toBe(false);
  });

  it("clamps numbers into their declared range", () => {
    const out = normalizeFeatureSettings({ "terminal.notifyLongCommandsSeconds": -5 });
    expect(out["terminal.notifyLongCommandsSeconds"]).toBe(FEATURE_META["terminal.notifyLongCommandsSeconds"].min);
  });
});

describe("FEATURE_META", () => {
  it("describes every default", () => {
    expect(Object.keys(FEATURE_META).sort()).toEqual(Object.keys(FEATURE_DEFAULTS).sort());
  });
});

describe("searchFeatureSettings", () => {
  it("matches every term against label, description and key", () => {
    const groups = searchFeatureSettings("notify threshold");
    const keys = groups.flatMap((g) => g.keys);
    expect(keys).toContain("terminal.notifyLongCommandsSeconds");
  });

  it("returns nothing for an unmatched query", () => {
    expect(searchFeatureSettings("zzzz-nothing")).toEqual([]);
  });
});
