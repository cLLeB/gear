import { describe, expect, it } from "vitest";
import { assess, categoryOf, evaluate, licenseFromPackageJson, noticesText, normalizeId, parseCargoMetadata, parseExpression, parsePackageLock, parsePnpmLock, pnpmDir, pnpmFolders, summarize, toCsv, type Package } from "./model";

const ev = (s: string) => evaluate(parseExpression(s));

describe("license audit", () => {
  it("normalises ids and sorts them into categories", () => {
    expect(normalizeId("GPL-2.0+")).toBe("GPL-2.0-or-later");
    expect(normalizeId("GPL-3.0")).toBe("GPL-3.0-only");
    expect(normalizeId("Apache 2.0")).toBe("Apache-2.0");
    expect(categoryOf("MIT")).toBe("permissive");
    expect(categoryOf("BSD-3-Clause")).toBe("permissive");
    expect(categoryOf("CC0-1.0")).toBe("public-domain");
    expect(categoryOf("MPL-2.0")).toBe("weak-copyleft");
    expect(categoryOf("LGPL-2.1-or-later")).toBe("weak-copyleft");
    expect(categoryOf("GPL-3.0-or-later")).toBe("strong-copyleft");
    expect(categoryOf("AGPL-3.0-only")).toBe("network-copyleft");
    expect(categoryOf("UNLICENSED")).toBe("proprietary");
    expect(categoryOf("SEE LICENSE IN LICENSE.md")).toBe("proprietary");
    expect(categoryOf("Frobnicate-1.0")).toBe("unknown");
    expect(categoryOf("")).toBe("unknown");
  });

  it("reads SPDX expressions", () => {
    expect(ev("MIT OR Apache-2.0")).toEqual({ category: "permissive", chosen: "MIT" });
    expect(ev("GPL-3.0-only OR MIT")).toEqual({ category: "permissive", chosen: "MIT" });
    expect(ev("MIT AND GPL-2.0-only")).toEqual({ category: "strong-copyleft", chosen: "MIT AND GPL-2.0-only" });
    expect(ev("(MIT OR Apache-2.0) AND Unicode-3.0")).toEqual({ category: "permissive", chosen: "MIT AND Unicode-3.0" });
    expect(ev("GPL-2.0-only WITH Classpath-exception-2.0").category).toBe("weak-copyleft");
    expect(ev("MIT/Apache-2.0").chosen).toBe("MIT");
    expect(ev("Apache License 2.0").chosen).toBe("Apache-2.0");
    expect(ev("(MPL-2.0 OR GPL-3.0)").category).toBe("weak-copyleft");
    expect(ev("")).toEqual({ category: "unknown", chosen: "" });
  });

  it("reads package.json license fields, old and new", () => {
    expect(licenseFromPackageJson({ license: "ISC" })).toBe("ISC");
    expect(licenseFromPackageJson({ license: { type: "MIT", url: "x" } })).toBe("MIT");
    expect(licenseFromPackageJson({ licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] })).toBe("(MIT OR Apache-2.0)");
    expect(licenseFromPackageJson({})).toBe("");
  });

  it("reads pnpm, npm and cargo package lists", () => {
    const pnpm = ["lockfileVersion: '9.0'", "", "importers:", "  .:", "    dependencies:", "", "packages:", "", "  '@babel/core@7.24.0':", "    resolution: {integrity: x}", "", "  react@18.3.1:", "    resolution: {integrity: y}", "    dev: true", "", "  /old-style@1.2.3:", "    resolution: {integrity: z}", "", "snapshots:", "", "  react@18.3.1:", "    dependencies: {}"].join("\n");
    expect(parsePnpmLock(pnpm)).toEqual([
      { name: "@babel/core", version: "7.24.0", dev: false },
      { name: "react", version: "18.3.1", dev: true },
      { name: "old-style", version: "1.2.3", dev: false },
    ]);
    expect(pnpmDir("@babel/core", "7.24.0")).toBe("node_modules/.pnpm/@babel+core@7.24.0/node_modules/@babel/core");
    const folders = pnpmFolders(["@ai-sdk+anthropic@3.0.71_zod@4.3.6", "react@19.2.5", "react-dom@19.2.5_react@19.2.5", "x@1.0.0_a@1", "x@1.0.0", "node_modules", "lock.yaml"]);
    expect(Object.fromEntries(folders)).toEqual({ "@ai-sdk/anthropic@3.0.71": "@ai-sdk+anthropic@3.0.71_zod@4.3.6", "react@19.2.5": "react@19.2.5", "react-dom@19.2.5": "react-dom@19.2.5_react@19.2.5", "x@1.0.0": "x@1.0.0" });
    expect(pnpmDir("@ai-sdk/anthropic", "3.0.71", folders.get("@ai-sdk/anthropic@3.0.71"))).toBe("node_modules/.pnpm/@ai-sdk+anthropic@3.0.71_zod@4.3.6/node_modules/@ai-sdk/anthropic");
    const npm = JSON.stringify({ packages: { "": { name: "me", version: "1.0.0" }, "node_modules/a": { version: "1.0.0", license: "MIT" }, "node_modules/b/node_modules/a": { version: "1.0.0", license: "MIT" }, "node_modules/@s/c": { version: "2.0.0", license: "GPL-3.0", dev: true }, "node_modules/linked": { link: true } } });
    expect(parsePackageLock(npm).map((p) => [p.name, p.version, p.license, p.dev])).toEqual([
      ["a", "1.0.0", "MIT", false],
      ["@s/c", "2.0.0", "GPL-3.0", true],
    ]);
    const cargo = JSON.stringify({ workspace_members: ["me 0.1.0 (path+file:///x)"], packages: [{ id: "me 0.1.0 (path+file:///x)", name: "me", version: "0.1.0", license: "MIT", manifest_path: "/x/Cargo.toml" }, { id: "serde 1.0.0", name: "serde", version: "1.0.0", license: "MIT OR Apache-2.0", manifest_path: "/reg/serde-1.0.0/Cargo.toml" }, { id: "ring", name: "ring", version: "0.17.0", license: null, license_file: "LICENSE", manifest_path: "C:\\reg\\ring\\Cargo.toml" }] });
    expect(parseCargoMetadata(cargo)).toEqual([
      { name: "serde", version: "1.0.0", ecosystem: "cargo", license: "MIT OR Apache-2.0", dir: "/reg/serde-1.0.0" },
      { name: "ring", version: "0.17.0", ecosystem: "cargo", license: "SEE LICENSE IN LICENSE", dir: "C:\\reg\\ring" },
    ]);
  });

  const pkg = (license: string, dev = false): Package => ({ name: "x", version: "1.0.0", ecosystem: "npm", license, dev });

  it("explains conflicts with the project's license", () => {
    expect(assess(pkg("MIT"), "MIT", "app").concern).toBeNull();
    expect(assess(pkg("GPL-3.0-only"), "MIT", "app").concern).toMatch(/requires releasing your code under the GPL/);
    expect(assess(pkg("GPL-3.0-only"), "MIT", "service").concern).toBeNull();
    expect(assess(pkg("GPL-3.0-only"), "GPL-3.0-or-later", "app").concern).toBeNull();
    expect(assess(pkg("AGPL-3.0-only"), "MIT", "service").concern).toMatch(/over a network/);
    expect(assess(pkg("LGPL-2.1-only"), "Apache-2.0", "library").concern).toMatch(/dynamic linking/);
    expect(assess(pkg("GPL-2.0-only"), "GPL-3.0-only", "app").concern).toMatch(/cannot be combined/);
    expect(assess(pkg("Apache-2.0"), "GPL-2.0-only", "app").concern).toMatch(/GPL-2\.0-only project/);
    expect(assess(pkg(""), "MIT", "app").concern).toMatch(/No license declared/);
    expect(assess(pkg("UNLICENSED"), "MIT", "app").concern).toMatch(/No open-source license/);
    // Dev-only packages are not shipped.
    expect(assess(pkg("GPL-3.0-only", true), "MIT", "app").concern).toBeNull();
  });

  it("summarises and writes notices and CSV", () => {
    const list = [assess({ name: "b", version: "2", ecosystem: "npm", license: "MIT" }, "MIT", "app"), assess({ name: "a", version: "1", ecosystem: "cargo", license: "MIT OR Apache-2.0" }, "MIT", "app"), assess({ name: "d", version: "1", ecosystem: "npm", license: "GPL-3.0", dev: true }, "MIT", "app"), assess({ name: "c", version: "1", ecosystem: "npm", license: "ISC" }, "MIT", "app")];
    expect(summarize(list)).toEqual([
      { category: "permissive", count: 3 },
      { category: "strong-copyleft", count: 1 },
    ]);
    const text = noticesText(list, new Map([["npm:b@2", "Copyright (c) B\n\nPermission is hereby granted"]]), "Gear");
    expect(text).toContain("Gear includes the following 3 packages.");
    expect(text).toContain("MIT (2)");
    expect(text).toContain("a 1\nb 2\n\nCopyright (c) B");
    expect(text).not.toContain("d 1");
    const csv = toCsv(list);
    expect(csv.split("\n")[0]).toBe("ecosystem,name,version,license,category,dev,concern");
    expect(csv).toContain("npm,d,1,GPL-3.0,Strong copyleft,yes,");
  });
});
