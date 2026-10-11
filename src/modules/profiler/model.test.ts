import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { focusFunction, functionStats, hotPath, parseCollapsed, parseProfile } from "./model";

const fx = (n: string) => readFileSync(join(__dirname, "__fixtures__", n), "utf8");
const names = (p: ReturnType<typeof hotPath>) => p.map((n) => n.frame.name);

describe("real profiles", () => {
  it("reads a Node .cpuprofile", () => {
    const p = parseProfile(fx("work.cpuprofile"), "work.cpuprofile");
    expect(p.unit).toBe("ms");
    expect(p.root.total).toBeGreaterThan(50);
    const stats = functionStats(p);
    const fib = stats.find((s) => s.frame.name === "fib")!;
    expect(fib.frame.file).toBe("/project/work.js");
    expect(fib.frame.line).toBe(1);
    // fib recurses deeply; its total is counted once, so it can't exceed main's.
    const main = stats.find((s) => s.frame.name === "main")!;
    expect(fib.total).toBeLessThanOrEqual(main.total + 1e-6);
    expect(fib.calls).toBeGreaterThan(5);
    expect(names(hotPath(p, 0.3))).toContain("main");
  });

  it("reads py-spy speedscope and raw output", () => {
    const s = parseProfile(fx("work.speedscope.json"), "work.speedscope.json");
    const r = parseProfile(fx("work.folded"), "work.folded");
    for (const p of [s, r]) {
      const hot = names(hotPath(p));
      expect(hot.slice(0, 4)).toEqual(["<module>", "main", "busy", "fib"]);
      const fib = functionStats(p).find((x) => x.frame.name === "fib")!;
      expect(fib.frame.file).toMatch(/work\.py$/);
      expect(fib.frame.line).toBe(1);
      expect(fib.self).toBeGreaterThan(0);
    }
  });
});

describe("collapsed stacks", () => {
  it("merges stacks, sorts children and focuses on a function", () => {
    const p = parseCollapsed("main;a;c 3\nmain;b;c 5\nmain;a 2\nmain;b;c 1\n");
    expect(p.root.total).toBe(11);
    expect(p.root.children[0].children.map((c) => `${c.frame.name}:${c.total}`)).toEqual(["b:6", "a:5"]);
    const c = functionStats(p).find((s) => s.frame.name === "c")!;
    expect(c).toMatchObject({ self: 9, total: 9, calls: 2 });
    const f = focusFunction(p, `c\u0000`);
    expect(f.root.children.map((n) => `${n.frame.name}:${n.total}`)).toEqual(["c:9"]);
    expect(parseCollapsed("fn (app.py:12);inner [lib.rs:3] 4").root.children[0].frame).toEqual({ name: "fn", file: "app.py", line: 12 });
  });
});
