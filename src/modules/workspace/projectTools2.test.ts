import { describe, expect, it } from "vitest";
import { dependencyReport, envVarsUsed, importCandidates, importSpecifiers, licenseRisk, packageOf, planRenames, pythonModuleCandidates } from "./projectTools2";

describe("dependencies", () => {
  it("finds imported packages", () => {
    const src = `import React from "react";\nimport { x } from '@scope/pkg/sub';\nconst a = require("lodash/get");\nawait import("./local");\nexport * from "zod";\nimport "side-effect";`;
    const specs = importSpecifiers(src);
    expect(specs.map(packageOf).filter(Boolean)).toEqual(["react", "@scope/pkg", "lodash", "zod", "side-effect"]);
    expect(packageOf("node:fs")).toBeNull();
    expect(packageOf("@/lib/x")).toBeNull();
  });

  it("reports unused, tooling and missing", () => {
    const r = dependencyReport(
      { dependencies: { react: "1", leftpad: "1" }, devDependencies: { typescript: "5", "@types/react": "18", knip: "1" } },
      new Set(["react", "axios", "fs"]),
      "knip && vite build",
    );
    expect(r).toEqual({ unused: ["leftpad"], tooling: ["knip", "typescript"], missing: ["axios"] });
  });

  it("classifies licences", () => {
    expect(licenseRisk("MIT")).toBe("permissive");
    expect(licenseRisk("GPL-3.0-only")).toBe("copyleft");
    expect(licenseRisk("(MIT OR LGPL-2.1)")).toBe("copyleft");
    expect(licenseRisk("")).toBe("unknown");
  });
});

describe("env vars", () => {
  it("collects names across languages", () => {
    const src = `process.env.API_URL; process.env["DB_PASS"]; import.meta.env.VITE_KEY; os.environ["PY_A"]; os.getenv("PY_B"); env::var("RUST_X"); os.Getenv("GO_Y")`;
    expect(envVarsUsed(src).sort()).toEqual(["API_URL", "DB_PASS", "GO_Y", "PY_A", "PY_B", "RUST_X", "VITE_KEY"]);
  });
});

describe("imports", () => {
  it("resolves relative and aliased specifiers", () => {
    const c = importCandidates("/p/src/a/b.ts", "../c/util", "/p");
    expect(c[0]).toBe("/p/src/c/util");
    expect(c).toContain("/p/src/c/util.ts");
    expect(c).toContain("/p/src/c/util/index.ts");
    expect(importCandidates("/p/src/a.ts", "@/lib/x", "/p")).toContain("/p/src/lib/x.tsx");
    expect(importCandidates("/p/src/a.ts", "./y.js", "/p")).toContain("/p/src/y.ts");
    expect(importCandidates("/p/a.ts", "react", "/p")).toEqual([]);
    expect(pythonModuleCandidates("/p", "pkg.mod")).toEqual(["/p/pkg/mod.py", "/p/pkg/mod/__init__.py", "/p/src/pkg/mod.py"]);
  });
});

describe("planRenames", () => {
  it("plans renames and flags collisions", () => {
    const { plans, conflicts } = planRenames(["/d/IMG_1.jpg", "/d/IMG_2.jpg", "/d/notes.txt"], /^IMG_(\d+)/, "photo-$1");
    expect(plans).toEqual([
      { from: "/d/IMG_1.jpg", to: "/d/photo-1.jpg" },
      { from: "/d/IMG_2.jpg", to: "/d/photo-2.jpg" },
    ]);
    expect(conflicts).toEqual([]);
    expect(planRenames(["/d/a1.txt", "/d/a2.txt"], /\d/, "").conflicts).toEqual(["a2.txt → a.txt"]);
  });
});
