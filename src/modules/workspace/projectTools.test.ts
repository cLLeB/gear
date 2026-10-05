import { describe, expect, it } from "vitest";
import {
  changelogFrom,
  estimateTokens,
  FILE_TEMPLATES,
  nextVersion,
  parseNpmOutdated,
  parsePipOutdated,
  readmeFor,
  renderTree,
  setManifestVersion,
  templateFileName,
} from "./projectTools";

describe("outdated parsers", () => {
  it("reads npm and pip output, majors first", () => {
    const npm = JSON.stringify({ react: { current: "18.2.0", wanted: "18.3.1", latest: "19.0.0" }, zod: { current: "3.22.0", wanted: "3.23.8", latest: "3.23.8" } });
    expect(parseNpmOutdated(npm).map((o) => [o.name, o.kind])).toEqual([["react", "major"], ["zod", "minor"]]);
    expect(parseNpmOutdated("")).toEqual([]);
    expect(parsePipOutdated('[{"name":"requests","version":"2.31.0","latest_version":"2.32.3"}]')[0].kind).toBe("minor");
  });
});

describe("templates", () => {
  it("names files", () => {
    const react = FILE_TEMPLATES.find((t) => t.id === "react")!;
    expect(templateFileName(react, "user card")).toBe("UserCard.tsx");
    expect(react.body("user card")).toContain("export function UserCard(");
    expect(templateFileName(FILE_TEMPLATES.find((t) => t.id === "pytest")!, "MyModule")).toBe("test_my-module.py");
  });
});

describe("readme and changelog", () => {
  it("builds a README", () => {
    const md = readmeFor({ name: "gear", description: "A terminal.", kind: "node", license: "MIT", scripts: { dev: "vite", test: "vitest run" } });
    expect(md).toContain("# gear\n\nA terminal.");
    expect(md).toContain("npm run dev");
    expect(md).toContain("| `npm run test` | `vitest run` |");
  });

  it("groups conventional commits", () => {
    const log = changelogFrom(
      "1.2.0",
      [
        { subject: "feat(ui): add dark mode", short: "a1" },
        { subject: "fix: crash on start", short: "b2" },
        { subject: "feat!: drop node 16", short: "c3" },
        { subject: "Merge pull request #4 from x", short: "d4" },
        { subject: "tweak things", short: "e5" },
      ],
      new Date("2024-05-01"),
    );
    expect(log).toBe(
      "## 1.2.0 (2024-05-01)\n\n### ⚠ Breaking changes\n\n- drop node 16 (c3)\n\n### Features\n\n- **ui:** add dark mode (a1)\n- drop node 16 (c3)\n\n### Bug fixes\n\n- crash on start (b2)\n\n### Other\n\n- tweak things (e5)\n",
    );
  });
});

describe("versions", () => {
  it("bumps", () => {
    expect(nextVersion("1.2.3", "patch")).toBe("1.2.4");
    expect(nextVersion("1.2.3", "minor")).toBe("1.3.0");
    expect(nextVersion("1.2.3", "major")).toBe("2.0.0");
    expect(nextVersion("1.2.3", "prerelease")).toBe("1.2.4-rc.0");
    expect(nextVersion("1.2.4-rc.0", "prerelease")).toBe("1.2.4-rc.1");
    expect(nextVersion("1.2.4-rc.1", "patch")).toBe("1.2.4");
  });

  it("edits manifests", () => {
    expect(setManifestVersion("package.json", '{\n  "name": "x",\n  "version": "0.1.0"\n}', "0.2.0")).toEqual({ old: "0.1.0", content: '{\n  "name": "x",\n  "version": "0.2.0"\n}' });
    const cargo = '[package]\nname = "x"\nversion = "1.0.0"\n\n[dependencies]\nserde = { version = "1" }\n';
    expect(setManifestVersion("Cargo.toml", cargo, "1.1.0")!.content).toBe(cargo.replace('version = "1.0.0"', 'version = "1.1.0"'));
    expect(setManifestVersion("pyproject.toml", '[project]\nname="p"\nversion = "0.3.0"\n', "0.4.0")!.old).toBe("0.3.0");
    expect(setManifestVersion("Cargo.toml", "[dependencies]\n", "1.0.0")).toBeNull();
  });
});

describe("tree and tokens", () => {
  it("renders a tree with folders first", () => {
    expect(renderTree(["src/b.ts", "src/a/x.ts", "README.md"], "proj")).toBe("proj\n├── src/\n│   ├── a/\n│   │   └── x.ts\n│   └── b.ts\n└── README.md\n");
  });

  it("estimates tokens", () => {
    expect(estimateTokens("")).toBe(0);
    const n = estimateTokens("The quick brown fox jumps over the lazy dog.");
    expect(n).toBeGreaterThan(8);
    expect(n).toBeLessThan(16);
  });
});
