import { describe, expect, it } from "vitest";
import { buildGraph, extractImports, findCycles, findOrphans, importPath, isSourceFile, mostImported, packageOf, packageUse, reachable, resolveImport, toDot } from "./model";

describe("import graph model", () => {
  it("reads JavaScript and TypeScript imports", () => {
    const src = `
      import React, { useState } from "react";
      import type { A } from './types';
      import "./side-effect.css";
      import * as path from "node:path";
      export { b } from "../b";
      export * from "./all";
      const lazy = () => import("./lazy");
      const fs = require('fs');
      // import "./commented";
      /* import "./blocked"; */
      const url = "https://example.org/x"; import x from "./after-url";
      const s = 'import "./in-a-string"';
    `;
    // Known limit: an import statement quoted inside a string is still read as one.
    expect(extractImports("a.ts", src)).toEqual(["react", "./types", "./side-effect.css", "node:path", "../b", "./all", "./lazy", "fs", "./after-url", "./in-a-string"]);
  });

  it("reads Python imports", () => {
    const src = `
import os, sys as system
from . import sibling, other as o
from .pkg.mod import thing
from ..up import (
    a,
)
from app.core import run  # trailing comment
# import commented
"""
import in_docstring
"""
    import indented
`;
    expect(extractImports("pkg/a.py", src)).toEqual([".sibling", ".other", ".pkg.mod", "..up", "app.core", "os", "sys", "indented"]);
  });

  it("resolves relative paths, the @/ alias, index files and .js-for-.ts", () => {
    const files = new Set(["src/a.ts", "src/lib/b.tsx", "src/lib/index.ts", "src/c.js", "src/d.ts", "x/e.mjs"]);
    expect(resolveImport("src/a.ts", "./lib/b", files)).toBe("src/lib/b.tsx");
    expect(resolveImport("src/a.ts", "./lib", files)).toBe("src/lib/index.ts");
    expect(resolveImport("src/lib/b.tsx", "../c", files)).toBe("src/c.js");
    expect(resolveImport("src/lib/b.tsx", "@/a", files)).toBe("src/a.ts");
    expect(resolveImport("src/a.ts", "./d.js", files)).toBe("src/d.ts");
    expect(resolveImport("src/a.ts", "../x/e.mjs", files)).toBe("x/e.mjs");
    expect(resolveImport("src/a.ts", "react", files)).toBeNull();
    expect(resolveImport("src/a.ts", "./missing", files)).toBeNull();
    expect(resolveImport("src/a.ts", "../../../outside", files)).toBeNull();
  });

  it("resolves Python modules and packages", () => {
    const files = new Set(["app/__init__.py", "app/core.py", "app/sub/__init__.py", "app/sub/a.py", "app/sub/b.py", "top.py"]);
    expect(resolveImport("app/sub/a.py", ".b", files)).toBe("app/sub/b.py");
    expect(resolveImport("app/sub/a.py", "..core", files)).toBe("app/core.py");
    expect(resolveImport("app/sub/a.py", "app.core", files)).toBe("app/core.py");
    expect(resolveImport("app/sub/a.py", "app.sub", files)).toBe("app/sub/__init__.py");
    expect(resolveImport("app/core.py", "top", files)).toBe("top.py");
    expect(resolveImport("app/sub/a.py", "b", files)).toBe("app/sub/b.py");
    expect(resolveImport("app/core.py", "os", files)).toBeNull();
  });

  const graph = buildGraph([
    { path: "src/main.ts", source: 'import "./a"; import "react"; import "@scope/pkg/deep";' },
    { path: "src/a.ts", source: 'import "./b"; import "./util"; import "react";' },
    { path: "src/b.ts", source: 'import "./c";' },
    { path: "src/c.ts", source: 'import "./a"; import "./util";' },
    { path: "src/util.ts", source: 'import "lodash/fp";' },
    { path: "src/unused.ts", source: 'import "./util";' },
    { path: "src/a.test.ts", source: 'import "./a";' },
    { path: "src/self.ts", source: 'import "./self";' },
  ]);

  it("builds edges in both directions and collects packages", () => {
    expect(graph.out.get("src/a.ts")).toEqual(["src/b.ts", "src/util.ts"]);
    expect(graph.into.get("src/util.ts")).toEqual(["src/a.ts", "src/c.ts", "src/unused.ts"]);
    expect(graph.out.get("src/self.ts")).toEqual([]);
    expect(graph.packages.get("src/main.ts")).toEqual(["react", "@scope/pkg"]);
    expect(packageUse(graph)).toEqual([["react", 2], ["@scope/pkg", 1], ["lodash", 1]]);
    expect(packageOf("node:path")).toBe("node:path");
  });

  it("finds cycles, orphans and the most imported files", () => {
    expect(findCycles(graph)).toEqual([["src/a.ts", "src/b.ts", "src/c.ts"]]);
    // main is an entry point and the test file is a test; only the truly unused files remain.
    expect(findOrphans(graph)).toEqual(["src/self.ts", "src/unused.ts"]);
    expect(mostImported(graph, 2)).toEqual([["src/a.ts", 3], ["src/util.ts", 3]]);
  });

  it("walks the graph", () => {
    expect(reachable("src/main.ts", graph.out)).toEqual(["src/a.ts", "src/b.ts", "src/c.ts", "src/util.ts"]);
    expect(reachable("src/util.ts", graph.into)).toEqual(["src/a.test.ts", "src/a.ts", "src/b.ts", "src/c.ts", "src/main.ts", "src/unused.ts"]);
    expect(importPath(graph, "src/main.ts", "src/c.ts")).toEqual(["src/main.ts", "src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(importPath(graph, "src/util.ts", "src/main.ts")).toBeNull();
    expect(importPath(graph, "src/a.ts", "src/a.ts")).toEqual(["src/a.ts"]);
  });

  it("survives a very long chain and writes DOT", () => {
    const chain = Array.from({ length: 6000 }, (_, i) => ({ path: `m${i}.ts`, source: i < 5999 ? `import "./m${i + 1}";` : 'import "./m0";' }));
    expect(findCycles(buildGraph(chain))[0]).toHaveLength(6000);
    const dot = toDot(buildGraph([{ path: 'a"b.ts', source: 'import "./c";' }, { path: "c.ts", source: "" }]));
    expect(dot).toContain('"a\\"b.ts" -> "c.ts";');
  });

  it("picks the files worth reading", () => {
    expect(["src/a.ts", "x.py", "a/b.vue", "c.mjs"].every(isSourceFile)).toBe(true);
    expect(["types.d.ts", "node_modules/x/i.js", "a.css", "dist/b.js", ".venv/lib/x.py", "README.md"].some(isSourceFile)).toBe(false);
  });
});
