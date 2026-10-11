// The dependency manager against real projects and registries.
// GEAR_TEST_DEPS=<folder with npmp/ pnpmp/ cargop/ pyp/ gop/> pnpm vitest run src/modules/deps

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";

const root = process.env.GEAR_TEST_DEPS;
const cache = mkdtempSync(`${tmpdir()}/gear-deps-cache-`);
vi.mock("@tauri-apps/api/path", () => ({ appCacheDir: async () => cache }));
vi.mock("@/app/appBridge", () => ({ app: () => ({ workspaceRoot: () => root, openFile: () => {} }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/modules/quick-pick", () => ({ confirmPick: async () => true }));
vi.mock("@/modules/debug/store", () => ({ pythonFor: async (cwd: string) => (existsSync(`${cwd}/.venv/bin/python`) ? `${cwd}/.venv/bin/python` : null) }));
vi.mock("@/modules/ai/lib/native", () => ({
  native: {
    runCommand: async (command: string, cwd: string | null) => {
      const r = spawnSync("sh", ["-c", command], { cwd: cwd ?? undefined, encoding: "utf8", maxBuffer: 1 << 26 });
      return { stdout: r.stdout, stderr: r.stderr, exit_code: r.status, timed_out: false, truncated: false };
    },
    readFile: async (p: string) => (existsSync(p) ? { kind: "text", content: readFileSync(p, "utf8"), size: 0 } : Promise.reject(new Error("missing"))),
    writeFile: async (p: string, c: string) => writeFileSync(p, c),
    createDir: async (p: string) => void mkdirSync(p, { recursive: true }),
    glob: async ({ root: r }: { root: string }) => {
      const names = new Set(["package.json", "Cargo.toml", "go.mod", "pyproject.toml", "requirements.txt"]);
      const hits: { path: string; rel: string }[] = [];
      const walk = (d: string) => {
        for (const e of readdirSync(d)) {
          const p = join(d, e);
          if (statSync(p).isDirectory()) {
            if (!["node_modules", ".venv", "target"].includes(e)) walk(p);
          } else if (names.has(e)) hits.push({ path: p, rel: relative(r, p) });
        }
      };
      walk(r);
      return { hits, truncated: false };
    },
  },
}));

describe.skipIf(!root)("dependency manager against real tools", () => {
  it("scans every ecosystem and upgrades", async () => {
    const s = await import("./store");
    const projects = await s.discover();
    expect(projects.map((p) => p.eco).sort()).toEqual(["cargo", "go", "npm", "pip", "pnpm"]);
    await s.scanAll();
    const get = (eco: string) => s.useDepsStore.getState().projects.find((p) => p.eco === eco)!;
    for (const eco of ["npm", "pnpm", "cargo", "pip", "go"]) expect([eco, get(eco).status, get(eco).error]).toEqual([eco, "ready", undefined]);

    const npm = get("npm");
    expect(npm.deps.find((d) => d.name === "express")).toMatchObject({ current: "4.17.1" });
    expect(npm.deps.find((d) => d.name === "express")!.vulns.length).toBeGreaterThan(3);
    expect(get("pnpm").deps.find((d) => d.name === "express")!.vulns.length).toBeGreaterThan(3);
    const cargo = get("cargo");
    expect(cargo.deps.find((d) => d.name === "itoa")).toMatchObject({ current: "0.4.8", wanted: "0.4.8" });
    expect(cargo.deps.find((d) => d.name === "itoa")!.latest).toMatch(/^1\./);
    const pip = get("pip");
    expect(pip.deps.find((d) => d.name === "requests")!.vulns.length).toBeGreaterThan(3);
    expect(get("go").deps[0]).toMatchObject({ name: "golang.org/x/text", current: "v0.3.0" });

    // Safe updates: left-pad 1.2.0 → 1.3.0 is a minor bump (dev dependency).
    const safe = s.safeUpdates(npm);
    expect(safe.map((u) => [u.dep.name, u.version])).toEqual([["left-pad", "1.3.0"]]);
    await s.upgrade(npm.dir, safe);
    const pkg = JSON.parse(readFileSync(`${npm.dir}/package.json`, "utf8"));
    expect(pkg.devDependencies["left-pad"]).toMatch(/1\.3\.0/);
    expect(get("npm").deps.some((d) => d.name === "left-pad")).toBe(false);

    // Python: upgrade requests and keep requirements.txt in step.
    await s.upgrade(pip.dir, [{ dep: pip.deps.find((d) => d.name === "requests")!, version: "2.32.3" }]);
    expect(readFileSync(`${pip.dir}/requirements.txt`, "utf8")).toBe("requests==2.32.3\n");
    expect(get("pip").deps.find((d) => d.name === "requests")?.current ?? "2.32.3").toBe("2.32.3");

    // Cargo: a major upgrade rewrites the requirement.
    await s.upgrade(cargo.dir, [{ dep: cargo.deps.find((d) => d.name === "itoa")!, version: "1.0.11" }]);
    expect(readFileSync(`${cargo.dir}/Cargo.toml`, "utf8")).toMatch(/itoa = "1\.0\.11"/);
    // `cargo add itoa@1.0.11` writes a caret requirement; the lockfile takes the newest 1.0.x.
    expect(get("cargo").deps.find((d) => d.name === "itoa")!.current).toMatch(/^1\.0\.\d+$/);
  }, 600_000);
});
