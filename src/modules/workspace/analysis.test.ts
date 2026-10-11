import { describe, expect, it } from "vitest";
import { buildCallGraph } from "@/lib/lang/callGraph";
import {
  applyEdits,
  buildImportGraph,
  concatSources,
  cyclePath,
  exportedNames,
  extractFunction,
  importCycles,
  importersOf,
  inlineVariable,
  langIdForPath,
  parseChurn,
  rankHotspots,
  renderCallGraph,
  transitiveImports,
  unusedExports,
} from "./analysis";

const files = [
  { path: "/r/src/a.ts", source: 'import { b } from "./b";\nexport const a = 1;\nexport function used() {}\n' },
  { path: "/r/src/b.ts", source: 'import { c } from "@/c";\nexport { x as b, y };\n' },
  { path: "/r/src/c.ts", source: 'import { a, used } from "./a";\nused();\n' },
  { path: "/r/src/d.ts", source: 'import "./c";\n' },
];

describe("import graph", () => {
  it("resolves, reverses and finds cycles", () => {
    const g = buildImportGraph(files, "/r");
    expect([...g.get("/r/src/a.ts")!]).toEqual(["/r/src/b.ts"]);
    expect([...g.get("/r/src/b.ts")!]).toEqual(["/r/src/c.ts"]);
    expect(importersOf(g, "/r/src/c.ts")).toEqual(["/r/src/b.ts", "/r/src/d.ts"]);
    expect(transitiveImports(g, "/r/src/d.ts")).toEqual(["/r/src/a.ts", "/r/src/b.ts", "/r/src/c.ts"]);
    const cycles = importCycles(g);
    expect(cycles).toEqual([["/r/src/a.ts", "/r/src/b.ts", "/r/src/c.ts"]]);
    expect(cyclePath(g, cycles[0])).toEqual(["/r/src/a.ts", "/r/src/b.ts", "/r/src/c.ts", "/r/src/a.ts"]);
  });

  it("maps languages", () => {
    expect(langIdForPath("x/y.tsx")).toBe("javascript");
    expect(langIdForPath("m.py")).toBe("python");
    expect(langIdForPath("Main.java")).toBe("c");
    expect(langIdForPath("README.md")).toBeNull();
  });
});

describe("exports", () => {
  it("lists exported names", () => {
    expect(exportedNames(files[1].source).map((e) => e.name)).toEqual(["b", "y"]);
    expect(exportedNames("export default async function main() {}\nexport type T = 1;").map((e) => e.name)).toEqual(["main", "T"]);
  });

  it("finds unused exports", () => {
    expect(unusedExports(files).map((u) => `${u.path}:${u.name}`)).toEqual(["/r/src/b.ts:y"]);
  });
});

describe("hotspots", () => {
  it("parses churn and ranks", () => {
    const churn = parseChurn("a.ts\nb.ts\n\na.ts\n");
    expect(churn.get("a.ts")).toBe(2);
    const r = rankHotspots([
      { path: "a.ts", complexity: 10, churn: 2 },
      { path: "b.ts", complexity: 40, churn: 1 },
      { path: "c.ts", complexity: 5, churn: 0 },
    ]);
    expect(r.map((x) => x.path)).toEqual(["b.ts", "a.ts"]);
    expect(r[0].score).toBe(50);
  });
});

describe("concat", () => {
  it("maps offsets back to files", () => {
    const c = concatSources([{ path: "a", source: "x\ny" }, { path: "b", source: "z" }]);
    expect(c.locate(2)).toEqual({ path: "a", line: 2 });
    expect(c.locate(c.source.indexOf("z"))).toEqual({ path: "b", line: 1 });
  });
});

describe("call graph", () => {
  it("renders mermaid and an outline", () => {
    const out = renderCallGraph(buildCallGraph("function a() { b(); }\nfunction b() {}\n", "javascript"));
    expect(out).toContain("a[a] --> b[b]");
    expect(out).toContain("- **b**  _(called by a)_");
  });
});

describe("extract function", () => {
  it("extracts statements with params and returns (JS)", () => {
    const src = "function main(items) {\n  const k = 2;\n  const total = items.length * k;\n  const msg = `n=${total}`;\n  console.log(msg);\n}\n";
    const from = src.indexOf("const total");
    const to = src.indexOf("\n  console");
    const out = applyEdits(src, extractFunction(src, "javascript", from, to, "describeItems"));
    expect(out).toBe(
      "function describeItems(items, k) {\n  const total = items.length * k;\n  const msg = `n=${total}`;\n  return msg;\n}\n\nfunction main(items) {\n  const k = 2;\n  const msg = describeItems(items, k);\n  console.log(msg);\n}\n",
    );
  });

  it("extracts an expression", () => {
    const src = "function f(a, b) {\n  return a * b + 1;\n}\n";
    const from = src.indexOf("a * b");
    const out = applyEdits(src, extractFunction(src, "javascript", from, from + "a * b + 1".length, "calc"));
    expect(out).toBe("function calc(a, b) {\n  return a * b + 1;\n}\n\nfunction f(a, b) {\n  return calc(a, b);\n}\n");
  });

  it("extracts Python", () => {
    const src = "def main(xs):\n    n = len(xs)\n    avg = sum(xs) / n\n    print(avg)\n";
    const from = src.indexOf("avg =");
    const to = src.indexOf("\n    print");
    const out = applyEdits(src, extractFunction(src, "python", from, to, "mean"));
    expect(out).toContain("def mean(xs, n):\n    avg = sum(xs) / n\n    return avg\n");
    expect(out).toContain("    avg = mean(xs, n)\n    print(avg)");
  });

  it("refuses returns", () => {
    expect(() => extractFunction("function f(){ return 1; }", "javascript", 13, 22, "g")).toThrow(/return/);
  });
});

describe("inline variable", () => {
  it("inlines into each use", () => {
    const src = "function f(a) {\n  const s = a + 1;\n  return s * s;\n}\n";
    const out = applyEdits(src, inlineVariable(src, "javascript", src.indexOf("s =")));
    expect(out).toBe("function f(a) {\n  return (a + 1) * (a + 1);\n}\n");
    const simple = "const url = base.url;\nfetch(url);\n";
    expect(applyEdits(simple, inlineVariable(simple, "javascript", simple.indexOf("url)")))).toBe("fetch(base.url);\n");
  });

  it("refuses reassigned variables", () => {
    const src = "let n = 1;\nn += 2;\nuse(n);\n";
    expect(() => inlineVariable(src, "javascript", 4)).toThrow(/reassigned/);
  });
});
