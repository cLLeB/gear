import { describe, expect, it } from "vitest";
import { Frecency, quickOpen } from "./quickOpen";

describe("quickOpen ranking", () => {
  it("ranks a basename match above a path-only match", () => {
    const paths = ["app/user.ts", "user/config.ts"];
    const results = quickOpen("user", paths);
    expect(results[0].path).toBe("app/user.ts");
  });

  it("filters out non-matching paths", () => {
    const paths = ["src/index.ts", "README.md"];
    const results = quickOpen("xyz", paths);
    expect(results).toEqual([]);
  });

  it("returns highlight positions that index into the full path", () => {
    const [result] = quickOpen("user", ["app/user.ts"]);
    for (const p of result.positions) {
      expect("app/user.ts"[p]).toBeDefined();
    }
    // The matched characters spell the query.
    expect(result.positions.map((p) => "app/user.ts"[p]).join("")).toBe("user");
  });

  it("breaks ties by frecency", () => {
    const frecency = new Frecency();
    const now = 1_000_000_000_000;
    frecency.visit("b/config.ts", now);
    frecency.visit("b/config.ts", now);
    const results = quickOpen("config", ["a/config.ts", "b/config.ts"], frecency, now);
    expect(results[0].path).toBe("b/config.ts");
  });
});

describe("Frecency", () => {
  it("orders by frecency when the query is empty", () => {
    const frecency = new Frecency();
    const now = 1_000_000_000_000;
    frecency.visit("rare.ts", now - 40 * 24 * 60 * 60 * 1000); // old, 1 visit
    frecency.visit("hot.ts", now);
    frecency.visit("hot.ts", now);
    const results = quickOpen("", ["rare.ts", "hot.ts"], frecency, now);
    expect(results.map((r) => r.path)).toEqual(["hot.ts", "rare.ts"]);
  });

  it("weights recent visits more heavily than old ones", () => {
    const frecency = new Frecency();
    const now = 1_000_000_000_000;
    frecency.visit("recent.ts", now);
    frecency.visit("stale.ts", now - 40 * 24 * 60 * 60 * 1000);
    expect(frecency.score("recent.ts", now)).toBeGreaterThan(frecency.score("stale.ts", now));
  });
});
