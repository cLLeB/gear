import { describe, expect, it } from "vitest";
import {
  cargoTasks,
  composeTasks,
  composerTasks,
  denoTasks,
  detectPackageManager,
  detectTasks,
  justTasks,
  makeTasks,
  npmTasks,
  pythonTasks,
  taskfileTasks,
} from "./taskDetect";

const cmds = (tasks: { command: string }[]) => tasks.map((t) => t.command);

describe("package managers", () => {
  it("prefers the packageManager field, then lockfiles", () => {
    expect(detectPackageManager(["yarn.lock"], "pnpm@9.0.0")).toBe("pnpm");
    expect(detectPackageManager(["pnpm-lock.yaml"])).toBe("pnpm");
    expect(detectPackageManager(["bun.lockb"])).toBe("bun");
    expect(detectPackageManager([])).toBe("npm");
  });

  it("builds the right invocation and skips lifecycle hooks", () => {
    const pkg = JSON.stringify({ scripts: { dev: "vite", test: "vitest", postinstall: "x", prebuild: "y" } });
    expect(cmds(npmTasks(pkg, "npm"))).toEqual(["npm run dev", "npm test"]);
    expect(cmds(npmTasks(pkg, "pnpm"))).toEqual(["pnpm dev", "pnpm test"]);
    expect(npmTasks("{bad", "npm")).toEqual([]);
  });
});

describe("makeTasks", () => {
  it("lists phony-style targets with ## docs", () => {
    const mk = [".PHONY: build test", "## Compile everything", "build: deps", "\tgo build", "test lint:", "%.o: %.c", "VAR := 1", "out.o: x.c"].join("\n");
    expect(makeTasks(mk).map((t) => [t.label, t.detail])).toEqual([
      ["build", "Compile everything"],
      ["test", undefined],
      ["lint", undefined],
    ]);
  });
});

describe("justTasks", () => {
  it("lists public recipes with docs and params", () => {
    const jf = ["set shell := [\"bash\", \"-c\"]", "# Run the server", "serve port='8080':", "  echo {{port}}", "_helper:", "  true", "[private]", "hidden:", "  true", "@test *args:", "  cargo test {{args}}"].join("\n");
    expect(justTasks(jf).map((t) => [t.label, t.detail])).toEqual([
      ["serve", "Run the server · params: port='8080'"],
      ["test", "params: *args"],
    ]);
  });
});

describe("other ecosystems", () => {
  it("deno, composer", () => {
    expect(cmds(denoTasks('{"tasks":{"dev":"deno run -A main.ts"}}'))).toEqual(["deno task dev"]);
    expect(cmds(composerTasks('{"scripts":{"test":"phpunit","post-install-cmd":"x"}}'))).toEqual(["composer run-script test"]);
  });

  it("Taskfile with desc and internal tasks", () => {
    const yml = ["version: '3'", "tasks:", "  build:", "    desc: Build it", "    cmds: [go build]", "  helper:", "    internal: true", "  test:", "    cmds: [go test]", "vars:", "  X: 1"].join("\n");
    expect(taskfileTasks(yml).map((t) => [t.label, t.detail])).toEqual([
      ["build", "Build it"],
      ["test", undefined],
    ]);
  });

  it("pyproject scripts with the project's runner", () => {
    const py = ["[tool.poetry]", 'name = "x"', "[tool.poetry.scripts]", 'serve = "app:main"', "[tool.pytest.ini_options]", "addopts = '-q'"].join("\n");
    expect(cmds(pythonTasks(py, []))).toEqual(["poetry run serve", "poetry run pytest"]);
    const pdm = ["[tool.pdm]", "[tool.pdm.scripts]", 'lint = "ruff check ."'].join("\n");
    expect(cmds(pythonTasks(pdm, []))).toEqual(["pdm run lint"]);
  });

  it("cargo with bins and workspace roots", () => {
    expect(cmds(cargoTasks('[package]\nname="a"\n[[bin]]\nname = "tool"\n'))).toContain("cargo run --bin tool");
    expect(cmds(cargoTasks("[workspace]\nmembers=[]"))).not.toContain("cargo run");
  });

  it("compose services", () => {
    const yml = ["services:", "  web:", "    image: x", "  db:", "    image: y", "volumes:", "  data:"].join("\n");
    expect(cmds(composeTasks(yml))).toEqual([
      "docker compose up",
      "docker compose up web",
      "docker compose logs -f web",
      "docker compose up db",
      "docker compose logs -f db",
      "docker compose down",
    ]);
  });
});

describe("detectTasks", () => {
  it("combines sources present at the root", () => {
    const files: Record<string, string> = {
      "package.json": '{"scripts":{"dev":"vite"},"packageManager":"pnpm@9"}',
      Makefile: "release:\n\t./release.sh",
      "go.mod": "module x",
    };
    const tasks = detectTasks(Object.keys(files), (n) => files[n] ?? null);
    expect(tasks.map((t) => t.source)).toEqual(["pnpm", "make", "go", "go", "go", "go"]);
  });
});
