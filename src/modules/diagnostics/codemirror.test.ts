import { describe, expect, it } from "vitest";
import { diagnosticsToCm } from "./codemirror";
import type { Diagnostic } from "./engine";

const base: Diagnostic = { from: 2, to: 5, severity: "error", message: "boom", source: "gear", code: "x" };

describe("diagnosticsToCm", () => {
  it("maps core fields and clamps to the document", () => {
    const [cm] = diagnosticsToCm([{ ...base, from: 0, to: 999 }], 10);
    expect(cm).toMatchObject({ from: 0, to: 10, severity: "error", message: "boom" });
  });

  it("annotates the source with the code", () => {
    const [cm] = diagnosticsToCm([base], 100);
    expect(cm.source).toBe("gear (x)");
  });

  it("keeps from <= to after clamping", () => {
    const [cm] = diagnosticsToCm([{ ...base, from: 50, to: 5 }], 20);
    expect(cm.from).toBeLessThanOrEqual(cm.to);
  });

  it("exposes quick-fix actions when fixes are present", () => {
    const withFix: Diagnostic = { ...base, fixes: [{ title: "Fix it", edits: [{ from: 2, to: 5, insert: "x" }] }] };
    const [cm] = diagnosticsToCm([withFix], 100);
    expect(cm.actions?.[0].name).toBe("Fix it");
  });

  it("omits actions when there are no fixes", () => {
    const [cm] = diagnosticsToCm([base], 100);
    expect(cm.actions).toBeUndefined();
  });
});
