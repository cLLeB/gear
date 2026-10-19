import { describe, expect, it } from "vitest";
import { attribute, cleanSource, decodeMappings, duplicates, groupByPackage, mapUrlOf, packageOf, type SourceMap } from "./model";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function vlq(n: number): string {
  let v = n < 0 ? (-n << 1) | 1 : n << 1;
  let out = "";
  do {
    let d = v & 31;
    v >>>= 5;
    if (v) d |= 32;
    out += B64[d];
  } while (v);
  return out;
}
/** Mappings from [generatedColumn, source] pairs per line (deltas computed here). */
function mappings(lines: [number, number][][]): string {
  let src = 0;
  return lines
    .map((segs) => {
      let col = 0;
      return segs
        .map(([c, s]) => {
          const out = vlq(c - col) + (s >= 0 ? vlq(s - src) + vlq(0) + vlq(0) : "");
          col = c;
          if (s >= 0) src = s;
          return out;
        })
        .join(",");
    })
    .join(";");
}

describe("bundle analyzer", () => {
  it("decodes VLQ mappings", () => {
    expect(vlq(0)).toBe("A");
    expect(vlq(-1)).toBe("D");
    expect(vlq(16)).toBe("gB");
    const m = mappings([[[0, 0], [5, 1]], [], [[3, 0], [9, -1]]]);
    expect(decodeMappings(m)).toEqual([
      [{ column: 0, source: 0 }, { column: 5, source: 1 }],
      [],
      [{ column: 3, source: 0 }, { column: 9, source: -1 }],
    ]);
    expect(decodeMappings("AAAA,EAAE,E")).toEqual([[{ column: 0, source: 0 }, { column: 2, source: 0 }, { column: 4, source: -1 }]]);
    expect(() => decodeMappings("A!")).toThrow(/damaged/);
  });

  it("attributes every byte to a source", () => {
    // line 0: "aaaaaBBB" -> a.js 0..5, b.js 5..8 (+ newline)
    // line 1: "/*glue*/" -> no segments: unmapped
    // line 2: "xxxCCCCCC" -> unmapped 0..3, a.js 3..9
    const code = "aaaaaBBB\n/*glue*/\nxxxCCCCCC";
    const map: SourceMap = { version: 3, sources: ["src/a.js", "node_modules/b/index.js"], mappings: mappings([[[0, 0], [5, 1]], [], [[3, 0]]]) };
    const a = attribute(code, map);
    expect(Object.fromEntries(a.bySource)).toEqual({ "src/a.js": 5 + 6, "node_modules/b/index.js": 3 + 1 });
    expect(a.total).toBe(code.length);
    expect(a.unmapped).toBe(code.length - 15);
    // Multi-byte characters count as UTF-8.
    expect(attribute("é", { version: 3, sources: ["x"], mappings: "AAAA" }).bySource.get("x")).toBe(2);
    // sourceRoot is prepended.
    expect([...attribute("ab", { version: 3, sources: ["x.js"], sourceRoot: "app", mappings: "AAAA" }).bySource.keys()]).toEqual(["app/x.js"]);
  });

  it("reads index maps with sections", () => {
    const code = "AAAA\nBBBB";
    const map: SourceMap = { version: 3, sources: [], mappings: "", sections: [{ offset: { line: 0, column: 0 }, map: { version: 3, sources: ["one.js"], mappings: "AAAA" } }, { offset: { line: 1, column: 0 }, map: { version: 3, sources: ["two.js"], mappings: "AAAA" } }] };
    expect(Object.fromEntries(attribute(code, map).bySource)).toEqual({ "one.js": 5, "two.js": 4 });
  });

  it("cleans paths and finds packages", () => {
    expect(cleanSource("webpack:///./src/app.tsx?abc")).toBe("src/app.tsx");
    expect(cleanSource("../../node_modules/react/index.js")).toBe("node_modules/react/index.js");
    expect(cleanSource("\0vite/preload-helper")).toBe("vite/preload-helper");
    expect(packageOf("node_modules/react/cjs/react.js")).toEqual({ name: "react", version: null, inner: "cjs/react.js" });
    expect(packageOf("node_modules/@tanstack/query/build/x.js")).toEqual({ name: "@tanstack/query", version: null, inner: "build/x.js" });
    expect(packageOf("node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/client.js")).toEqual({ name: "react-dom", version: "18.3.1", inner: "client.js" });
    expect(packageOf("node_modules/.pnpm/@codemirror+view@6.38.0/node_modules/@codemirror/view/dist/index.js")?.version).toBe("6.38.0");
    expect(packageOf("src/app.ts")).toBeNull();
  });

  it("groups by package and finds duplicates", () => {
    const a = {
      bySource: new Map([
        ["src/app.ts", 100],
        ["src/ui/button.ts", 50],
        ["node_modules/.pnpm/lodash@4.17.21/node_modules/lodash/map.js", 300],
        ["node_modules/.pnpm/lodash@4.17.20/node_modules/lodash/map.js", 280],
        ["node_modules/react/index.js", 400],
        ["node_modules/foo/node_modules/react/index.js", 390],
      ]),
      unmapped: 10,
      total: 1530,
    };
    const g = groupByPackage(a);
    expect(g.map((x) => [x.name, x.bytes])).toEqual([
      ["react", 790],
      ["lodash", 580],
      ["(your code) src", 150],
    ]);
    expect(g[1].versions).toEqual(["4.17.21", "4.17.20"]);
    expect(duplicates(a)).toEqual([
      { name: "react", copies: ["node_modules/react", "node_modules/foo/node_modules/react"], bytes: 390 },
      { name: "lodash", copies: ["4.17.21", "4.17.20"], bytes: 280 },
    ]);
  });

  it("finds the map of a bundle", () => {
    expect(mapUrlOf("x\n//# sourceMappingURL=app.js.map\n", "C:/dist/app.js")).toEqual({ kind: "file", path: "C:/dist/app.js.map" });
    expect(mapUrlOf("x", "/dist/app.js")).toEqual({ kind: "file", path: "/dist/app.js.map" });
    const inline = `x\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${btoa('{"version":3}')}`;
    expect(mapUrlOf(inline, "/a.js")).toEqual({ kind: "inline", json: '{"version":3}' });
  });
});
