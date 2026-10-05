import { describe, expect, it } from "vitest";
import { adapterFor, cargoBinaryName, defaultConfigFor, parseLaunchJson, resolveConfig, substitute } from "./launchConfig";

const ctx = { workspaceFolder: "/w/proj", file: "/w/proj/src/app/main.py", env: { HOME: "/home/me" } };

describe("variables", () => {
  it("substitutes VS Code variables deeply", () => {
    expect(
      substitute({ a: "${workspaceFolder}/x", b: ["${fileBasenameNoExtension}", "${relativeFile}", "${fileDirname}"], c: { d: "${env:HOME}/${fileExtname}" }, e: "${unknown}" }, ctx),
    ).toEqual({ a: "/w/proj/x", b: ["main", "src/app/main.py", "/w/proj/src/app"], c: { d: "/home/me/.py" }, e: "${unknown}" });
  });
});

describe("launch.json", () => {
  it("parses JSONC", () => {
    const text = `{
      // comment with "quotes"
      "version": "0.2.0",
      "configurations": [
        { "name": "A", "type": "python", "request": "launch", "program": "http://x/*not a comment*/", }, /* block */
        { "name": "bad" },
      ],
    }`;
    const cfgs = parseLaunchJson(text);
    expect(cfgs.map((c) => c.name)).toEqual(["A"]);
    expect(cfgs[0].program).toBe("http://x/*not a comment*/");
  });

  it("maps types to adapters", () => {
    expect(adapterFor("debugpy")).toBe("python");
    expect(adapterFor("pwa-node")).toBe("node");
    expect(adapterFor("lldb", (k) => k === "lldb")).toBe("lldb");
    expect(adapterFor("cppdbg", (k) => k === "gdb")).toBe("gdb");
    expect(adapterFor("coreclr")).toBeNull();
  });

  it("resolves configurations", () => {
    const py = resolveConfig({ name: "Py", type: "python", request: "launch", module: "pkg.cli", args: ["--v"], preLaunchTask: "build" }, ctx);
    expect(py).toEqual({ name: "Py", adapter: "python", request: "launch", args: { module: "pkg.cli", args: ["--v"], console: "internalConsole" }, cwd: "/w/proj", preLaunch: undefined });
    const cpp = resolveConfig(
      { name: "C", type: "cppdbg", request: "launch", program: "${workspaceFolder}/build/app", environment: [{ name: "X", value: "1" }], MIMode: "gdb", cwd: "${workspaceFolder}/build" },
      ctx,
      (k) => k === "gdb",
    );
    expect(cpp).toMatchObject({ adapter: "gdb", cwd: "/w/proj/build", args: { program: "/w/proj/build/app", env: { X: "1" } } });
    expect(cpp.args.MIMode).toBeUndefined();
    const node = resolveConfig({ name: "N", type: "node", request: "launch", program: "${file}", preLaunchCommand: "npm run build" }, { ...ctx, file: "/w/proj/a.js" });
    expect(node).toMatchObject({ adapter: "node", args: { type: "pwa-node", program: "/w/proj/a.js", console: "internalConsole" }, preLaunch: "npm run build" });
    expect(() => resolveConfig({ name: "X", type: "coreclr", request: "launch" }, ctx)).toThrow(/Unsupported/);
  });
});

describe("defaults", () => {
  it("builds a config per file type", () => {
    expect(defaultConfigFor("/a/b.py")?.type).toBe("python");
    expect(defaultConfigFor("/a/b.ts")?.runtimeArgs).toEqual(["--yes", "tsx"]);
    expect(defaultConfigFor("/a/main.go")?.program).toBe("${fileDirname}");
    expect(defaultConfigFor("/a/main.rs")).toBeNull();
    expect(defaultConfigFor("/a/main.rs", { cargoBinary: "/w/target/debug/app" })?.program).toBe("/w/target/debug/app");
    expect(defaultConfigFor("/a/readme.md")).toBeNull();
  });

  it("reads cargo binary names", () => {
    expect(cargoBinaryName('[package]\nname = "gear"\nversion = "0.1.0"\n')).toBe("gear");
    expect(cargoBinaryName('[package]\nname = "lib"\n\n[[bin]]\nname = "tool"\npath = "src/main.rs"\n')).toBe("tool");
  });
});
