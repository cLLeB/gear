import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyCratesInfo,
  bumpRequirement,
  compareVersions,
  maxSatisfying,
  osvQuery,
  parseCargoMetadata,
  parseGoList,
  parseNpmAudit,
  parseNpmOutdated,
  parsePipOutdated,
  parsePnpmAudit,
  parsePnpmOutdated,
  parsePypiVulns,
  pythonDirectNames,
  satisfiesCargo,
  updateKind,
  upgradeArgv,
  worstSeverity,
} from "./model";

const fx = (f: string) => readFileSync(join(__dirname, "__fixtures__", f), "utf8");

describe("semver", () => {
  it("compares and classifies", () => {
    expect(["1.10.0", "1.2.0", "1.2.0-rc.1", "0.9.9", "2.0.0"].sort(compareVersions)).toEqual(["0.9.9", "1.2.0-rc.1", "1.2.0", "1.10.0", "2.0.0"]);
    expect(updateKind("4.17.1", "5.3.0")).toBe("major");
    expect(updateKind("0.4.8", "0.5.0")).toBe("major");
    expect(updateKind("1.2.0", "1.3.0")).toBe("minor");
    expect(updateKind("1.2.0", "1.2.1")).toBe("patch");
    expect(updateKind("1.2.0", "1.2.0")).toBeNull();
    expect(updateKind("v0.3.0", "v0.43.0")).toBe("major");
  });

  it("matches Cargo requirements", () => {
    const cases: [string, string, boolean][] = [
      ["1.6.0", "=1.6.0", true],
      ["1.6.1", "=1.6.0", false],
      ["1.13.2", "1.6", true],
      ["2.0.0", "1.6", false],
      ["0.4.8", "0.4", true],
      ["0.5.0", "0.4", false],
      ["0.0.4", "^0.0.3", false],
      ["1.2.9", "~1.2.3", true],
      ["1.3.0", "~1.2.3", false],
      ["1.5.0", ">=1.2, <1.6", true],
      ["1.6.0", ">=1.2, <1.6", false],
      ["3.1.4", "*", true],
      ["1.9.0", "1.*", true],
      ["1.0.0-beta.1", "1", false],
    ];
    for (const [v, r, want] of cases) expect([v, r, satisfiesCargo(v, r)]).toEqual([v, r, want]);
    expect(maxSatisfying(["0.4.1", "0.4.8", "0.5.0", "1.0.0"], "0.4")).toBe("0.4.8");
  });
});

describe("reports", () => {
  it("parses npm and pnpm outdated", () => {
    const npm = parseNpmOutdated(fx("npm-outdated.json"));
    expect(npm.find((d) => d.name === "express")).toMatchObject({ kind: "prod", current: "4.17.1", wanted: "4.17.1", latest: "5.3.0" });
    expect(npm.find((d) => d.name === "left-pad")).toMatchObject({ kind: "dev", latest: "1.3.0" });
    expect(parsePnpmOutdated(fx("pnpm-outdated.json")).find((d) => d.name === "left-pad")).toMatchObject({ kind: "dev", deprecated: true });
  });

  it("attributes audit advisories to direct dependencies", () => {
    const npm = parseNpmAudit(fx("npm-audit.json"));
    expect(Object.keys(npm)).toEqual(["express"]);
    const ids = npm.express.map((v) => v.id);
    expect(ids).toContain("GHSA-qw6h-vgh9-j6wx");
    // Transitive ones (body-parser, qs, …) are included and say where they come from.
    expect(npm.express.some((v) => v.via && v.via !== "express")).toBe(true);
    expect(worstSeverity(npm.express)).toBe("high");
    const pnpm = parsePnpmAudit(fx("pnpm-audit.json"));
    expect(Object.keys(pnpm)).toEqual(["express"]);
    expect(new Set(pnpm.express.map((v) => v.id)).size).toBe(pnpm.express.length);
    expect(pnpm.express.length).toBeGreaterThanOrEqual(5);
  });

  it("parses cargo metadata and crates.io", () => {
    const deps = parseCargoMetadata(fx("cargo-metadata.json"));
    expect(deps.map((d) => [d.name, d.req, d.current])).toEqual([
      ["itoa", "^0.4", "0.4.8"],
      ["smallvec", "=1.6.0", "1.6.0"],
    ]);
    const itoa = applyCratesInfo(deps[0], fx("crates-itoa.json"));
    expect(itoa.wanted).toBe("0.4.8");
    expect(updateKind(itoa.current, itoa.latest)).toBe("major");
    const sv = applyCratesInfo(deps[1], fx("crates-smallvec.json"));
    expect(sv.wanted).toBe("1.6.0");
    expect(compareVersions(sv.latest!, "1.13.0")).toBeGreaterThanOrEqual(0);
    expect(upgradeArgv("cargo", sv, sv.latest!)).toEqual(["cargo", "add", `smallvec@${sv.latest}`]);
    expect(upgradeArgv("cargo", { ...itoa, req: "0.4", wanted: "0.4.8", current: "0.4.1" }, "0.4.8")).toEqual(["cargo", "update", "-p", "itoa", "--precise", "0.4.8"]);
  });

  it("parses pip, PyPI advisories and go", () => {
    const direct = pythonDirectNames({ "requirements.txt": "requests==2.25.0  # http\n-r other.txt\nDjango>=4 ; python_version>'3.8'\n", "pyproject.toml": '[project]\ndependencies = ["httpx>=0.27", "pydantic[email]"]\n[tool.poetry.dependencies]\npython = "^3.11"\nrich = "^13"\n' });
    expect([...direct].sort()).toEqual(["django", "httpx", "pydantic", "requests", "rich"]);
    const pip = parsePipOutdated(fx("pip-outdated.json"), direct);
    expect(pip.find((d) => d.name === "requests")).toMatchObject({ kind: "prod", current: "2.25.0" });
    expect(pip.find((d) => d.name === "idna")?.kind).toBe("indirect");
    expect(pip.some((d) => d.name === "pip")).toBe(false);
    const vulns = parsePypiVulns(fx("pypi-requests-2.25.0.json"));
    expect(vulns.length).toBe(8);
    expect(vulns.find((v) => v.id === "CVE-2023-32681")?.fixedIn).toContain("2.31.0");
    expect(bumpRequirement("Requests[socks]==2.25.0 ; python_version>'3'\nurllib3==1.26\n", "requests", "2.32.3")).toBe("Requests[socks]==2.32.3 ; python_version>'3'\nurllib3==1.26\n");
    const go = parseGoList(fx("go-list.json"));
    expect(go).toEqual([{ name: "golang.org/x/text", kind: "indirect", current: "v0.3.0", wanted: "v0.43.0", latest: "v0.43.0", vulns: [] }]);
    expect(JSON.parse(osvQuery("go", go)).queries[0]).toEqual({ package: { name: "golang.org/x/text", ecosystem: "Go" }, version: "0.3.0" });
    expect(upgradeArgv("pnpm", { name: "left-pad", kind: "dev", current: "1.2.0", wanted: null, latest: "1.3.0", vulns: [] }, "1.3.0")).toEqual(["pnpm", "add", "left-pad@1.3.0", "-D"]);
  });
});
