import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/appBridge", () => ({ app: () => ({}) }));

const { tabsByRecency } = await import("./tabActions");

describe("tabsByRecency", () => {
  it("orders by activation, unseen tabs last in tab order", () => {
    const tabs = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    expect(tabsByRecency(tabs, [3, 1]).map((t) => t.id)).toEqual([3, 1, 2, 4]);
  });
});
