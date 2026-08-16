import { describe, expect, it } from "vitest";
import { isProjectTrusted, planRunLayers, withTrustedProject } from "./trust";
import type { RunConfig } from "./types";

const PROJECT: RunConfig[] = [
  { id: "dev", name: "Dev", command: "npm run dev" },
];
const SETTINGS: RunConfig[] = [
  { id: "poetry", name: "Poetry", command: "poetry run python {file}", extensions: ["py"] },
];

describe("isProjectTrusted", () => {
  it("trusts a root that was approved", () => {
    expect(isProjectTrusted("/w", ["/w"])).toBe(true);
  });

  it("does not trust an unapproved root", () => {
    expect(isProjectTrusted("/w", ["/other"])).toBe(false);
  });

  it("ignores separator style and trailing slashes", () => {
    expect(isProjectTrusted("C:\\w\\proj", ["C:/w/proj/"])).toBe(true);
  });

  it("does not trust a parent's approval for a sibling", () => {
    expect(isProjectTrusted("/w/proj-evil", ["/w/proj"])).toBe(false);
  });

  it("does not trust a subdirectory of an approved root", () => {
    // Approval is per workspace root; a nested repo gets asked separately.
    expect(isProjectTrusted("/w/proj/vendor", ["/w/proj"])).toBe(false);
  });

  it("treats a null root as untrusted", () => {
    expect(isProjectTrusted(null, ["/w"])).toBe(false);
  });
});

describe("withTrustedProject", () => {
  it("adds a normalised root", () => {
    expect(withTrustedProject(["/a"], "C:\\w\\")).toEqual(["/a", "C:/w"]);
  });

  it("does not duplicate an already-trusted root", () => {
    expect(withTrustedProject(["/w"], "/w/")).toEqual(["/w"]);
  });

  it("returns a new array rather than mutating the input", () => {
    const before = ["/a"];
    const after = withTrustedProject(before, "/b");
    expect(before).toEqual(["/a"]);
    expect(after).not.toBe(before);
  });
});

describe("planRunLayers", () => {
  it("includes project configs once the root is trusted", () => {
    const plan = planRunLayers({
      projectConfigs: PROJECT,
      settingsConfigs: SETTINGS,
      workspaceRoot: "/w",
      trustedRoots: ["/w"],
    });
    expect(plan.layers.project).toEqual(PROJECT);
    expect(plan.needsTrust).toBe(false);
  });

  it("withholds project configs until the root is trusted", () => {
    const plan = planRunLayers({
      projectConfigs: PROJECT,
      settingsConfigs: SETTINGS,
      workspaceRoot: "/w",
      trustedRoots: [],
    });
    expect(plan.layers.project).toEqual([]);
    expect(plan.needsTrust).toBe(true);
  });

  it("still offers settings and presets while trust is pending", () => {
    const plan = planRunLayers({
      projectConfigs: PROJECT,
      settingsConfigs: SETTINGS,
      workspaceRoot: "/w",
      trustedRoots: [],
    });
    expect(plan.layers.settings).toEqual(SETTINGS);
  });

  it("does not ask for trust when the project declares no run configs", () => {
    const plan = planRunLayers({
      projectConfigs: [],
      settingsConfigs: SETTINGS,
      workspaceRoot: "/w",
      trustedRoots: [],
    });
    expect(plan.needsTrust).toBe(false);
  });

  it("does not ask for trust when there is no workspace root", () => {
    const plan = planRunLayers({
      projectConfigs: PROJECT,
      settingsConfigs: [],
      workspaceRoot: null,
      trustedRoots: [],
    });
    expect(plan.needsTrust).toBe(false);
    expect(plan.layers.project).toEqual([]);
  });
});
