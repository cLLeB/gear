import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ IS_WINDOWS: false }));

import {
  matchingRunConfigs,
  renderCommand,
  renderPath,
  resolveRunSpec,
} from "./resolve";
import type { RunConfig } from "./types";

const PY: RunConfig = {
  id: "python",
  name: "Python",
  extensions: ["py"],
  command: "python {file}",
};

const CARGO: RunConfig = {
  id: "rust",
  name: "Rust",
  extensions: ["rs"],
  command: "cargo run",
  cwd: "{workspaceRoot}",
};

/** No extensions: selectable by name, never auto-matched. */
const DEV_SERVER: RunConfig = {
  id: "dev",
  name: "Dev server",
  command: "npm run dev",
  cwd: "{workspaceRoot}",
  env: { PORT: "3000" },
};

const layers = (over: Partial<Parameters<typeof resolveRunSpec>[1]> = {}) => ({
  presets: [PY, CARGO],
  ...over,
});

describe("renderCommand", () => {
  const vars = {
    file: "/w/src/heart.py",
    fileDir: "/w/src",
    fileStem: "heart",
    workspaceRoot: "/w",
  };

  it("substitutes every placeholder", () => {
    expect(
      renderCommand("run {file} {fileDir} {fileStem} {workspaceRoot}", vars),
    ).toBe("run /w/src/heart.py /w/src heart /w");
  });

  it("quotes a substituted value that contains spaces", () => {
    expect(
      renderCommand("python {file}", { ...vars, file: "/w/my code/a.py" }),
    ).toBe("python '/w/my code/a.py'");
  });

  it("substitutes a placeholder used more than once", () => {
    expect(renderCommand("cc {fileStem}.c -o {fileStem}", vars)).toBe(
      "cc heart.c -o heart",
    );
  });

  it("leaves an unknown placeholder untouched rather than emitting undefined", () => {
    expect(renderCommand("run {nope}", vars)).toBe("run {nope}");
  });

  it("does not re-expand a placeholder that appears inside a substituted value", () => {
    expect(renderCommand("run {file}", { ...vars, file: "/w/{file}.py" })).toBe(
      "run '/w/{file}.py'",
    );
  });

  it("renders a path without quoting, for callers that quote later", () => {
    expect(renderPath("{workspaceRoot}/src", { ...vars })).toBe("/w/src");
    expect(renderPath("{fileDir}", { ...vars, fileDir: "/my code" })).toBe(
      "/my code",
    );
  });
});

describe("matchingRunConfigs", () => {
  it("orders project over settings over preset", () => {
    const settings: RunConfig = { ...PY, id: "s", name: "Settings Python" };
    const project: RunConfig = { ...PY, id: "p", name: "Project Python" };
    const found = matchingRunConfigs("/w/a.py", {
      presets: [PY],
      settings: [settings],
      project: [project],
    });
    expect(found.map((c) => c.source)).toEqual([
      "project",
      "settings",
      "preset",
    ]);
    expect(found[0].name).toBe("Project Python");
  });

  it("omits configs that do not claim the extension", () => {
    expect(matchingRunConfigs("/w/a.py", layers()).map((c) => c.id)).toEqual([
      "python",
    ]);
  });

  it("never auto-matches a config that declares no extensions", () => {
    const found = matchingRunConfigs("/w/a.py", {
      presets: [PY],
      project: [DEV_SERVER],
    });
    expect(found.map((c) => c.id)).toEqual(["python"]);
  });

  it("returns nothing for a file with no extension", () => {
    expect(matchingRunConfigs("/w/Makefile", layers())).toEqual([]);
  });
});

describe("resolveRunSpec", () => {
  it("resolves a known extension to its rendered command", () => {
    const spec = resolveRunSpec("/w/src/heart.py", layers());
    expect(spec?.command).toBe("python /w/src/heart.py");
    expect(spec?.configId).toBe("python");
    expect(spec?.source).toBe("preset");
    expect(spec?.label).toBe("Python");
  });

  it("returns null for an extension no config claims", () => {
    expect(resolveRunSpec("/w/notes.txt", layers())).toBeNull();
  });

  it("returns null for a dotfile, whose name is not an extension", () => {
    expect(resolveRunSpec("/w/.py", layers())).toBeNull();
  });

  it("matches the extension case-insensitively", () => {
    expect(resolveRunSpec("/w/HEART.PY", layers())?.configId).toBe("python");
  });

  it("runs in the file's directory by default", () => {
    expect(resolveRunSpec("/w/src/heart.py", layers())?.cwd).toBe("/w/src");
  });

  it("renders a cwd template against the workspace root", () => {
    const spec = resolveRunSpec("/w/src/main.rs", {
      ...layers(),
      workspaceRoot: "/w",
    });
    expect(spec?.cwd).toBe("/w");
    expect(spec?.command).toBe("cargo run");
  });

  it("falls back to the file's directory when there is no workspace root", () => {
    expect(resolveRunSpec("/w/src/main.rs", layers())?.cwd).toBe("/w/src");
  });

  it("accepts a Windows path and reports a normalised cwd", () => {
    expect(resolveRunSpec("C:\\w\\src\\heart.py", layers())?.cwd).toBe(
      "C:/w/src",
    );
  });

  it("prefers a settings config over the preset for the same extension", () => {
    const settings: RunConfig = {
      ...PY,
      id: "poetry",
      name: "Poetry",
      command: "poetry run python {file}",
    };
    const spec = resolveRunSpec("/w/a.py", { presets: [PY], settings: [settings] });
    expect(spec?.source).toBe("settings");
    expect(spec?.command).toBe("poetry run python /w/a.py");
  });

  it("uses the built-in presets when no layers are supplied", () => {
    expect(resolveRunSpec("/w/a.py")?.configId).toBe("python");
  });

  it("renders env values, leaving them unquoted for the executor", () => {
    const spec = resolveRunSpec("/w/a.py", {
      presets: [{ ...PY, env: { ROOT: "{workspaceRoot}", MODE: "dev" } }],
      workspaceRoot: "/my code",
    });
    expect(spec?.env).toEqual({ ROOT: "/my code", MODE: "dev" });
  });

  it("defaults env to an empty record so callers need no guard", () => {
    expect(resolveRunSpec("/w/a.py", layers())?.env).toEqual({});
  });

  describe("explicit selection", () => {
    it("uses the selected config even though it claims no extensions", () => {
      const spec = resolveRunSpec("/w/a.py", {
        presets: [PY],
        project: [DEV_SERVER],
        selectedId: "project:dev",
        workspaceRoot: "/w",
      });
      expect(spec?.configId).toBe("dev");
      expect(spec?.command).toBe("npm run dev");
      expect(spec?.cwd).toBe("/w");
      expect(spec?.env).toEqual({ PORT: "3000" });
    });

    it("falls back to auto-matching when the selected id is gone", () => {
      const spec = resolveRunSpec("/w/a.py", {
        ...layers(),
        selectedId: "project:deleted",
      });
      expect(spec?.configId).toBe("python");
    });

    it("distinguishes same-id configs from different layers", () => {
      const project: RunConfig = { ...PY, name: "Project Python" };
      const spec = resolveRunSpec("/w/a.py", {
        presets: [PY],
        project: [project],
        selectedId: "preset:python",
      });
      expect(spec?.source).toBe("preset");
      expect(spec?.label).toBe("Python");
    });

    it("runs a selected extension-less config against a file it cannot match", () => {
      // Selecting "Dev server" then focusing a .txt file still runs the server.
      const spec = resolveRunSpec("/w/notes.txt", {
        project: [DEV_SERVER],
        selectedId: "project:dev",
        workspaceRoot: "/w",
      });
      expect(spec?.configId).toBe("dev");
    });
  });
});
